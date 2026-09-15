import { createHash, randomBytes, randomUUID } from "node:crypto";
import type {
  Asset,
  EncodingTier,
  PaidRouteSnapshot,
  RenditionSpec,
  SelectedWorkerRoute,
} from "../types/index.js";
import type {
  Logger,
  PaidJobClient,
  SourceProbe,
  StorageProvider,
} from "../interfaces/index.js";
import type {
  AssetRepo,
  EncodingJobRepo,
  PaidOperationRepo,
  RenditionRepo,
} from "../repo/index.js";
import { newRequestId } from "../../livepeer/requestId.js";
import {
  ABR_REQUEST_SCHEMA,
  ABR_RESULT_SCHEMA,
  encodeAbrExchangeRequest,
  type AbrTerminalResult,
  validateAbrTerminal,
} from "./abrExchange.js";
import { ABR_WORK_UNIT, estimateAbrFunding } from "./vodUsage.js";

const PRESETS: Record<EncodingTier, { name: string; renditions: RenditionSpec[]; audioOnly: boolean }> = {
  baseline: {
    name: "abr-mobile",
    audioOnly: false,
    renditions: [
      { resolution: "720p", codec: "h264", bitrateKbps: 2_500 },
      { resolution: "480p", codec: "h264", bitrateKbps: 1_000 },
      { resolution: "360p", codec: "h264", bitrateKbps: 600 },
    ],
  },
  standard: {
    name: "abr-standard",
    audioOnly: false,
    renditions: [
      { resolution: "1080p", codec: "h264", bitrateKbps: 5_000 },
      { resolution: "720p", codec: "h264", bitrateKbps: 2_500 },
      { resolution: "480p", codec: "h264", bitrateKbps: 1_000 },
      { resolution: "360p", codec: "h264", bitrateKbps: 600 },
    ],
  },
  premium: {
    name: "abr-premium",
    audioOnly: true,
    renditions: [
      { resolution: "2160p", codec: "h264", bitrateKbps: 15_000 },
      { resolution: "1080p", codec: "h264", bitrateKbps: 5_000 },
      { resolution: "720p", codec: "h264", bitrateKbps: 2_500 },
      { resolution: "480p", codec: "h264", bitrateKbps: 1_000 },
      { resolution: "360p", codec: "h264", bitrateKbps: 600 },
    ],
  },
};

export interface PaidAbrOrchestratorDeps {
  assetRepo: AssetRepo;
  jobRepo: EncodingJobRepo;
  renditionRepo: RenditionRepo;
  paidOperationRepo: PaidOperationRepo;
  storage: StorageProvider;
  sourceProbe: SourceProbe;
  paidJobClient: PaidJobClient;
  logger?: Logger;
  owner: string;
  recoveryLeaseMs: number;
}

