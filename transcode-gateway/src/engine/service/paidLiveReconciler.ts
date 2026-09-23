import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import type {
  Logger,
  PaidSessionClient,
  PaidSessionControlEvent,
  PaidSessionControlHandle,
} from "../interfaces/index.js";
import { LocTransportError, PaidSessionClientError } from "../interfaces/index.js";
import type { JsonValue, PaidOperation, PaidOperationSecrets, SelectedWorkerRoute } from "../types/index.js";
import type { LiveStreamRepo, PlaybackIdRepo } from "../repo/index.js";
import type { OwnedPaidSession, PaidSessionStore } from "../../livepeer/paidSessionStore.js";
import { parsePaidSessionControlEvent } from "../../livepeer/paidSessionClient.js";
import { newRequestId as createRequestId } from "../../livepeer/requestId.js";
import type { LiveSessionDirectory } from "../../livepeer/liveSessionDirectory.js";

const storedContextWire = z.object({
  loc: z.object({
    control_handle: z.object({
      operation_id: z.string().min(1),
      broker_url: z.string().url(),
      gateway_session_id: z.string().uuid(),
      descriptor_schema: z.string().min(1),
      work_unit: z.string().min(1),
      settlement_domain_id: z.string().regex(/^0x[0-9a-f]{64}$/),
      max_total_units: z.number().int().positive(),
    }).strict(),
  }).passthrough(),
  control: z.object({ eventsWs: z.string().url() }).passthrough(),
  credentials: z.object({ broker_session_credential: z.string().min(1) }).passthrough(),
  refillIntent: z.object({
    request_id: z.string().min(1),
    observed_consumed_units: z.number().int().nonnegative(),
    max_total_units: z.number().int().positive(),
  }).strict().optional(),
}).passthrough();

type RefillIntent = NonNullable<z.infer<typeof storedContextWire>["refillIntent"]>;

const openingIntentWire = z.object({
  request_id: z.string().min(1),
  key_request_id: z.string().min(1),
  descriptor_schema: z.string().min(1),
  estimated_runway_units: z.number().int().positive(),
  max_total_units: z.number().int().positive(),
}).passthrough();
const sessionAxesWire = z.object({
  descriptorSchema: z.string().min(1),
  attachment: z.enum(["external", "inband-ws"]),
  metering: z.enum(["runner-reported", "broker-observed"]),
  refill: z.enum(["extensible", "bounded"]),
  heartbeat: z.object({ intervalSeconds: z.number().int().positive(), missedThreshold: z.number().int().positive() }),
  lease: z.object({ policy: z.enum(["funding-tracking", "fixed"]), maxSeconds: z.number().int().positive().optional() }),
  toleranceBandPct: z.number().nonnegative().optional(),
  runwayIncrementUnits: z.number().int().positive().optional(),
  sessionParamsSchema: z.record(z.string(), z.unknown()).optional(),
}).passthrough();
const recoveryRouteWire = z.object({
  worker_url: z.string().url(),
  eth_address: z.string().min(1),
  session: sessionAxesWire,
  settlement_keys: z.array(z.object({
    publicKey: z.string().min(1),
    notBefore: z.string(),
    expiresAt: z.string(),
    introducedInPublicationSeq: z.string(),
  })).min(1),
  work_unit_estimator: z.unknown().nullable(),
  settlement_domain_id: z.string().regex(/^0x[0-9a-f]{64}$/),
}).strict();
const recoveredRuntimeWire = z.object({
  rtmp_url: z.string().url(),
  hls_url: z.string().url(),
  key_issue_url: z.string().url(),
}).passthrough();
const initialCredentialsWire = z.object({ customer_stream_key: z.string().min(1) }).passthrough();
const sessionParamsWire = z.record(z.string(), z.json());

export interface PaidSessionControlSource {
  read(input: {
    eventsWs: string;
    credential: string;
    cursor?: string;
  }): Promise<unknown[]>;
}

export interface PaidLiveReconcilerDeps {
  paidSessionStore: PaidSessionStore;
  paidSessionClient: PaidSessionClient;
  controlSource?: PaidSessionControlSource;
  refillThresholdUnits: number;
  maxTotalUnits: number;
  maxRefills: number;
  disconnectGraceMs: number;
  liveSessions: LiveSessionDirectory;
  liveStreamRepo: LiveStreamRepo;
  playbackIdRepo: PlaybackIdRepo;
  logger?: Logger;
  now?: () => Date;
  newRequestId?: () => string;
}

