import assert from "node:assert/strict";
import { test } from "node:test";
import type { PaidSessionClient } from "../../src/engine/interfaces/index.js";
import type { LiveStreamRepo, PlaybackIdRepo } from "../../src/engine/repo/index.js";
import type { PaidOperation, SelectedWorkerRoute } from "../../src/engine/types/index.js";
import type { LiveSessionDirectory } from "../../src/livepeer/liveSessionDirectory.js";
import type { OwnedPaidSession, PaidSessionStore } from "../../src/livepeer/paidSessionStore.js";
import { openPaidLiveStream } from "../../src/engine/service/paidLiveOpen.js";

test("paid live open binds durable identities and encrypted private ingest before activation", async () => {
  const events: string[] = [];
  const operation = operationFixture("1");
  const owned = (version: string): OwnedPaidSession => ({
    operation: { ...operation, lifecycleVersion: version },
    claim: { owner: "gateway-1", version, leaseExpiresAt: new Date("2030-01-01T00:00:00Z") },
  });
  let storedSecrets: unknown;
  const paidSessionStore = {
    async create(value: { requestId: string }, secrets: unknown) {
      events.push("operation-created");
      assert.match(value.requestId, /^pending:req_/);
      assert.doesNotMatch(JSON.stringify(secrets), /private-runner-key|grant-secret/);
      return owned("1");
    },
    async recordProgress(_value: OwnedPaidSession, progress: { status: string }) {
      events.push(`progress:${progress.status}`);
      return progress.status === "issuing_key" ? owned("2") : owned("3");
    },
    async putSecrets(_value: OwnedPaidSession, secrets: unknown) {
      events.push("secrets-stored");
      storedSecrets = secrets;
      return true;
    },
  } as unknown as PaidSessionStore;
  const paidSessionClient = {
    async open() {
      events.push("session-opened");
      return {
        opened: {
          operationId: "loc-operation-1",
          requestId: "broker-request-1",
          brokerUrl: "https://broker.example",
          session: { descriptorSchema: "rtmp-hls/v1", maxRotations: 3 },
          routeSnapshot: { workUnit: "output_seconds" },
        },
        gatewaySessionId: "live-1",
        brokerSessionId: "broker-session-1",
        workId: "work-1",
        state: "active",
        credential: "broker-credential",
        runtimeSchema: "rtmp-hls/v1",
        runtimePublic: {
          rtmp_url: "rtmps://runner.example/ingest",
          hls_url: "https://runner.example/hls/master.m3u8",
          key_issue_url: "https://runner.example/v1/keys",
        },
        grants: [{ id: "grant-1", operations: ["stream-key-issue"], secret: "grant-secret", expiresAt: "2030-01-01T00:00:00Z" }],
        leaseExpiresAt: "2030-01-01T00:00:00Z",
        balance: { claimedUnits: 0, debitedUnits: 0, unit: "output_seconds", runwayUnits: 60, runwaySecondsEstimate: 60, status: "ok", willRefuseNextRefill: false },
        control: { statusUrl: "https://broker.example/status", topupUrl: "https://broker.example/topup", endUrl: "https://broker.example/end", eventsWs: "wss://broker.example/events" },
      };
    },
    async issueStreamKey(value: { requestId: string }) {
      events.push("key-issued");
      return { requestId: value.requestId, streamKey: "private-runner-key", expiresAt: "2030-01-01T00:00:00Z" };
    },
  } as unknown as PaidSessionClient;
  const liveStreamRepo = {
    async insert() { events.push("stream-created"); return {}; },
    async updateStatus(_id: string, status: string) { events.push(`stream:${status}`); },
  } as unknown as LiveStreamRepo;
  const playbackIdRepo = {
    async insert(value: object) { events.push("playback-created"); return { ...value, id: "playback-1", createdAt: new Date() }; },
  } as unknown as PlaybackIdRepo;
  const liveSessions = {
    record() { events.push("cache-recorded"); },
  } as unknown as LiveSessionDirectory;

  const result = await openPaidLiveStream({
    liveStreamRepo,
    playbackIdRepo,
    paidSessionStore,
    paidSessionClient,
    liveSessions,
    gatewayRtmpUrl: "rtmp://gateway.example/live",
    estimatedRunwayUnits: 60,
    maxTotalUnits: 3_600,
  }, {
    streamId: "live-1",
    apiKeyId: "api-key-1",
    name: "Test stream",
    encodingTier: "standard",
    route: routeFixture(),
  });

  assert.deepEqual(events, [
    "stream-created", "operation-created", "session-opened", "progress:issuing_key",
    "key-issued", "secrets-stored", "progress:active", "stream:active",
    "playback-created", "cache-recorded",
  ]);
  assert.match(JSON.stringify(storedSecrets), /private-runner-key/);
  assert.match(JSON.stringify(storedSecrets), /grant-secret/);
  assert.match(JSON.stringify(storedSecrets), /control_handle/);
  assert.match(JSON.stringify(storedSecrets), /routeIntent/);
  assert.doesNotMatch(JSON.stringify(result), /private-runner-key|grant-secret|broker-credential/);
  assert.equal(result.rtmpPushUrl.startsWith("rtmp://gateway.example/live/live_"), true);
});

function operationFixture(version: string): PaidOperation {
  return {
    id: "operation-1", kind: "session", apiKeyId: "api-key-1", liveStreamId: "live-1",
    requestId: "pending:req_1", requestContentSha256: "a".repeat(64), workId: "pending:req_1",
    rotationGeneration: 0, route: { protocol: "paid-session/v1", capability: "video:transcode.live", offering: "live-standard", requestDescriptor: "rtmp-hls-session/v1", responseDescriptor: "rtmp-hls/v1", workUnit: "output_seconds", pricePerUnitWei: "1", unitsPerPrice: "1", quoteId: "quote-1", quoteVersion: "1", constraintFingerprint: "01".repeat(32), routeFingerprint: "02".repeat(32), settlementKey: "key-1", raw: {} },
    status: "opening", fundedUnits: "60", settlementSequence: "0", lifecycleVersion: version,
    recoveryOwner: "gateway-1", recoveryLeaseExpiresAt: new Date("2030-01-01T00:00:00Z"),
    sessionRuntime: { publisherMode: "gateway-relay", relayStatus: "pending", relayGeneration: 0, lastRunnerSequence: "0", lastRunnerUsage: "0" },
    retryCount: 0, createdAt: new Date(), updatedAt: new Date(),
  };
}

function routeFixture(): SelectedWorkerRoute {
  return {
    workerUrl: "https://broker.example", ethAddress: "0x1111111111111111111111111111111111111111",
    capability: "video:transcode.live", offering: "live-standard", pricePerWorkUnitWei: "1",
    unitsPerPrice: "1", workUnit: "output_seconds", protocol: "paid-session/v1", job: null,
    session: { descriptorSchema: "rtmp-hls/v1", attachment: "external", metering: "runner-reported", maxRotations: 3, refill: "extensible", heartbeat: { intervalSeconds: 5, missedThreshold: 3 }, lease: { policy: "funding-tracking" } },
    workUnitEstimator: null, settlementKeys: [{ publicKey: "key-1", notBefore: "2026-01-01T00:00:00Z", expiresAt: "2030-01-01T00:00:00Z", introducedInPublicationSeq: "1" }],
    quoteId: "quote-1", quoteVersion: "1", constraintFingerprint: Buffer.from("01".repeat(32), "hex"), routeFingerprint: Buffer.from("02".repeat(32), "hex"),
  };
}
