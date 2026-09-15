import { createHash, randomBytes } from "node:crypto";
import { PaidJobClientError, type Logger, type PaidJobClient } from "../interfaces/index.js";
import type { AssetRepo, EncodingJobRepo, PaidOperationRepo, RenditionRepo } from "../repo/index.js";
import type { JsonValue, PaidOperation, Resolution, SelectedWorkerRoute, WorkUnitEstimator } from "../types/index.js";
import { encodeAbrExchangeRequest, type AbrExchangeRequest, validateAbrTerminal } from "./abrExchange.js";

export interface PaidAbrRecoveryDeps {
  assetRepo: AssetRepo;
  jobRepo: EncodingJobRepo;
  renditionRepo: RenditionRepo;
  paidOperationRepo: PaidOperationRepo;
  paidJobClient: PaidJobClient;
  owner: string;
  leaseMs: number;
  retryMs: number;
  logger?: Logger;
}

export async function recoverPaidAbrOperations(
  deps: PaidAbrRecoveryDeps,
  input: { now?: Date; limit?: number } = {},
): Promise<number> {
  const now = input.now ?? new Date();
  const leaseExpiresAt = new Date(now.getTime() + deps.leaseMs);
  const operations = await deps.paidOperationRepo.claimRecoverable(
    "job", deps.owner, now, leaseExpiresAt, input.limit ?? 10,
  );
  for (const operation of operations) {
    await recoverOne(deps, operation).catch((error) => {
      deps.logger?.error("orchestrator.vod_recovery_failed", {
        operation_id: operation.id,
        error: error instanceof Error ? error.message : "unknown",
      });
    });
  }
  return operations.length;
}

async function recoverOne(deps: PaidAbrRecoveryDeps, operation: PaidOperation): Promise<void> {
  if (!operation.assetId || !operation.recoveryOwner || !operation.recoveryLeaseExpiresAt) {
    throw new Error("recoverable VOD operation is incomplete");
  }
  const claim = {
    owner: operation.recoveryOwner,
    version: operation.lifecycleVersion,
    leaseExpiresAt: operation.recoveryLeaseExpiresAt,
  };
  const secrets = await deps.paidOperationRepo.readSecrets(operation.id, claim);
  const callerRequestId = objectString(secrets?.loc, "idempotency_key");
  if (!secrets?.openIntent || !callerRequestId) throw new Error("recoverable VOD intent is unavailable");
  const encoded = encodeAbrExchangeRequest(secrets.openIntent as unknown as AbrExchangeRequest);
  if (encoded.sha256 !== operation.requestContentSha256) throw new Error("recoverable VOD intent hash drift");
  const request = encoded.json as unknown as AbrExchangeRequest;
  const asset = await deps.assetRepo.byId(operation.assetId);
  if (!asset?.durationSec) throw new Error("recoverable VOD asset probe is unavailable");
  const [renditions, jobs] = await Promise.all([
    deps.renditionRepo.byAsset(asset.id),
    deps.jobRepo.byAsset(asset.id),
  ]);
  const job = jobs.find((value) => value.kind === "encode" && value.status === "running");
  if (!job) throw new Error("recoverable VOD encoding job is unavailable");
  let terminal: ReturnType<typeof validateAbrTerminal> | undefined;
  let result;
  try {
    result = await deps.paidJobClient.execute({
      requestId: callerRequestId,
      route: routeFrom(operation),
      transport: "stream",
      estimatedUnits: uint(operation.fundedUnits),
      maxTotalUnits: uint(operation.fundedUnits),
      contentType: "application/json",
      body: encoded.body,
      validateTerminal(value) {
        terminal = validateAbrTerminal({
          ...value,
          workloadId: asset.id,
          requestSha256: encoded.sha256,
          maximumUnits: uint(operation.fundedUnits),
        });
        validateCoordinates(terminal, request);
      },
    });
  } catch (error) {
    const typed = error instanceof PaidJobClientError ? error : null;
    const recorded = await deps.paidOperationRepo.recordRetry(operation.id, claim, {
      status: typed !== null && !typed.retryable ? "encumbered" : "recovery_retry",
      nextRetryAt: new Date(Date.now() + deps.retryMs),
      errorCode: typed?.code ?? "paid_job_recovery_failed",
    });
    if (!recorded) throw new Error("VOD recovery error fence was lost");
    return;
  }
  if (result.kind !== "settled" || !terminal) {
    const progressed = await deps.paidOperationRepo.recordProgress(operation.id, claim, {
      status: result.kind,
      requestId: result.opened.requestId,
      locOperationId: result.opened.operationId,
      ...("brokerJobId" in result ? { brokerJobId: result.brokerJobId } : {}),
    });
    if (!progressed) throw new Error("VOD recovery progress fence was lost");
    await deps.paidOperationRepo.recordRetry(operation.id, {
      owner: deps.owner,
      version: progressed.lifecycleVersion,
      leaseExpiresAt: claim.leaseExpiresAt,
    }, {
      status: result.kind,
      nextRetryAt: new Date(Date.now() + deps.retryMs),
      errorCode: result.kind,
    });
    return;
  }
  const rows = new Map(renditions.map((value) => [value.resolution, value]));
  const completed = terminal.renditions.filter((value) => value.video !== undefined).map((value) => {
    const row = rows.get(value.name as Resolution);
    if (!row) throw new Error("recovered terminal rendition was not requested");
    return { renditionId: row.id, storageKey: value.stream_uri, durationSeconds: asset.durationSec! };
  });
  if (completed.length !== renditions.length) throw new Error("recovered terminal rendition set is incomplete");
  const recorded = await deps.paidOperationRepo.recordVodTerminal(operation.id, claim, {
    assetId: asset.id,
    encodingJobId: job.id,
    playbackId: `pb_${randomBytes(12).toString("hex")}`,
    apiKeyId: asset.apiKeyId,
    locOperationId: result.opened.operationId,
    brokerJobId: result.settlement.brokerJobId,
    brokerRequestId: result.opened.requestId,
    claimedUnits: String(result.settlement.actualUnits),
    settlementSequence: operation.settlementSequence,
    evidence: {
      httpStatus: result.brokerStatus ?? 200,
      responseSha256: createHash("sha256").update(result.brokerBody ?? new Uint8Array()).digest("hex"),
      workUnit: result.settlement.workUnit,
      workUnits: String(result.settlement.actualUnits),
      claimSignature: result.settlement.envelope.signature.value,
    },
    terminalAt: new Date(),
    renditions: completed,
  });
  if (!recorded) throw new Error("VOD recovery terminal fence was lost");
}