export async function reconcilePaidLiveSessions(
  deps: PaidLiveReconcilerDeps,
  limit = 25,
): Promise<number> {
  const sessions = await deps.paidSessionStore.claimRecoverable(limit);
  await Promise.all(sessions.map((session) => reconcileOne(deps, session)));
  return sessions.length;
}

async function reconcileOne(
  deps: PaidLiveReconcilerDeps,
  initial: OwnedPaidSession,
): Promise<void> {
  let owned = initial;
  try {
    const secrets = await deps.paidSessionStore.readSecrets(owned);
    if (!secrets) return;
    const parsedContext = storedContextWire.safeParse(secrets);
    if (!parsedContext.success) {
      if (owned.operation.status === "opening" || owned.operation.status === "issuing_key") {
        await resumeOpeningSession(deps, owned, secrets);
        return;
      }
      throw new Error("paid session recovery context is unavailable");
    }
    const context = parsedContext.data;
    const handle = controlHandle(context.loc.control_handle);
    const brokerSessionId = owned.operation.brokerSessionId;
    const liveStreamId = owned.operation.liveStreamId;
    if (!brokerSessionId || !liveStreamId || context.loc.control_handle.work_unit !== owned.operation.route.workUnit) {
      throw new Error("paid session recovery identity is incomplete");
    }

    const clock = deps.now ?? (() => new Date());
    const now = clock();
    const runtimeAtStart = owned.operation.sessionRuntime!;
    const disconnectExpired = runtimeAtStart.relayDisconnectedAt !== undefined &&
      timestamp(runtimeAtStart.relayDisconnectedAt).getTime() + deps.disconnectGraceMs <= now.getTime();
    const leaseExpired = owned.operation.leaseExpiresAt !== undefined &&
      owned.operation.leaseExpiresAt.getTime() <= now.getTime();
    if (
      owned.operation.status === "winddown_requested" ||
      owned.operation.status === "winddown_pending" ||
      owned.operation.status === "winddown_retry" ||
      owned.operation.status === "winddown_failed" ||
      disconnectExpired ||
      leaseExpired
    ) {
      const reason = runtimeAtStart.winddownReason ??
        (leaseExpired ? "lease_exhausted" : runtimeAtStart.relayStatus === "failed" ? "relay_failure" :
          disconnectExpired ? "publisher_disconnect" : "broker_ended");
      await executeWinddown(deps, owned, handle, context.credentials.broker_session_credential, reason);
      return;
    }
    await repairLiveArtifacts(deps, owned.operation, secrets);

    if (context.refillIntent) {
      await executeRefill(deps, owned, secrets, context.refillIntent, handle, context.credentials.broker_session_credential);
      return;
    }

    if (deps.controlSource) {
      try {
        const frames = await deps.controlSource.read({
          eventsWs: context.control.eventsWs,
          credential: context.credentials.broker_session_credential,
          ...(owned.operation.sessionRuntime?.controlCursor
            ? { cursor: owned.operation.sessionRuntime.controlCursor }
            : {}),
        });
        for (const frame of frames) {
          const next = await applyAdvisoryEvent(deps, owned, parsePaidSessionControlEvent(frame));
          if (next) owned = next;
        }
        if (owned.operation.status === "winddown_pending") {
          await executeWinddown(
            deps,
            owned,
            handle,
            context.credentials.broker_session_credential,
            owned.operation.sessionRuntime?.winddownReason ?? "broker_ended",
          );
          return;
        }
      } catch {
        deps.logger?.warn("orchestrator.live_control_unavailable", { operation_id: owned.operation.id });
      }
    }

    const status = await deps.paidSessionClient.status({
      opened: handle,
      brokerSessionId,
      workId: owned.operation.workId,
      credential: context.credentials.broker_session_credential,
    });
    if (status.gatewaySessionId !== context.loc.control_handle.gateway_session_id) {
      throw new Error("paid session gateway identity drift");
    }
    const runtime = owned.operation.sessionRuntime!;
    const brokerTerminal = status.state === "closed" || status.state === "ended" || status.state === "failed";
    const brokerWindingDown = status.state === "winding_down";
    const authoritativeRunway = status.balance.runwayUnits ?? decimalUnits(owned.operation.balanceUnits ?? "0");
    const authoritativeFunded = status.balance.runwayUnits === null
      ? decimalUnits(owned.operation.fundedUnits)
      : status.balance.debitedUnits + status.balance.runwayUnits;
    const progressed = await deps.paidSessionStore.recordProgress(owned, {
      status: brokerTerminal
        ? "winddown_pending"
        : brokerWindingDown || runtime.relayDisconnectedAt ? "reconcile_pending" : "active",
      fundedUnits: String(authoritativeFunded),
      claimedUnits: String(status.claimedUnits),
      balanceUnits: String(authoritativeRunway),
      willRefuseNextRefill: status.balance.willRefuseNextRefill,
      leaseExpiresAt: timestamp(status.leaseExpiresAt),
      sessionRuntime: {
        ...runtime,
        lastHttpReconcileAt: clock().toISOString(),
        outputState: status.outputState,
        outputStateSince: status.outputStateSince ?? undefined,
        lastFailureCode: status.lastFailureCode ?? undefined,
        ...(brokerTerminal && status.closeReason ? { winddownReason: status.closeReason } : {}),
      },
    });
    if (!progressed) return;
    owned = progressed;
    if (brokerTerminal) {
      await executeWinddown(
        deps,
        owned,
        handle,
        context.credentials.broker_session_credential,
        status.closeReason ?? "broker_ended",
      );
      return;
    }
    if (brokerWindingDown) return;
    if (runtime.relayDisconnectedAt) return;

    const runway = status.balance.runwayUnits;
    const needsRefill = status.balance.status !== "ok" || (runway !== null && runway <= deps.refillThresholdUnits);
    if (!needsRefill) return;
    const refillCount = runtime.refillCount ?? 0;
    const fundedUnits = authoritativeFunded;
    if (
      status.balance.willRefuseNextRefill ||
      refillCount >= deps.maxRefills ||
      fundedUnits >= deps.maxTotalUnits
    ) {
      await requestWinddown(deps, owned, status.balance.willRefuseNextRefill ? "refill_preannounced_refusal" : "refill_policy_exhausted");
      return;
    }
    const intent: RefillIntent = {
      request_id: (deps.newRequestId ?? createRequestId)(),
      observed_consumed_units: status.balance.debitedUnits,
      max_total_units: Math.min(
        deps.maxTotalUnits,
        Math.max(status.balance.authorizationMaxUnits + 1, status.balance.authorizationMaxUnits * 2),
      ),
    };
    const persisted = await deps.paidSessionStore.putSecrets(owned, {
      ...secrets,
      refillIntent: intent as JsonValue,
    });
    if (!persisted) return;
    await executeRefill(deps, owned, { ...secrets, refillIntent: intent as JsonValue }, intent, handle, context.credentials.broker_session_credential);
  } catch (error) {
    await deps.paidSessionStore.recordProgress(owned, {
      status: owned.operation.status,
      ...retryProgress(owned.operation, error, deps.now),
    });
    deps.logger?.error("orchestrator.live_reconcile_failed", {
      operation_id: owned.operation.id,
      code: error instanceof PaidSessionClientError || error instanceof LocTransportError ? error.code : "reconcile_failed",
      ...(error instanceof LocTransportError ? { loc_operation: error.operation, upstream_status: error.status, remote_code: error.remoteCode } : {}),
    });
  } finally {
    const released = await deps.paidSessionStore.release(owned).catch(() => false);
    if (!released && owned.operation.liveStreamId) {
      const latest = await deps.paidSessionStore.claimByLiveStreamId(owned.operation.liveStreamId).catch(() => null);
      if (latest) await deps.paidSessionStore.release(latest).catch(() => false);
    }
  }
}

