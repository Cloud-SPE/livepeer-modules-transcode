import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  NewPaidOperation,
  PaidOperationRepo,
} from "../../src/engine/repo/index.js";
import type { PaidOperation } from "../../src/engine/types/index.js";
import { createPaidSessionStore } from "../../src/livepeer/paidSessionStore.js";

const now = new Date("2026-08-24T12:00:00.000Z");
const leaseExpiresAt = new Date("2026-08-24T12:01:00.000Z");

function newSession(): NewPaidOperation {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    kind: "session",
    apiKeyId: "00000000-0000-4000-8000-000000000002",
    liveStreamId: "live_001",
    requestId: "request-001",
    requestContentSha256: "a".repeat(64),
    workId: "work-001",
    route: {
      protocol: "paid-session/v1",
      capability: "video:live.rtmp",
      offering: "live-standard",
      requestDescriptor: "rtmp-hls-session/v1",
      responseDescriptor: "rtmp-hls/v1",
      workUnit: "output_seconds",
      pricePerUnitWei: "1",
      unitsPerPrice: "1",
      quoteId: "quote-1",
      quoteVersion: "1",
      constraintFingerprint: "constraint-1",
      routeFingerprint: "route-1",
      settlementKey: "settlement-1",
      raw: {},
    },
    status: "opening",
    fundedUnits: "60",
    sessionRuntime: {
      publisherMode: "gateway-relay",
      relayStatus: "pending",
      relayGeneration: 0,
      lastRunnerSequence: "0",
      lastRunnerUsage: "0",
    },
  };
}

function claimedSession(version = "1"): PaidOperation {
  const value = newSession();
  return {
    ...value,
    rotationGeneration: 0,
    settlementSequence: "0",
    lifecycleVersion: version,
    recoveryOwner: "gateway-a",
    recoveryLeaseExpiresAt: leaseExpiresAt,
    retryCount: 0,
    createdAt: now,
    updatedAt: now,
  };
}

function repoWith(
  overrides: Partial<PaidOperationRepo>,
): PaidOperationRepo {
  return new Proxy(overrides as PaidOperationRepo, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver) as unknown;
      if (value !== undefined) return value;
      return async () => {
        throw new Error(`unexpected repository call: ${String(property)}`);
      };
    },
  });
}

test("paid session create atomically persists secrets under an initial lease", async () => {
  let captured: unknown[] | undefined;
  const repo = repoWith({
    async insertWithSecrets(...args) {
      captured = args;
      return claimedSession();
    },
  });
  const store = createPaidSessionStore({
    repo,
    owner: "gateway-a",
    leaseDurationMs: 60_000,
  });
  const operation = newSession();
  const secrets = { runnerIngestKey: "private-key" };

  const result = await store.create(operation, secrets, now);

  assert.equal(result.claim.version, "1");
  assert.deepEqual(captured, [
    operation,
    secrets,
    { owner: "gateway-a", leaseExpiresAt },
  ]);
});

test("paid session recovery claims only session operations", async () => {
  let captured: unknown[] | undefined;
  const repo = repoWith({
    async claimRecoverable(...args) {
      captured = args;
      return [claimedSession("7")];
    },
  });
  const store = createPaidSessionStore({
    repo,
    owner: "gateway-a",
    leaseDurationMs: 60_000,
  });

  const [result] = await store.claimRecoverable(25, now);

  assert.equal(result?.claim.version, "7");
  assert.deepEqual(captured, [
    "session",
    "gateway-a",
    now,
    leaseExpiresAt,
    25,
  ]);
});

test("paid session relay claims one specific live stream", async () => {
  let captured: unknown[] | undefined;
  const repo = repoWith({
    async claimSessionByLiveStreamId(...args) {
      captured = args;
      return claimedSession("8");
    },
  });
  const store = createPaidSessionStore({
    repo,
    owner: "gateway-a",
    leaseDurationMs: 60_000,
  });

  const result = await store.claimByLiveStreamId("live_001", now);

  assert.equal(result?.claim.version, "8");
  assert.deepEqual(captured, ["live_001", "gateway-a", now, leaseExpiresAt]);
});

test("secret reads always pass the current database fence", async () => {
  let captured: unknown[] | undefined;
  const repo = repoWith({
    async readSecrets(...args) {
      captured = args;
      return null;
    },
  });
  const store = createPaidSessionStore({
    repo,
    owner: "gateway-a",
    leaseDurationMs: 60_000,
  });
  const value = {
    operation: claimedSession("9"),
    claim: {
      owner: "gateway-a",
      version: "9",
      leaseExpiresAt,
    },
  };

  assert.equal(await store.readSecrets(value), null);
  assert.deepEqual(captured, [value.operation.id, value.claim]);
});

test("claimed recovery rejects rows without durable session state", async () => {
  const invalid = { ...claimedSession(), sessionRuntime: undefined };
  const repo = repoWith({
    async claimRecoverable() {
      return [invalid];
    },
  });
  const store = createPaidSessionStore({
    repo,
    owner: "gateway-a",
    leaseDurationMs: 60_000,
  });

  await assert.rejects(
    () => store.claimRecoverable(1, now),
    /missing durable recovery state/,
  );
});

test("claimed recovery rejects a row fenced to another gateway", async () => {
  const invalid = { ...claimedSession(), recoveryOwner: "gateway-b" };
  const repo = repoWith({
    async claimRecoverable() {
      return [invalid];
    },
  });
  const store = createPaidSessionStore({
    repo,
    owner: "gateway-a",
    leaseDurationMs: 60_000,
  });

  await assert.rejects(
    () => store.claimRecoverable(1, now),
    /missing durable recovery state/,
  );
});
