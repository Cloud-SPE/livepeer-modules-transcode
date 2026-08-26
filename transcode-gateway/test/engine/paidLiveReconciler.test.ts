import assert from "node:assert/strict";
import { test } from "node:test";
import type { PaidSessionClient } from "../../src/engine/interfaces/index.js";
import { PaidSessionClientError } from "../../src/engine/interfaces/index.js";
import type { PaidOperationProgress } from "../../src/engine/repo/index.js";
import type { PaidOperation, PaidOperationSecrets } from "../../src/engine/types/index.js";
import { reconcilePaidLiveSessions, type PaidLiveReconcilerDeps } from "../../src/engine/service/paidLiveReconciler.js";
import type { OwnedPaidSession, PaidSessionStore } from "../../src/livepeer/paidSessionStore.js";

const now = new Date("2026-08-26T12:00:00Z");
const handle = {
  operation_id: "loc-operation-1",
  broker_url: "https://broker.example",
  descriptor_schema: "rtmp-hls/v1",
  work_unit: "output_seconds",
  max_rotations: 3,
};

function operation(overrides: Partial<PaidOperation> = {}): PaidOperation {
  return {
    id: "operation-1", kind: "session", apiKeyId: "api-key-1", liveStreamId: "live-1",
    requestId: "request-1", requestContentSha256: "a".repeat(64), workId: "work-1",
    rotationGeneration: 0,
    route: {
      protocol: "paid-session/v1", capability: "video:live.rtmp", offering: "live-standard",
      requestDescriptor: "rtmp-hls-session/v1", responseDescriptor: "rtmp-hls/v1",
      workUnit: "output_seconds", pricePerUnitWei: "1", unitsPerPrice: "1",
      quoteId: "quote-1", quoteVersion: "1", constraintFingerprint: "constraint-1",
      routeFingerprint: "route-1", settlementKey: "settlement-1", raw: {},
    },
    status: "active", locOperationId: "loc-operation-1", brokerSessionId: "broker-session-1",
    fundedUnits: "60", claimedUnits: "50", balanceUnits: "10", willRefuseNextRefill: false,
    leaseExpiresAt: new Date("2026-08-26T12:01:00Z"), settlementSequence: "0",
    lifecycleVersion: "1", recoveryOwner: "gateway-1",
    recoveryLeaseExpiresAt: new Date("2030-01-01T00:00:00Z"),
    sessionRuntime: {
      publisherMode: "gateway-relay", relayStatus: "active", relayGeneration: 1,
      lastRunnerSequence: "0", lastRunnerUsage: "0", refillCount: 0,
    },
    retryCount: 0, createdAt: now, updatedAt: now,
    ...overrides,
  };
}

function baseSecrets(refillIntent?: PaidOperationSecrets["refillIntent"]): PaidOperationSecrets {
  return {
    loc: { control_handle: handle },
    control: { eventsWs: "wss://broker.example/events" },
    credentials: { broker_session_credential: "broker-secret" },
    runnerIngestUrl: "rtmps://runner.example/ingest",
    runnerIngestKey: "runner-secret",
    ...(refillIntent === undefined ? {} : { refillIntent }),
  };
}