async function executeRefill(
  deps: PaidLiveReconcilerDeps,
  owned: OwnedPaidSession,
  secrets: PaidOperationSecrets,
  intent: RefillIntent,
  handle: PaidSessionControlHandle,
  credential: string,
): Promise<void> {
  const brokerSessionId = owned.operation.brokerSessionId!;
  try {
    const result = await deps.paidSessionClient.refill({
      opened: handle,
      brokerSessionId,
      credential,
      requestId: intent.request_id,
      observedConsumedUnits: intent.observed_consumed_units,
      maxTotalUnits: intent.max_total_units,
    });
    const fundedUnits = result.balance.authorizationMaxUnits;
    if (fundedUnits > deps.maxTotalUnits) {
      await requestWinddown(deps, owned, "refill_total_exceeded");
      return;
    }
    const cleared = { ...secrets };
    delete cleared.refillIntent;
    if (!await deps.paidSessionStore.putSecrets(owned, cleared)) return;
    await deps.paidSessionStore.recordProgress(owned, {
      status: "active",
      workId: result.workId,
      fundedUnits: String(fundedUnits),
      claimedUnits: String(result.balance.claimedUnits),
      balanceUnits: String(result.balance.runwayUnits ?? 0),
      willRefuseNextRefill: result.balance.willRefuseNextRefill,
      leaseExpiresAt: timestamp(result.leaseExpiresAt),
      sessionRuntime: {
        ...owned.operation.sessionRuntime!,
        refillCount: (owned.operation.sessionRuntime?.refillCount ?? 0) + 1,
      },
    });
  } catch (error) {
    if (error instanceof PaidSessionClientError && error.retryable) return;
    await requestWinddown(deps, owned, "refill_refused");
  }
}

