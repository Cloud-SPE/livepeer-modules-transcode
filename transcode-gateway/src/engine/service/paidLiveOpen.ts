import { createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import type { Logger, PaidSessionClient } from "../interfaces/index.js";
import type { LiveStreamRepo, PlaybackIdRepo } from "../repo/index.js";
import type { EncodingTier, JsonValue, PaidRouteSnapshot, SelectedWorkerRoute } from "../types/index.js";
import type { LiveSessionDirectory } from "../../livepeer/liveSessionDirectory.js";
import { newRequestId } from "../../livepeer/requestId.js";
import type { PaidSessionStore } from "../../livepeer/paidSessionStore.js";

const RUNTIME_SCHEMA = "rtmp-hls/v1";
const PARAMS_SCHEMA = "rtmp-hls-session/v1";
const WORK_UNIT = "output_seconds";
const runtimePublicWire = z.object({
  rtmp_url: z.string().url(),
  hls_url: z.string().url(),
  key_issue_url: z.string().url(),
  status_url: z.string().url().optional(),
}).strict();

export interface PaidLiveOpenDeps {
  liveStreamRepo: LiveStreamRepo;
  playbackIdRepo: PlaybackIdRepo;
  paidSessionStore: PaidSessionStore;
  paidSessionClient: PaidSessionClient;
  liveSessions: LiveSessionDirectory;
  gatewayRtmpUrl: string;
  estimatedRunwayUnits: number;
  maxTotalUnits: number;
  logger?: Logger;
}

export interface PaidLiveOpenInput {
  streamId: string;
  apiKeyId: string;
  name: string;
  encodingTier: EncodingTier;
  route: SelectedWorkerRoute;
}

export async function openPaidLiveStream(deps: PaidLiveOpenDeps, input: PaidLiveOpenInput) {
  validateRoute(input.route);
  const customerStreamKey = `live_${randomBytes(24).toString("hex")}`;
  const requestId = newRequestId();
  const keyRequestId = newRequestId();
  const sessionParams = {
    schema: PARAMS_SCHEMA,
    publisher_mode: "gateway-relay",
    output_profile: "live-standard",
    metering_rendition: "720p",
    storage: { kind: "runner-local" },
  } as const;
  const openIntent = {
    gateway_session_id: input.streamId,
    request_id: requestId,
    key_request_id: keyRequestId,
    descriptor_schema: RUNTIME_SCHEMA,
    session_params: sessionParams,
    estimated_runway_units: deps.estimatedRunwayUnits,
    max_total_units: deps.maxTotalUnits,
  };
  const requestContentSha256 = createHash("sha256")
    .update(JSON.stringify(openIntent))
    .digest("hex");
  await deps.liveStreamRepo.insert({
    id: input.streamId,
    apiKeyId: input.apiKeyId,
    name: input.name,
    streamKeyHash: createHash("sha256").update(customerStreamKey).digest("hex"),
    status: "idle",
    ingestProtocol: "rtmp",
    selectedCapability: "video:live.rtmp",
    selectedOffering: input.route.offering,
    selectedWorkUnit: input.route.workUnit,
    selectedPricePerWorkUnitWei: input.route.pricePerWorkUnitWei,
  });
  let owned = await deps.paidSessionStore.create({
    id: randomUUID(),
    kind: "session",
    apiKeyId: input.apiKeyId,
    liveStreamId: input.streamId,
    requestId: `pending:${requestId}`,
    requestContentSha256,
    workId: `pending:${requestId}`,
    route: paidRoute(input.route),
    status: "opening",
    fundedUnits: String(deps.estimatedRunwayUnits),
    sessionRuntime: {
      publisherMode: "gateway-relay",
      relayStatus: "pending",
      relayGeneration: 0,
      lastRunnerSequence: "0",
      lastRunnerUsage: "0",
    },
  }, {
    openIntent: openIntent as JsonValue,
    sessionParams,
    loc: { idempotency_key: requestId, key_request_id: keyRequestId },
    credentials: { customer_stream_key: customerStreamKey },
  });
  const opened = await deps.paidSessionClient.open({
    gatewaySessionId: input.streamId,
    requestId,
    route: input.route,
    descriptorSchema: RUNTIME_SCHEMA,
    sessionParams,
    estimatedRunwayUnits: deps.estimatedRunwayUnits,
    maxTotalUnits: deps.maxTotalUnits,
  });
  const runtime = runtimePublicWire.parse(opened.runtimePublic);
  const grant = opened.grants.length === 1 && opened.grants[0]?.operations.length === 1 && opened.grants[0].operations[0] === "stream-key-issue"
    ? opened.grants[0]
    : null;
  if (!grant) throw new Error("paid live stream-key grant is invalid");
  const progressed = await deps.paidSessionStore.recordProgress(owned, {
    status: "issuing_key",
    requestId: opened.opened.requestId,
    locOperationId: opened.opened.operationId,
    brokerSessionId: opened.brokerSessionId,
    fundedUnits: String(deps.estimatedRunwayUnits),
    claimedUnits: String(opened.balance.claimedUnits),
    balanceUnits: String(opened.balance.runwayUnits ?? Math.max(0, deps.estimatedRunwayUnits - opened.balance.debitedUnits)),
    willRefuseNextRefill: opened.balance.willRefuseNextRefill,
    leaseExpiresAt: timestamp(opened.leaseExpiresAt),
    sessionRuntime: {
      ...owned.operation.sessionRuntime!,
      runnerHlsUrl: runtime.hls_url,
    },
  });
  if (!progressed) throw new Error("paid live open fence was lost");
  owned = progressed;
  const issued = await deps.paidSessionClient.issueStreamKey({
    keyIssueUrl: runtime.key_issue_url,
    grant,
    requestId: keyRequestId,
    audience: "gateway-relay",
  });
  const secretsStored = await deps.paidSessionStore.putSecrets(owned, {
    openIntent: openIntent as JsonValue,
    sessionParams,
    grants: opened.grants as unknown as JsonValue,
    control: opened.control as unknown as JsonValue,
    loc: {
      idempotency_key: requestId,
      key_request_id: keyRequestId,
      control_handle: {
        operation_id: opened.opened.operationId,
        broker_url: opened.opened.brokerUrl,
        descriptor_schema: opened.opened.session.descriptorSchema,
        work_unit: opened.opened.routeSnapshot.workUnit,
        max_rotations: opened.opened.session.maxRotations,
      },
    },
    runnerIngestUrl: runtime.rtmp_url,
    runnerIngestKey: issued.streamKey,
    credentials: {
      customer_stream_key: customerStreamKey,
      broker_session_credential: opened.credential,
    },
  });
  if (!secretsStored) throw new Error("paid live secrets fence was lost");
  const active = await deps.paidSessionStore.recordProgress(owned, {
    status: "active",
    sessionRuntime: { ...owned.operation.sessionRuntime!, relayStatus: "pending" },
  });
  if (!active) throw new Error("paid live activation fence was lost");
  await deps.liveStreamRepo.updateStatus(input.streamId, "active", {
    sessionId: opened.brokerSessionId,
    workerUrl: input.route.workerUrl,
    lastSeenAt: new Date(),
  });
  const playback = await deps.playbackIdRepo.insert({
    id: `pb_${randomBytes(12).toString("hex")}`,
    apiKeyId: input.apiKeyId,
    liveStreamId: input.streamId,
    policy: "public",
    tokenRequired: false,
  });
  deps.liveSessions.record({
    streamId: input.streamId,
    sessionId: opened.brokerSessionId,
    brokerUrl: input.route.workerUrl,
    brokerRtmpUrl: `${runtime.rtmp_url.replace(/\/$/, "")}/${issued.streamKey}`,
    streamKey: customerStreamKey,
    hlsPlaybackUrl: runtime.hls_url,
  });
  deps.logger?.info("orchestrator.live_active", {
    stream_id: input.streamId,
    operation_id: active.operation.id,
    broker_session_id: opened.brokerSessionId,
  });
  return {
    streamId: input.streamId,
    brokerSessionId: opened.brokerSessionId,
    streamKey: customerStreamKey,
    rtmpPushUrl: `${deps.gatewayRtmpUrl.replace(/\/$/, "")}/${customerStreamKey}`,
    hlsPlaybackUrl: runtime.hls_url,
    playbackId: playback.id,
    expiresAt: opened.leaseExpiresAt,
    requestId: opened.opened.requestId,
  };
}

function validateRoute(route: SelectedWorkerRoute): void {
  if (
    route.protocol !== "paid-session/v1" ||
    route.session?.descriptorSchema !== RUNTIME_SCHEMA ||
    route.session.attachment !== "external" ||
    route.session.refill !== "extensible" ||
    route.workUnit !== WORK_UNIT
  ) throw new Error("paid live route is incompatible");
}

function paidRoute(route: SelectedWorkerRoute): PaidRouteSnapshot {
  if (!route.quoteId || !route.quoteVersion || !route.constraintFingerprint || !route.routeFingerprint || !route.unitsPerPrice) {
    throw new Error("paid live route binding is incomplete");
  }
  const key = route.settlementKeys[0];
  if (!key) throw new Error("paid live settlement key is missing");
  return {
    protocol: "paid-session/v1",
    capability: route.capability,
    offering: route.offering,
    requestDescriptor: PARAMS_SCHEMA,
    responseDescriptor: RUNTIME_SCHEMA,
    workUnit: route.workUnit,
    pricePerUnitWei: route.pricePerWorkUnitWei,
    unitsPerPrice: route.unitsPerPrice,
    quoteId: route.quoteId,
    quoteVersion: route.quoteVersion,
    constraintFingerprint: Buffer.from(route.constraintFingerprint).toString("hex"),
    routeFingerprint: Buffer.from(route.routeFingerprint).toString("hex"),
    settlementKey: key.publicKey,
    raw: { broker_url: route.workerUrl, eth_address: route.ethAddress, protocol: route.protocol },
  };
}

function timestamp(value: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error("paid live lease is invalid");
  return parsed;
}