function harness(options: {
  operation?: PaidOperation;
  secrets?: PaidOperationSecrets;
  client: Partial<PaidSessionClient>;
  controlSource?: PaidLiveReconcilerDeps["controlSource"];
}) {
  let currentOperation = options.operation ?? operation();
  let secrets = options.secrets ?? baseSecrets();
  let version = Number(currentOperation.lifecycleVersion);
  const calls: string[] = [];
  const secretWrites: PaidOperationSecrets[] = [];
  const owned = (): OwnedPaidSession => ({
    operation: currentOperation,
    claim: {
      owner: "gateway-1",
      version: currentOperation.lifecycleVersion,
      leaseExpiresAt: currentOperation.recoveryLeaseExpiresAt!,
    },
  });
  const store = new Proxy({
    async claimRecoverable() { calls.push("claim"); return [owned()]; },
    async claimByLiveStreamId() { return owned(); },
    async readSecrets() { calls.push("read-secrets"); return secrets; },
    async putSecrets(_value: OwnedPaidSession, value: PaidOperationSecrets) {
      calls.push("put-secrets"); secrets = value; secretWrites.push(value); return true;
    },
    async recordProgress(_value: OwnedPaidSession, progress: PaidOperationProgress) {
      calls.push(`progress:${progress.status}`);
      version += 1;
      currentOperation = {
        ...currentOperation,
        ...progress,
        lifecycleVersion: String(version),
        sessionRuntime: progress.sessionRuntime ?? currentOperation.sessionRuntime,
      };
      return owned();
    },
    async recordLiveTerminal(_value: OwnedPaidSession, terminal: {
      claimedUnits: string; settlementSequence: string; evidence: PaidOperation["terminalEvidence"]; terminalAt: Date;
    }) {
      calls.push("terminal");
      version += 1;
      currentOperation = {
        ...currentOperation,
        status: "settled",
        claimedUnits: terminal.claimedUnits,
        settlementSequence: terminal.settlementSequence,
        terminalEvidence: terminal.evidence,
        terminalAt: terminal.terminalAt,
        lifecycleVersion: String(version),
      };
      return true;
    },
    async release() { calls.push("release"); return true; },
  } as Partial<PaidSessionStore>, {
    get(target, property) {
      const value = target[property as keyof typeof target];
      if (value) return value;
      return async () => { throw new Error(`unexpected store call: ${String(property)}`); };
    },
  }) as PaidSessionStore;
  const client = new Proxy(options.client as PaidSessionClient, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver) as unknown;
      if (value) return value;
      return async () => { throw new Error(`unexpected client call: ${String(property)}`); };
    },
  });
  const deps: PaidLiveReconcilerDeps = {
    paidSessionStore: store,
    paidSessionClient: client,
    refillThresholdUnits: 15,
    maxTotalUnits: 3_600,
    maxRefills: 60,
    disconnectGraceMs: 15_000,
    liveSessions: {
      record() {}, get() { return null; }, getByStreamId() { return null; },
      remove() { calls.push("cache-remove"); },
    },
    newRequestId: (() => {
      let id = 0;
      return () => `refill-${++id}`;
    })(),
    ...(options.controlSource ? { controlSource: options.controlSource } : {}),
  };
  return { deps, calls, secretWrites, operation: () => currentOperation, secrets: () => secrets };
}

function lowStatus(willRefuseNextRefill = false) {
  return {
    brokerSessionId: "broker-session-1", gatewaySessionId: "live-1", workId: "work-1",
    state: "active", runtimeSchema: "rtmp-hls/v1", runtimePublic: {},
    claimedUnits: 50, workUnit: "output_seconds", leaseExpiresAt: "2026-08-26T12:02:00Z",
    balance: {
      claimedUnits: 50, debitedUnits: 50, unit: "output_seconds", runwayUnits: 10,
      runwaySecondsEstimate: 10, status: "low" as const, willRefuseNextRefill,
    },
    closeReason: null,
  };
}

function acceptedRefill(workId = "work-1") {
  return {
    loc: {
      workId, requestId: "refill-1", refillSequence: 1, paymentEnvelope: "payment",
      fundedValueWei: 1, capStatus: {
        sessionPctUsed: 1, spendPeriodPctUsed: null, userBalancePctUsed: null,
        operatorPoolPctUsed: null, willRefuseNextRefill: false, winddownReason: null,
      }, rebindFrom: null,
    },
    brokerSessionId: "broker-session-1", workId,
    leaseExpiresAt: "2026-08-26T12:03:00Z",
    balance: {
      claimedUnits: 50, debitedUnits: 50, unit: "output_seconds", runwayUnits: 70,
      runwaySecondsEstimate: 70, status: "ok" as const, willRefuseNextRefill: false,
    },
  };
}