async function applyAdvisoryEvent(
  deps: PaidLiveReconcilerDeps,
  owned: OwnedPaidSession,
  event: PaidSessionControlEvent,
): Promise<OwnedPaidSession | null> {
  const runtime = owned.operation.sessionRuntime!;
  if (event.type === "session.usage.tick") {
    if (event.unit !== owned.operation.route.workUnit || event.sequence <= Number(runtime.lastRunnerSequence)) return owned;
    return deps.paidSessionStore.recordProgress(owned, {
      status: owned.operation.status,
      claimedUnits: String(event.claimedTotal),
      sessionRuntime: {
        ...runtime,
        lastRunnerSequence: String(event.sequence),
        lastRunnerUsage: String(event.claimedTotal),
        controlCursor: String(event.sequence),
      },
    });
  }
  if (event.type === "session.balance") {
    return deps.paidSessionStore.recordProgress(owned, {
      status: owned.operation.status,
      claimedUnits: String(event.balance.claimedUnits),
      balanceUnits: String(event.balance.runwayUnits ?? 0),
      willRefuseNextRefill: event.balance.willRefuseNextRefill,
    });
  }
  if (event.type === "session.output.health") {
    return deps.paidSessionStore.recordProgress(owned, {
      status: owned.operation.status,
      sessionRuntime: {
        ...runtime,
        outputState: event.outputState,
        outputStateSince: event.outputStateSince,
        lastFailureCode: event.lastFailureCode ?? undefined,
      },
    });
  }
  if (event.type === "session.ended") {
    return deps.paidSessionStore.recordProgress(owned, {
      status: "winddown_pending",
      sessionRuntime: { ...runtime, winddownReason: event.closeReason },
    });
  }
  return owned;
}

