import { createHash } from "node:crypto";
import { z } from "zod";
import type {
  Logger,
  PaidSessionClient,
  PaidSessionControlEvent,
  PaidSessionControlHandle,
} from "../interfaces/index.js";
import { PaidSessionClientError } from "../interfaces/index.js";
import type { JsonValue, PaidOperationSecrets } from "../types/index.js";
import type { OwnedPaidSession, PaidSessionStore } from "../../livepeer/paidSessionStore.js";
import { parsePaidSessionControlEvent } from "../../livepeer/paidSessionClient.js";
import { newRequestId as createRequestId } from "../../livepeer/requestId.js";
import type { LiveSessionDirectory } from "../../livepeer/liveSessionDirectory.js";

const storedContextWire = z.object({
  loc: z.object({
    control_handle: z.object({
      operation_id: z.string().min(1),
      broker_url: z.string().url(),
      descriptor_schema: z.string().min(1),
      work_unit: z.string().min(1),
      max_rotations: z.number().int().nonnegative(),
    }).strict(),
  }).passthrough(),
  control: z.object({ eventsWs: z.string().url() }).passthrough(),
  credentials: z.object({ broker_session_credential: z.string().min(1) }).passthrough(),
  refillIntent: z.object({
    request_id: z.string().min(1),
    observed_consumed_units: z.number().int().nonnegative(),
    rebind_from: z.string().min(1).optional(),
    replaces_request_id: z.string().min(1).optional(),
  }).strict().optional(),
}).passthrough();

type RefillIntent = NonNullable<z.infer<typeof storedContextWire>["refillIntent"]>;

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
    const context = storedContextWire.parse(secrets);
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
      disconnectExpired ||
      leaseExpired
    ) {
      const reason = runtimeAtStart.winddownReason ??
        (leaseExpired ? "lease_exhausted" : runtimeAtStart.relayStatus === "failed" ? "relay_failure" :
          disconnectExpired ? "publisher_disconnect" : "broker_ended");
      await executeWinddown(deps, owned, handle, context.credentials.broker_session_credential, reason);
      return;
    }

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
    if (status.gatewaySessionId !== liveStreamId) {
      throw new Error("paid session gateway identity drift");
    }
    const runtime = owned.operation.sessionRuntime!;
    const authoritativeRunway = status.balance.runwayUnits ?? decimalUnits(owned.operation.balanceUnits ?? "0");
    const authoritativeFunded = status.balance.runwayUnits === null
      ? decimalUnits(owned.operation.fundedUnits)
      : status.balance.debitedUnits + status.balance.runwayUnits;
    const progressed = await deps.paidSessionStore.recordProgress(owned, {
      status: status.state === "closed"
        ? "winddown_pending"
        : runtime.relayDisconnectedAt ? "reconcile_pending" : "active",
      fundedUnits: String(authoritativeFunded),
      claimedUnits: String(status.claimedUnits),
      balanceUnits: String(authoritativeRunway),
      willRefuseNextRefill: status.balance.willRefuseNextRefill,
      leaseExpiresAt: timestamp(status.leaseExpiresAt),
      sessionRuntime: { ...runtime, lastHttpReconcileAt: clock().toISOString() },
    });
    if (!progressed) return;
    owned = progressed;
    if (status.state === "closed") {
      await executeWinddown(
        deps,
        owned,
        handle,
        context.credentials.broker_session_credential,
        status.closeReason ?? "broker_ended",
      );
      return;
    }
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
    };
    const persisted = await deps.paidSessionStore.putSecrets(owned, {
      ...secrets,
      refillIntent: intent as JsonValue,
    });
    if (!persisted) return;
    await executeRefill(deps, owned, { ...secrets, refillIntent: intent as JsonValue }, intent, handle, context.credentials.broker_session_credential);
  } catch (error) {
    deps.logger?.error("orchestrator.live_reconcile_failed", {
      operation_id: owned.operation.id,
      code: error instanceof PaidSessionClientError ? error.code : "reconcile_failed",
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
      ...(intent.rebind_from
        ? { rebindFrom: intent.rebind_from, replacesRequestId: intent.replaces_request_id! }
        : {}),
    });
    const fundedUnits = result.balance.debitedUnits + (result.balance.runwayUnits ?? 0);
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
      rotationGeneration: intent.rebind_from
        ? owned.operation.rotationGeneration + 1
        : owned.operation.rotationGeneration,
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
    const code = error instanceof PaidSessionClientError ? error.code.toLowerCase() : "";
    if (
      error instanceof PaidSessionClientError &&
      (code === "recipient_rotated" || code === "invalid_recipient_rand") &&
      !intent.rebind_from
    ) {
      const maxRotations = storedContextWire.parse(secrets).loc.control_handle.max_rotations;
      if (owned.operation.rotationGeneration >= maxRotations) {
        await requestWinddown(deps, owned, "rotation_limit_exhausted");
        return;
      }
      const rebind: RefillIntent = {
        request_id: (deps.newRequestId ?? createRequestId)(),
        observed_consumed_units: intent.observed_consumed_units,
        rebind_from: owned.operation.workId,
        replaces_request_id: intent.request_id,
      };
      if (!await deps.paidSessionStore.putSecrets(owned, { ...secrets, refillIntent: rebind as JsonValue })) return;
      await executeRefill(deps, owned, { ...secrets, refillIntent: rebind as JsonValue }, rebind, handle, credential);
      return;
    }
    if (error instanceof PaidSessionClientError && error.retryable) return;
    await requestWinddown(deps, owned, intent.rebind_from ? "rotation_unrecoverable" : "refill_refused");
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
  if (event.type === "session.ended") {
    return deps.paidSessionStore.recordProgress(owned, {
      status: "winddown_pending",
      sessionRuntime: { ...runtime, winddownReason: event.closeReason },
    });
  }
  return owned;
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
      gatewaySessionId: liveStreamId,
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
      status: typed?.retryable === false ? "winddown_failed" : "winddown_retry",
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
    descriptorSchema: value.descriptor_schema,
    workUnit: value.work_unit,
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