function routeFrom(operation: PaidOperation): SelectedWorkerRoute {
  const raw = object(operation.route.raw);
  const estimator = object(operation.route.estimator);
  return {
    workerUrl: string(raw, "broker_url"),
    ethAddress: string(raw, "eth_address"),
    capability: operation.route.capability as SelectedWorkerRoute["capability"],
    offering: operation.route.offering,
    pricePerWorkUnitWei: operation.route.pricePerUnitWei,
    unitsPerPrice: operation.route.unitsPerPrice,
    workUnit: operation.route.workUnit,
    protocol: "paid-job/v1",
    job: { transports: ["stream"] },
    session: null,
    workUnitEstimator: estimator === null ? null : estimator as unknown as WorkUnitEstimator,
    settlementKeys: [{ publicKey: operation.route.settlementKey, notBefore: "", expiresAt: "", introducedInPublicationSeq: "0" }],
    settlementDomainId: operation.route.settlementDomainId ?? string(raw, "settlement_domain_id"),
    quoteId: operation.route.quoteId,
    quoteVersion: operation.route.quoteVersion,
    constraintFingerprint: Buffer.from(operation.route.constraintFingerprint, "hex"),
    routeFingerprint: Buffer.from(operation.route.routeFingerprint, "hex"),
  };
}

function validateCoordinates(terminal: ReturnType<typeof validateAbrTerminal>, request: AbrExchangeRequest): void {
  if (terminal.manifest_uri !== request.output.manifest.artifact_uri || terminal.renditions.length !== Object.keys(request.output.renditions).length) {
    throw new Error("recovered terminal output coordinates drifted");
  }
  for (const value of terminal.renditions) {
    const expected = request.output.renditions[value.name];
    if (!expected || value.playlist_uri !== expected.playlist.artifact_uri || value.stream_uri !== expected.stream.artifact_uri) {
      throw new Error("recovered terminal output coordinates drifted");
    }
  }
}

function object(value: JsonValue | undefined): Record<string, JsonValue> | null {
  return value !== null && value !== undefined && typeof value === "object" && !Array.isArray(value) ? value : null;
}
function string(value: Record<string, JsonValue> | null, key: string): string {
  const candidate = value?.[key];
  if (typeof candidate !== "string" || candidate.length === 0) throw new Error("recoverable route is invalid");
  return candidate;
}
function objectString(value: JsonValue | undefined, key: string): string | null {
  const candidate = object(value)?.[key];
  return typeof candidate === "string" && candidate.length > 0 ? candidate : null;
}
function uint(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error("recoverable funding is invalid");
  return parsed;
}