function settledEnd(closeReason = "customer_end") {
  return {
    brokerSessionId: "broker-session-1", workId: "work-1", state: "closed",
    closeReason, settlementSequence: 2, actualUnits: 55, outcome: "EXACT",
    envelope: {
      payload: { actual_units: "55" },
      signature: {
        algorithm: "secp256k1" as const,
        canonicalization: "jcs" as const,
        value: `0x${"44".repeat(65)}`,
      },
    },
    accounting: {
      operationId: "loc-operation-1", workId: "work-1", actualUnits: 55,
      billedValueWei: 55, refundWei: 5, outcome: "EXACT",
      closedAt: "2026-08-26T12:04:00Z",
    },
  };
}

test("low balance persists the refill identity before funding and advances lease only after acceptance", async () => {
  const order: string[] = [];
  const h = harness({
    client: {
      async status() { return lowStatus(); },
      async refill(input) { order.push(`network:${input.requestId}`); return acceptedRefill(); },
    },
  });
  const originalPut = h.deps.paidSessionStore.putSecrets.bind(h.deps.paidSessionStore);
  h.deps.paidSessionStore.putSecrets = async (...args) => { order.push("persist"); return originalPut(...args); };

  await reconcilePaidLiveSessions(h.deps);

  assert.deepEqual(order.slice(0, 2), ["persist", "network:refill-1"]);
  assert.equal(h.operation().fundedUnits, "120");
  assert.equal(h.operation().leaseExpiresAt?.toISOString(), "2026-08-26T12:03:00.000Z");
  assert.equal(h.operation().sessionRuntime?.refillCount, 1);
  assert.equal(h.secrets().refillIntent, undefined);
});

test("an ambiguous refill remains durable and replays the exact identity without another status decision", async () => {
  const attempted: string[] = [];
  const pending = { request_id: "stable-refill", observed_consumed_units: 50 };
  const h = harness({
    secrets: baseSecrets(pending),
    client: {
      async status() { throw new Error("status must not run while refill is pending"); },
      async refill(input) {
        attempted.push(input.requestId);
        throw new PaidSessionClientError("backend_timeout", { retryable: true });
      },
    },
  });

  await reconcilePaidLiveSessions(h.deps);
  await reconcilePaidLiveSessions(h.deps);

  assert.deepEqual(attempted, ["stable-refill", "stable-refill"]);
  assert.deepEqual(h.secrets().refillIntent, pending);
});

test("recipient rotation persists one linked rebind and preserves the broker session", async () => {
  const requests: Array<{ id: string; rebind?: string; replaces?: string; broker: string }> = [];
  const h = harness({
    client: {
      async status() { return lowStatus(); },
      async refill(input) {
        requests.push({
          id: input.requestId,
          ...(input.rebindFrom ? { rebind: input.rebindFrom, replaces: input.replacesRequestId } : {}),
          broker: input.brokerSessionId,
        });
        if (!input.rebindFrom) throw new PaidSessionClientError("recipient_rotated", { retryable: true });
        return acceptedRefill("work-2");
      },
    },
  });

  await reconcilePaidLiveSessions(h.deps);

  assert.deepEqual(requests, [
    { id: "refill-1", broker: "broker-session-1" },
    { id: "refill-2", rebind: "work-1", replaces: "refill-1", broker: "broker-session-1" },
  ]);
  assert.equal(h.operation().workId, "work-2");
  assert.equal(h.operation().rotationGeneration, 1);
});

test("preannounced refill refusal and failed rebind both request bounded winddown", async () => {
  let refillCalls = 0;
  const refused = harness({
    client: {
      async status() { return lowStatus(true); },
      async refill() { refillCalls += 1; return acceptedRefill(); },
    },
  });
  await reconcilePaidLiveSessions(refused.deps);
  assert.equal(refillCalls, 0);
  assert.equal(refused.operation().status, "winddown_requested");

  const rotated = harness({
    secrets: baseSecrets({
      request_id: "rebind-1", observed_consumed_units: 50,
      rebind_from: "work-1", replaces_request_id: "refill-1",
    }),
    client: {
      async refill() { throw new PaidSessionClientError("rebind_refused", { retryable: false }); },
    },
  });
  await reconcilePaidLiveSessions(rotated.deps);
  assert.equal(rotated.operation().status, "winddown_requested");
});