async function resumeOpeningSession(
  deps: PaidLiveReconcilerDeps,
  initial: OwnedPaidSession,
  secrets: PaidOperationSecrets,
): Promise<void> {
  const intent = openingIntentWire.parse(secrets.openIntent);
  const routeIntent = recoveryRouteWire.parse(secrets.routeIntent);
  const sessionParams = sessionParamsWire.parse(secrets.sessionParams);
  const credentials = initialCredentialsWire.parse(secrets.credentials);
  const liveStreamId = initial.operation.liveStreamId;
  if (!liveStreamId) {
    throw new Error("paid session opening identity drift");
  }
  let owned = initial;
  const opened = await deps.paidSessionClient.open({
    requestId: intent.request_id,
    route: recoveryRoute(initial.operation, routeIntent),
    descriptorSchema: intent.descriptor_schema,
    sessionParams,
    estimatedRunwayUnits: intent.estimated_runway_units,
    maxTotalUnits: intent.max_total_units,
  });
  const runtime = recoveredRuntimeWire.parse(opened.runtimePublic);
  const grant = opened.grants.length === 1 &&
    opened.grants[0]?.operations.length === 1 &&
    opened.grants[0].operations[0] === "stream-key-issue"
    ? opened.grants[0]
    : null;
  if (!grant) throw new Error("recovered paid live grant is invalid");
  const progressed = await deps.paidSessionStore.recordProgress(owned, {
    status: "issuing_key",
    requestId: opened.opened.requestId,
    locOperationId: opened.opened.operationId,
    brokerSessionId: opened.brokerSessionId,
    fundedUnits: String(opened.balance.authorizationMaxUnits),
    claimedUnits: String(opened.balance.claimedUnits),
    balanceUnits: String(opened.balance.runwayUnits ?? 0),
    willRefuseNextRefill: opened.balance.willRefuseNextRefill,
    leaseExpiresAt: timestamp(opened.leaseExpiresAt),
    sessionRuntime: {
      ...owned.operation.sessionRuntime!,
      runnerHlsUrl: runtime.hls_url,
    },
  });
  if (!progressed) return;
  owned = progressed;
  const issued = await deps.paidSessionClient.issueStreamKey({
    keyIssueUrl: runtime.key_issue_url,
    grant,
    requestId: intent.key_request_id,
    audience: "gateway-relay",
  });
  const recoveredSecrets: PaidOperationSecrets = {
    ...secrets,
    grants: opened.grants as unknown as JsonValue,
    control: opened.control as unknown as JsonValue,
    loc: {
      idempotency_key: intent.request_id,
      key_request_id: intent.key_request_id,
      control_handle: {
        operation_id: opened.opened.operationId,
        broker_url: opened.opened.brokerUrl,
        gateway_session_id: opened.gatewaySessionId,
        descriptor_schema: opened.opened.session.descriptorSchema,
        work_unit: opened.opened.routeSnapshot.workUnit,
        settlement_domain_id: opened.opened.routeSnapshot.settlementDomainId,
        max_total_units: opened.balance.authorizationMaxUnits,
      },
    },
    runnerIngestUrl: runtime.rtmp_url,
    runnerIngestKey: issued.streamKey,
    credentials: {
      ...credentials,
      broker_session_credential: opened.credential,
    },
  };
  if (!await deps.paidSessionStore.putSecrets(owned, recoveredSecrets)) return;
  const active = await deps.paidSessionStore.recordProgress(owned, {
    status: "active",
    sessionRuntime: {
      ...owned.operation.sessionRuntime!,
      relayStatus: "pending",
    },
  });
  if (!active) return;
  await repairLiveArtifacts(deps, active.operation, recoveredSecrets);
  deps.logger?.info("orchestrator.live_open_recovered", {
    operation_id: active.operation.id,
    stream_id: liveStreamId,
  });
}

async function repairLiveArtifacts(
  deps: PaidLiveReconcilerDeps,
  operation: PaidOperation,
  secrets: PaidOperationSecrets,
): Promise<void> {
  const context = storedContextWire.parse(secrets);
  const credentials = initialCredentialsWire.parse(secrets.credentials);
  if (
    !operation.liveStreamId ||
    !operation.brokerSessionId ||
    !operation.sessionRuntime?.runnerHlsUrl ||
    !secrets.runnerIngestUrl ||
    !secrets.runnerIngestKey
  ) throw new Error("paid live activation artifacts are incomplete");
  if (
    operation.sessionRuntime.relayStatus !== "reconnecting" &&
    operation.sessionRuntime.relayStatus !== "failed"
  ) {
    await deps.liveStreamRepo.updateStatus(operation.liveStreamId, "active", {
      sessionId: operation.brokerSessionId,
      workerUrl: context.loc.control_handle.broker_url,
      lastSeenAt: new Date(),
    });
  }
  const playback = await deps.playbackIdRepo.byLiveStream(operation.liveStreamId);
  if (playback.length === 0) {
    await deps.playbackIdRepo.insert({
      id: `pb_${randomBytes(12).toString("hex")}`,
      apiKeyId: operation.apiKeyId,
      liveStreamId: operation.liveStreamId,
      policy: "public",
      tokenRequired: false,
    });
  }
  deps.liveSessions.record({
    streamId: operation.liveStreamId,
    sessionId: operation.brokerSessionId,
    brokerUrl: context.loc.control_handle.broker_url,
    brokerRtmpUrl: `${secrets.runnerIngestUrl.replace(/\/$/, "")}/${secrets.runnerIngestKey}`,
    streamKey: credentials.customer_stream_key,
    hlsPlaybackUrl: operation.sessionRuntime.runnerHlsUrl,
  });
}

function recoveryRoute(
  operation: PaidOperation,
  value: z.infer<typeof recoveryRouteWire>,
): SelectedWorkerRoute {
  return {
    workerUrl: value.worker_url,
    ethAddress: value.eth_address,
    capability: operation.route.capability as SelectedWorkerRoute["capability"],
    offering: operation.route.offering,
    pricePerWorkUnitWei: operation.route.pricePerUnitWei,
    unitsPerPrice: operation.route.unitsPerPrice,
    workUnit: operation.route.workUnit,
    protocol: "paid-session/v1",
    job: null,
    session: value.session,
    workUnitEstimator: value.work_unit_estimator as SelectedWorkerRoute["workUnitEstimator"],
    settlementKeys: value.settlement_keys,
    settlementDomainId: operation.route.settlementDomainId ?? value.settlement_domain_id,
    quoteId: operation.route.quoteId,
    quoteVersion: operation.route.quoteVersion,
    constraintFingerprint: Buffer.from(operation.route.constraintFingerprint, "hex"),
    routeFingerprint: Buffer.from(operation.route.routeFingerprint, "hex"),
  };
}