export async function runPaidAbrAsset(
  deps: PaidAbrOrchestratorDeps,
  input: { asset: Asset; route: SelectedWorkerRoute },
): Promise<void> {
  const { asset, route } = input;
  if (
    route.protocol !== "paid-job/v1" ||
    !route.job?.transports.includes("stream") ||
    route.workUnit !== ABR_WORK_UNIT ||
    !asset.sourceUrl
  ) throw new Error("paid ABR route or source is invalid");

  const sourceUrl = asset.sourceUrl.startsWith("http")
    ? asset.sourceUrl
    : await deps.storage.getSignedDownloadUrl({ storageKey: asset.sourceUrl, expiresInSec: 86_400 });
  const probe = await deps.sourceProbe.probe(sourceUrl);
  await deps.assetRepo.updateStatus(asset.id, "preparing", {
    durationSec: probe.durationSec,
    width: probe.width,
    height: probe.height,
    frameRate: probe.frameRate,
    audioCodec: probe.audioCodec,
    videoCodec: probe.videoCodec,
    ffprobeJson: probe.raw,
  });

  const preset = PRESETS[asset.encodingTier];
  const funding = estimateAbrFunding({
    durationSeconds: probe.durationSec,
    sourceFrameRate: probe.frameRate,
    targets: preset.renditions.map((rendition) => ({ resolution: rendition.resolution })),
    estimator: route.workUnitEstimator,
  });
  const renditionRows = new Map<string, string>();
  const outputRenditions: Record<string, {
    playlist: { artifact_uri: string; upload_url: string };
    stream: { artifact_uri: string; upload_url: string };
  }> = {};
  for (const spec of preset.renditions) {
    const row = await deps.renditionRepo.insert({
      id: `rend_${randomBytes(12).toString("hex")}`,
      assetId: asset.id,
      ...spec,
      status: "queued",
    });
    renditionRows.set(spec.resolution, row.id);
    outputRenditions[spec.resolution] = await destinations(deps.storage, asset.id, spec.resolution);
  }
  if (preset.audioOnly) outputRenditions["audio-only"] = await destinations(deps.storage, asset.id, "audio-only", "audio");
  const manifest = await deps.storage.putSignedUploadUrl({
    assetId: asset.id,
    kind: "manifest",
    filename: "master.m3u8",
    contentType: "application/vnd.apple.mpegurl",
    expiresInSec: 86_400,
  });
  const requestId = newRequestId();
  const encoded = encodeAbrExchangeRequest({
    schema: ABR_REQUEST_SCHEMA,
    workload_id: asset.id,
    input: { download_url: sourceUrl },
    ladder: { preset: preset.name },
    output: {
      manifest: { artifact_uri: manifest.storageKey, upload_url: manifest.url },
      renditions: outputRenditions,
    },
  });
  const operationId = randomUUID();
  const job = await deps.jobRepo.insert({
    id: `job_${randomBytes(12).toString("hex")}`,
    assetId: asset.id,
    kind: "encode",
    status: "running",
    workerUrl: route.workerUrl,
    startedAt: new Date(),
  });
  const leaseExpiresAt = new Date(Date.now() + deps.recoveryLeaseMs);
  const operation = await deps.paidOperationRepo.insertWithSecrets(
    {
      id: operationId,
      kind: "job",
      apiKeyId: asset.apiKeyId,
      assetId: asset.id,
      requestId: `pending:${requestId}`,
      requestContentSha256: encoded.sha256,
      workId: `pending:${requestId}`,
      route: paidRoute(route),
      status: "opening",
      fundedUnits: String(funding.maxTotalUnits),
    },
    { openIntent: encoded.json, loc: { idempotency_key: requestId } },
    { owner: deps.owner, leaseExpiresAt },
  );
  const claim = { owner: deps.owner, version: operation.lifecycleVersion, leaseExpiresAt };
  let terminal: AbrTerminalResult | undefined;
  const result = await deps.paidJobClient.execute({
    requestId,
    route,
    transport: "stream",
    estimatedUnits: funding.estimatedUnits,
    maxTotalUnits: funding.maxTotalUnits,
    contentType: "application/json",
    body: encoded.body,
    validateTerminal(value) {
      terminal = validateAbrTerminal({
        ...value,
        workloadId: asset.id,
        requestSha256: encoded.sha256,
        maximumUnits: funding.maxTotalUnits,
      });
      validateOutputCoordinates(terminal, manifest.storageKey, outputRenditions);
    },
  });
  if (result.kind !== "settled" || !terminal) {
    const progressed = await deps.paidOperationRepo.recordProgress(operationId, claim, {
      status: result.kind,
      requestId: result.opened.requestId,
      locOperationId: result.opened.operationId,
      ...("brokerJobId" in result ? { brokerJobId: result.brokerJobId } : {}),
    });
    if (!progressed) throw new Error("paid ABR progress fence was lost");
    await deps.paidOperationRepo.recordRetry(operationId, {
      owner: deps.owner,
      version: progressed.lifecycleVersion,
      leaseExpiresAt,
    }, {
      status: result.kind,
      nextRetryAt: new Date(Date.now() + 1_000),
      errorCode: result.kind,
    });
    return;
  }
  const completed = terminal.renditions
    .filter((rendition) => rendition.video !== undefined)
    .map((rendition) => {
      const renditionId = renditionRows.get(rendition.name);
      if (!renditionId) throw new Error("terminal rendition was not requested");
      return { renditionId, storageKey: rendition.stream_uri, durationSeconds: probe.durationSec };
    });
  if (completed.length !== renditionRows.size) throw new Error("terminal rendition set is incomplete");
  const terminalAt = new Date();
  const recorded = await deps.paidOperationRepo.recordVodTerminal(operationId, claim, {
    assetId: asset.id,
    encodingJobId: job.id,
    playbackId: `pb_${randomBytes(12).toString("hex")}`,
    apiKeyId: asset.apiKeyId,
    locOperationId: result.opened.operationId,
    brokerJobId: result.settlement.brokerJobId,
    brokerRequestId: result.opened.requestId,
    claimedUnits: String(result.settlement.actualUnits),
    settlementSequence: "0",
    evidence: {
      httpStatus: result.brokerStatus ?? 200,
      responseSha256: createHash("sha256").update(result.brokerBody ?? new Uint8Array()).digest("hex"),
      workUnit: result.settlement.workUnit,
      workUnits: String(result.settlement.actualUnits),
      claimSignature: result.settlement.envelope.signature.value,
    },
    terminalAt,
    renditions: completed,
  });
  if (!recorded) throw new Error("paid ABR terminal fence was lost");
  deps.logger?.info("orchestrator.asset_ready", { asset_id: asset.id, operation_id: operationId });
}