test("recipient rotation cannot exceed the route's persisted rotation bound", async () => {
  let refillCalls = 0;
  const h = harness({
    operation: operation({ rotationGeneration: 3 }),
    client: {
      async status() { return lowStatus(); },
      async refill() {
        refillCalls += 1;
        throw new PaidSessionClientError("INVALID_RECIPIENT_RAND", { retryable: true });
      },
    },
  });

  await reconcilePaidLiveSessions(h.deps);

  assert.equal(refillCalls, 1);
  assert.equal(h.operation().status, "winddown_requested");
});

test("control WebSocket loss never suppresses authoritative HTTP polling", async () => {
  let statusCalls = 0;
  const h = harness({
    controlSource: { async read() { throw new Error("socket lost"); } },
    client: {
      async status() { statusCalls += 1; return { ...lowStatus(), balance: { ...lowStatus().balance, status: "ok", runwayUnits: 50 } }; },
    },
  });

  await reconcilePaidLiveSessions(h.deps);

  assert.equal(statusCalls, 1);
  assert.ok(h.calls.includes("progress:active"));
});

test("durable customer winddown becomes terminal only after broker settlement and LOC close", async () => {
  const h = harness({
    operation: operation({
      status: "winddown_requested",
      sessionRuntime: {
        ...operation().sessionRuntime!,
        winddownReason: "customer_end",
      },
    }),
    client: { async end(input) {
      assert.equal(input.reason, "customer_end");
      return settledEnd();
    } },
  });

  await reconcilePaidLiveSessions(h.deps);

  assert.equal(h.operation().status, "settled");
  assert.equal(h.operation().terminalEvidence?.closeReason, "customer_end");
  assert.deepEqual(h.calls.filter((value) => value === "terminal" || value === "cache-remove"), [
    "terminal", "cache-remove",
  ]);
});

test("unresolved winddown stays nonterminal and restart retries the same authoritative end", async () => {
  let attempts = 0;
  const h = harness({
    operation: operation({
      status: "winddown_requested",
      sessionRuntime: { ...operation().sessionRuntime!, winddownReason: "lease_exhausted" },
    }),
    client: { async end() {
      attempts += 1;
      throw new PaidSessionClientError("accounting_pending", { retryable: true });
    } },
  });

  await reconcilePaidLiveSessions(h.deps);
  assert.equal(h.operation().status, "winddown_retry");
  assert.equal(h.operation().terminalAt, undefined);
  await reconcilePaidLiveSessions(h.deps);
  assert.equal(attempts, 2);
  assert.equal(h.operation().terminalAt, undefined);
});

test("publisher reconnect grace polls authoritatively before ending the existing session", async () => {
  let endCalls = 0;
  const disconnected = operation({
    status: "reconcile_pending",
    sessionRuntime: {
      ...operation().sessionRuntime!,
      relayStatus: "reconnecting",
      relayDisconnectedAt: "2026-08-26T11:59:55Z",
    },
  });
  const h = harness({
    operation: disconnected,
    client: {
      async status() { return { ...lowStatus(), balance: { ...lowStatus().balance, status: "ok", runwayUnits: 50 } }; },
      async end() { endCalls += 1; return settledEnd("publisher_disconnect"); },
    },
  });
  h.deps.now = () => new Date("2026-08-26T12:00:00Z");

  await reconcilePaidLiveSessions(h.deps);
  assert.equal(endCalls, 0);
  assert.equal(h.operation().status, "reconcile_pending");

  h.deps.now = () => new Date("2026-08-26T12:00:20Z");
  await reconcilePaidLiveSessions(h.deps);
  assert.equal(endCalls, 1);
  assert.equal(h.operation().status, "settled");
});