async function requestWinddown(
  deps: PaidLiveReconcilerDeps,
  owned: OwnedPaidSession,
  reason: string,
): Promise<void> {
  await deps.paidSessionStore.recordProgress(owned, {
    status: "winddown_requested",
    willRefuseNextRefill: true,
    sessionRuntime: {
      ...owned.operation.sessionRuntime!,
      winddownReason: reason,
    },
  });
  deps.logger?.warn("orchestrator.live_winddown_requested", {
    operation_id: owned.operation.id,
    reason,
  });
}

async function executeWinddown(
  deps: PaidLiveReconcilerDeps,
  owned: OwnedPaidSession,
  handle: PaidSessionControlHandle,
  credential: string,
  reason: string,
): Promise<void> {
  const liveStreamId = owned.operation.liveStreamId!;
  const brokerSessionId = owned.operation.brokerSessionId!;
  try {
    const result = await deps.paidSessionClient.end({
      opened: handle,
      gatewaySessionId: handle.gatewaySessionId,
      brokerSessionId,
      credential,
      reason,
    });
    const recorded = await deps.paidSessionStore.recordLiveTerminal(owned, {
      liveStreamId,
      claimedUnits: String(result.actualUnits),
      settlementSequence: String(result.settlementSequence),
      evidence: {
        httpStatus: 200,
        responseSha256: createHash("sha256")
          .update(JSON.stringify(result.envelope))
          .digest("hex"),
        workUnit: owned.operation.route.workUnit,
        workUnits: String(result.actualUnits),
        claimSignature: result.envelope.signature.value,
        closeReason: result.closeReason || reason,
      },
      terminalAt: (deps.now ?? (() => new Date()))(),
    });
    if (!recorded) return;
    deps.liveSessions.remove(brokerSessionId);
    deps.logger?.info("orchestrator.live_settled", {
      operation_id: owned.operation.id,
      stream_id: liveStreamId,
      reason: result.closeReason || reason,
    });
  } catch (error) {
    const typed = error instanceof PaidSessionClientError ? error : null;
    await deps.paidSessionStore.recordProgress(owned, {
      status: typed?.code === "paid_session_close_pending" ? "winddown_pending"
        : typed?.retryable === false ? "winddown_failed" : "winddown_retry",
      ...retryProgress(owned.operation, error, deps.now),
      sessionRuntime: {
        ...owned.operation.sessionRuntime!,
        winddownReason: reason,
      },
    });
    deps.logger?.error("orchestrator.live_winddown_failed", {
      operation_id: owned.operation.id,
      code: typed?.code ?? "winddown_failed",
    });
  }
}

function controlHandle(value: z.infer<typeof storedContextWire>["loc"]["control_handle"]): PaidSessionControlHandle {
  return {
    operationId: value.operation_id,
    brokerUrl: value.broker_url,
    gatewaySessionId: value.gateway_session_id,
    descriptorSchema: value.descriptor_schema,
    workUnit: value.work_unit,
    settlementDomainId: value.settlement_domain_id,
    maxTotalUnits: value.max_total_units,
  };
}

function timestamp(value: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("paid session timestamp is invalid");
  return date;
}

function decimalUnits(value: string): number {
  const parsed = /^(?:0|[1-9][0-9]*)$/.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error("paid session units are invalid");
  return parsed;
}

function retryProgress(operation: PaidOperation, error: unknown, now = () => new Date()) {
  const retryCount = operation.retryCount + 1;
  const code = error instanceof PaidSessionClientError ? error.code
    : error instanceof LocTransportError ? error.remoteCode ?? error.code : "reconcile_failed";
  const delaySeconds = error instanceof LocTransportError && error.retryAfterSeconds !== undefined
    ? Math.max(5, error.retryAfterSeconds) : Math.min(60, 5 * 2 ** Math.min(retryCount - 1, 4));
  return { retryCount, lastErrorCode: code, nextRetryAt: new Date(now().getTime() + delaySeconds * 1000) };
}