async function destinations(storage: StorageProvider, assetId: string, name: string, codec = "h264") {
  const playlist = await storage.putSignedUploadUrl({
    assetId, kind: "rendition", resolution: name, codec,
    filename: "playlist.m3u8", contentType: "application/vnd.apple.mpegurl", expiresInSec: 86_400,
  });
  const stream = await storage.putSignedUploadUrl({
    assetId, kind: "rendition", resolution: name, codec,
    filename: "stream.mp4", contentType: "video/mp4", expiresInSec: 86_400,
  });
  return {
    playlist: { artifact_uri: playlist.storageKey, upload_url: playlist.url },
    stream: { artifact_uri: stream.storageKey, upload_url: stream.url },
  };
}

function paidRoute(route: SelectedWorkerRoute): PaidRouteSnapshot {
  if (!route.quoteId || !route.quoteVersion || !route.constraintFingerprint || !route.routeFingerprint || !route.unitsPerPrice || !route.settlementDomainId) {
    throw new Error("paid ABR route binding is incomplete");
  }
  const key = route.settlementKeys[0];
  if (!key) throw new Error("paid ABR settlement key is missing");
  return {
    protocol: "paid-job/v1",
    transport: "stream",
    capability: route.capability,
    offering: route.offering,
    requestDescriptor: ABR_REQUEST_SCHEMA,
    responseDescriptor: ABR_RESULT_SCHEMA,
    workUnit: route.workUnit,
    estimator: route.workUnitEstimator === null ? undefined : {
      id: route.workUnitEstimator.id,
      rounding: route.workUnitEstimator.rounding,
      exactness: route.workUnitEstimator.exactness,
      ...(route.workUnitEstimator.fixtures === undefined ? {} : { fixtures: route.workUnitEstimator.fixtures }),
      ...(route.workUnitEstimator.package === undefined ? {} : { package: route.workUnitEstimator.package }),
    },
    pricePerUnitWei: route.pricePerWorkUnitWei,
    unitsPerPrice: route.unitsPerPrice,
    quoteId: route.quoteId,
    quoteVersion: route.quoteVersion,
    constraintFingerprint: Buffer.from(route.constraintFingerprint).toString("hex"),
    routeFingerprint: Buffer.from(route.routeFingerprint).toString("hex"),
    settlementDomainId: route.settlementDomainId,
    settlementKey: key.publicKey,
    raw: {
      broker_url: route.workerUrl,
      eth_address: route.ethAddress,
      protocol: route.protocol,
      settlement_domain_id: route.settlementDomainId,
    },
  };
}

function validateOutputCoordinates(
  terminal: AbrTerminalResult,
  manifestStorageKey: string,
  requested: Record<string, {
    playlist: { artifact_uri: string };
    stream: { artifact_uri: string };
  }>,
): void {
  if (terminal.manifest_uri !== manifestStorageKey || terminal.renditions.length !== Object.keys(requested).length) {
    throw new Error("terminal output coordinates do not match the request");
  }
  for (const rendition of terminal.renditions) {
    const expected = requested[rendition.name];
    if (!expected || rendition.playlist_uri !== expected.playlist.artifact_uri || rendition.stream_uri !== expected.stream.artifact_uri) {
      throw new Error("terminal output coordinates do not match the request");
    }
  }
}
