import assert from "node:assert/strict";
import { test } from "node:test";
import type { PaidSessionClient } from "../../src/engine/interfaces/index.js";
import { PaidSessionClientError } from "../../src/engine/interfaces/index.js";
import type { PaidOperationProgress } from "../../src/engine/repo/index.js";
import type { PaidOperation, PaidOperationSecrets } from "../../src/engine/types/index.js";
import { reconcilePaidLiveSessions, type PaidLiveReconcilerDeps } from "../../src/engine/service/paidLiveReconciler.js";
import type { OwnedPaidSession, PaidSessionStore } from "../../src/livepeer/paidSessionStore.js";

const now = new Date("2026-08-26T12:00:00Z");
const gatewaySessionId = "f00ac946-92f7-4b47-9231-ecc360ef4c68";
const settlementDomainId = `0x${"03".repeat(32)}`;
const handle = {
  operation_id: "loc-operation-1",
  broker_url: "https://broker.example",
  descriptor_schema: "rtmp-hls/v1",
  work_unit: "output_seconds",
  settlement_domain_id: settlementDomainId,
  gateway_session_id: gatewaySessionId,
  max_total_units: 60,
};

function operation(overrides: Partial<PaidOperation> = {}): PaidOperation {
  return {
    id: "operation-1", kind: "session", apiKeyId: "api-key-1", liveStreamId: "live-1",
    requestId: "request-1", requestContentSha256: "a".repeat(64), workId: "work-1",
    rotationGeneration: 0,
    route: {
      protocol: "paid-session/v1", capability: "video:transcode.live", offering: "live-standard",
      requestDescriptor: "rtmp-hls-session/v1", responseDescriptor: "rtmp-hls/v1",
      workUnit: "output_seconds", pricePerUnitWei: "1", unitsPerPrice: "1",
      quoteId: "quote-1", quoteVersion: "1", constraintFingerprint: "01".repeat(32),
      routeFingerprint: "02".repeat(32), settlementDomainId, settlementKey: "settlement-1", raw: {},
    },
    status: "active", locOperationId: "loc-operation-1", brokerSessionId: "broker-session-1",
    fundedUnits: "60", claimedUnits: "50", balanceUnits: "10", willRefuseNextRefill: false,
    leaseExpiresAt: new Date("2026-08-26T12:01:00Z"), settlementSequence: "0",
    lifecycleVersion: "1", recoveryOwner: "gateway-1",
    recoveryLeaseExpiresAt: new Date("2030-01-01T00:00:00Z"),
    sessionRuntime: {
      publisherMode: "gateway-relay", relayStatus: "active", relayGeneration: 1,
      runnerHlsUrl: "https://runner.example/hls/master.m3u8",
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
    credentials: {
      customer_stream_key: "customer-public-key",
      broker_session_credential: "broker-secret",
    },
    runnerIngestUrl: "rtmps://runner.example/ingest",
    runnerIngestKey: "runner-secret",
    ...(refillIntent === undefined ? {} : { refillIntent }),
  };
}

function openingSecrets(): PaidOperationSecrets {
  return {
    openIntent: {
      request_id: "stable-open-request",
      key_request_id: "stable-key-request",
      descriptor_schema: "rtmp-hls/v1",
      estimated_runway_units: 60,
      max_total_units: 3_600,
    },
    routeIntent: {
      worker_url: "https://broker.example",
      eth_address: `0x${"11".repeat(20)}`,
      session: {
        descriptorSchema: "rtmp-hls/v1", attachment: "external",
        metering: "runner-reported", refill: "extensible",
        heartbeat: { intervalSeconds: 5, missedThreshold: 3 },
        lease: { policy: "funding-tracking" },
      },
      settlement_keys: [{
        publicKey: "settlement-1", notBefore: "2026-01-01T00:00:00Z",
        expiresAt: "2030-01-01T00:00:00Z", introducedInPublicationSeq: "1",
      }],
      work_unit_estimator: null,
      settlement_domain_id: settlementDomainId,
    },
    sessionParams: {
      schema: "rtmp-hls-session/v1", publisher_mode: "gateway-relay",
    },
    loc: { idempotency_key: "stable-open-request", key_request_id: "stable-key-request" },
    credentials: { customer_stream_key: "customer-public-key" },
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
    now: () => now,
    liveSessions: {
      record() { calls.push("cache-record"); }, get() { return null; }, getByStreamId() { return null; },
      remove() { calls.push("cache-remove"); },
    },
    liveStreamRepo: new Proxy({
      async updateStatus() { calls.push("stream-active"); },
    }, { get(target, property) {
      const value = target[property as keyof typeof target];
      if (value) return value;
      return async () => { throw new Error(`unexpected live stream call: ${String(property)}`); };
    } }) as unknown as PaidLiveReconcilerDeps["liveStreamRepo"],
    playbackIdRepo: new Proxy({
      async byLiveStream() { return [{ id: "playback-1" }]; },
    }, { get(target, property) {
      const value = target[property as keyof typeof target];
      if (value) return value;
      return async () => { throw new Error(`unexpected playback call: ${String(property)}`); };
    } }) as unknown as PaidLiveReconcilerDeps["playbackIdRepo"],
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
    brokerSessionId: "broker-session-1", gatewaySessionId, workId: "work-1",
    state: "active", runtimeSchema: "rtmp-hls/v1", runtimePublic: {},
    claimedUnits: 50, workUnit: "output_seconds", leaseExpiresAt: "2026-08-26T12:02:00Z",
    balance: {
      claimedUnits: 50, debitedUnits: 50, unit: "output_seconds", runwayUnits: 10,
      authorizationId: "work-1", authorizationMaxUnits: 60, authorizationCapRemainingUnits: 10,
      authorizationReservedValueWei: "10", cumulativeBilledValueWei: "50",
      accountAvailableValueWei: "1000", accountVersion: 1,
      runwaySecondsEstimate: 10, status: "low" as const, willRefuseNextRefill,
    },
    closeReason: null,
    outputState: "producing" as const,
    outputStateSince: "2026-08-26T11:59:00Z",
    lastFailureCode: null,
  };
}

function acceptedRefill(workId = "work-1") {
  return {
    loc: {
      workId, requestId: "refill-1", refillSequence: 1,
      spendAuthorization: Buffer.from("authorization").toString("base64"), paymentEnvelope: null,
      expectedValueWei: "0", fundedValueWei: "0", capStatus: {
        sessionPctUsed: 1, spendPeriodPctUsed: null, userBalancePctUsed: null,
        operatorPoolPctUsed: null, willRefuseNextRefill: false, winddownReason: null,
      },
    },
    brokerSessionId: "broker-session-1", workId,
    leaseExpiresAt: "2026-08-26T12:03:00Z",
    balance: {
      claimedUnits: 50, debitedUnits: 50, unit: "output_seconds", runwayUnits: 70,
      authorizationId: workId, authorizationMaxUnits: 120, authorizationCapRemainingUnits: 70,
      authorizationReservedValueWei: "70", cumulativeBilledValueWei: "50",
      accountAvailableValueWei: "1000", accountVersion: 2,
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
      billedValueWei: "55", refundWei: "5", outcome: "EXACT",
      closedAt: "2026-08-26T12:04:00Z",
    },
  };
}

function recoveredOpenResult(): Awaited<ReturnType<PaidSessionClient["open"]>> {
  const session = {
    descriptorSchema: "rtmp-hls/v1", attachment: "external" as const,
    metering: "runner-reported" as const, refill: "extensible" as const,
    heartbeat: { intervalSeconds: 5, missedThreshold: 3 },
    lease: { policy: "funding-tracking" as const },
  };
  return {
    opened: {
      operationId: "loc-operation-1", gatewaySessionId, requestId: "broker-open-request",
      workId: "work-1", brokerUrl: "https://broker.example",
      protocol: "paid-session/v1", session,
      routeSnapshot: {
        schemaVersion: "route-snapshot/v1", brokerUrl: "https://broker.example",
        ethAddress: `0x${"11".repeat(20)}`, capability: "video:transcode.live",
        offering: "live-standard", protocol: "paid-session/v1",
        workUnit: "output_seconds", pricePerWorkUnitWei: "1", unitsPerPrice: "1",
        binding: {
          quoteId: "quote-1", quoteVersion: "1",
          constraintFingerprint: "01".repeat(32), routeFingerprint: "02".repeat(32),
          settlementDomainId,
        },
        settlementDomainId, settlementKeys: [], workUnitEstimator: null, job: null, session, extra: {}, raw: {},
      },
      spendAuthorization: Buffer.from("authorization").toString("base64"), paymentEnvelope: null,
      expectedValueWei: "0", fundedValueWei: "0", refillEndpoint: "/refill", closeEndpoint: "/close",
      openedAt: "2026-08-26T12:00:00Z",
    },
    gatewaySessionId, brokerSessionId: "broker-session-1", workId: "work-1",
    state: "active", credential: "broker-secret", runtimeSchema: "rtmp-hls/v1",
    runtimePublic: {
      rtmp_url: "rtmps://runner.example/ingest",
      hls_url: "https://runner.example/hls/master.m3u8",
      key_issue_url: "https://runner.example/v1/keys",
    },
    grants: [{
      id: "grant-1", operations: ["stream-key-issue"], secret: "grant-secret",
      expiresAt: "2030-01-01T00:00:00Z",
    }],
    leaseExpiresAt: "2030-01-01T00:00:00Z",
    balance: {
      claimedUnits: 0, debitedUnits: 0, unit: "output_seconds", runwayUnits: 60,
      authorizationId: "work-1", authorizationMaxUnits: 60, authorizationCapRemainingUnits: 60,
      authorizationReservedValueWei: "60", cumulativeBilledValueWei: "0",
      accountAvailableValueWei: "1000", accountVersion: 1,
      runwaySecondsEstimate: 60, status: "ok", willRefuseNextRefill: false,
    },
    control: {
      statusUrl: "https://broker.example/status", topupUrl: "https://broker.example/topup",
      endUrl: "https://broker.example/end", eventsWs: "wss://broker.example/events",
    },
  };
}

test("startup replays the exact paid open and key identities then repairs activation artifacts", async () => {
  const opens: string[] = [];
  const keys: string[] = [];
  const h = harness({
    operation: operation({
      status: "opening",
      requestId: "pending:stable-open-request",
      workId: "pending:stable-open-request",
      brokerSessionId: undefined,
      locOperationId: undefined,
    }),
    secrets: openingSecrets(),
    client: {
      async open(input) { opens.push(input.requestId); return recoveredOpenResult(); },
      async issueStreamKey(input) {
        keys.push(input.requestId);
        return { requestId: input.requestId, streamKey: "private-runner-key", expiresAt: "2030-01-01T00:00:00Z" };
      },
    },
  });
  h.deps.playbackIdRepo.byLiveStream = async () => [];
  h.deps.playbackIdRepo.insert = async (value) => {
    h.calls.push("playback-insert");
    return { ...value, createdAt: now };
  };

  await reconcilePaidLiveSessions(h.deps);

  assert.deepEqual(opens, ["stable-open-request"]);
  assert.deepEqual(keys, ["stable-key-request"]);
  assert.equal(h.operation().status, "active");
  assert.equal(h.operation().brokerSessionId, "broker-session-1");
  assert.equal(h.secrets().runnerIngestKey, "private-runner-key");
  assert.ok(h.calls.includes("stream-active"));
  assert.ok(h.calls.includes("playback-insert"));
  assert.ok(h.calls.includes("cache-record"));
});

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
  const pending = { request_id: "stable-refill", observed_consumed_units: 50, max_total_units: 120 };
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

test("a successor authorization may advance work identity without changing the broker session", async () => {
  const requests: Array<{ id: string; maximum: number; broker: string }> = [];
  const h = harness({
    client: {
      async status() { return lowStatus(); },
      async refill(input) {
        requests.push({ id: input.requestId, maximum: input.maxTotalUnits, broker: input.brokerSessionId });
        return acceptedRefill("work-2");
      },
    },
  });

  await reconcilePaidLiveSessions(h.deps);

  assert.deepEqual(requests, [
    { id: "refill-1", maximum: 120, broker: "broker-session-1" },
  ]);
  assert.equal(h.operation().workId, "work-2");
  assert.equal(h.operation().rotationGeneration, 0);
});

test("preannounced and nonretryable refill refusals request bounded winddown", async () => {
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

  const rejected = harness({
    secrets: baseSecrets({
      request_id: "revision-1", observed_consumed_units: 50, max_total_units: 120,
    }),
    client: {
      async refill() { throw new PaidSessionClientError("refill_refused", { retryable: false }); },
    },
  });
  await reconcilePaidLiveSessions(rejected.deps);
  assert.equal(rejected.operation().status, "winddown_requested");
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

test("output health from WebSocket and HTTP is durably projected", async () => {
  const h = harness({
    controlSource: { async read() {
      return [{
        type: "session.output.health",
        body: {
          output_state: "stalled",
          output_state_since: "2026-08-26T11:59:40Z",
          last_failure_code: "encoder_init_failed",
        },
      }];
    } },
    client: {
      async status() {
        return {
          ...lowStatus(),
          outputState: "stalled" as const,
          outputStateSince: "2026-08-26T11:59:40Z",
          lastFailureCode: "encoder_init_failed",
          balance: { ...lowStatus().balance, status: "ok" as const, runwayUnits: 50 },
        };
      },
    },
  });

  await reconcilePaidLiveSessions(h.deps);

  assert.equal(h.operation().sessionRuntime?.outputState, "stalled");
  assert.equal(h.operation().sessionRuntime?.outputStateSince, "2026-08-26T11:59:40Z");
  assert.equal(h.operation().sessionRuntime?.lastFailureCode, "encoder_init_failed");
});

test("terminal broker output failure enters settlement with the preserved reason", async () => {
  let endReason = "";
  const h = harness({
    client: {
      async status() {
        return {
          ...lowStatus(), state: "failed", closeReason: "output_failed",
          outputState: "stalled" as const,
          outputStateSince: "2026-08-26T11:59:00Z",
          lastFailureCode: "unknown",
          balance: { ...lowStatus().balance, status: "ok" as const, runwayUnits: 50 },
        };
      },
      async end(input) { endReason = input.reason; return settledEnd("output_failed"); },
    },
  });

  await reconcilePaidLiveSessions(h.deps);

  assert.equal(endReason, "output_failed");
  assert.equal(h.operation().terminalEvidence?.closeReason, "output_failed");
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
