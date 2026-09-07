import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import type { ChildProcess } from "node:child_process";
import type { Config } from "../../src/config.js";
import type { Logger } from "../../src/engine/interfaces/index.js";
import type { LiveStreamRepo } from "../../src/engine/repo/index.js";
import type { PaidOperation } from "../../src/engine/types/index.js";
import type { PaidSessionStore } from "../../src/livepeer/paidSessionStore.js";
import { attachDispatcher, decideDispatch, hashStreamKey } from "../../src/runtime/rtmp/dispatcher.js";
import type { NmsHandle, NmsSession } from "../../src/runtime/rtmp/server.js";

const now = new Date("2026-08-26T12:00:00Z");

function operation(version = "1", relayGeneration = 0): PaidOperation {
  return {
    id: "operation-1", kind: "session", apiKeyId: "api-key-1", liveStreamId: "live_X",
    requestId: "request-1", requestContentSha256: "a".repeat(64), workId: "work-1",
    rotationGeneration: 0,
    route: {
      protocol: "paid-session/v1", capability: "video:transcode.live", offering: "live-standard",
      requestDescriptor: "rtmp-hls-session/v1", responseDescriptor: "rtmp-hls/v1",
      workUnit: "output_seconds", pricePerUnitWei: "1", unitsPerPrice: "1",
      quoteId: "quote-1", quoteVersion: "1", constraintFingerprint: "constraint-1",
      routeFingerprint: "route-1", settlementKey: "settlement-1", raw: {},
    },
    status: "active", fundedUnits: "60", settlementSequence: "0", lifecycleVersion: version,
    recoveryOwner: "gateway-1", recoveryLeaseExpiresAt: new Date("2030-01-01T00:00:00Z"),
    sessionRuntime: {
      publisherMode: "gateway-relay", relayStatus: "pending", relayGeneration,
      lastRunnerSequence: "0", lastRunnerUsage: "0",
    },
    retryCount: 0, createdAt: now, updatedAt: now,
  };
}

function owned(version = "1", relayGeneration = 0) {
  const value = operation(version, relayGeneration);
  return {
    operation: value,
    claim: { owner: "gateway-1", version, leaseExpiresAt: value.recoveryLeaseExpiresAt! },
  };
}

function lookups(rows: Record<string, { id: string; status: string } | null>, secrets = {
  runnerIngestUrl: "rtmps://runner.example/ingest",
  runnerIngestKey: "private-runner-key",
}) {
  return {
    byStreamKeyHash: async (hash: string) => rows[hash] ?? null,
    claimByLiveStreamId: async () => owned(),
    readSecrets: async () => secrets,
    release: async () => true,
  };
}

test("decideDispatch rejects malformed, foreign, unknown, and ended publishes", async () => {
  assert.equal((await decideDispatch("not-a-path", "live", lookups({}))).reject?.reason, "stream_path_unparseable");
  assert.equal((await decideDispatch("/foo/abc123", "live", lookups({}))).reject?.reason, "unknown_app");
  assert.equal((await decideDispatch("/live/abc123", "live", lookups({}))).reject?.reason, "stream_not_found");
  const hash = hashStreamKey("abc123");
  assert.equal((await decideDispatch("/live/abc123", "live", lookups({ [hash]: { id: "live_X", status: "ended" } }))).reject?.reason, "stream_ended");
});

test("decideDispatch resolves encrypted durable runner ingest instead of the legacy directory", async () => {
  const hash = hashStreamKey("abc123");
  const result = await decideDispatch("/live/abc123", "live", lookups({
    [hash]: { id: "live_X", status: "active" },
  }));
  assert.equal(result.accept?.streamId, "live_X");
  assert.equal(result.accept?.targetUrl, "rtmps://runner.example/ingest/private-runner-key");
  assert.equal(result.accept?.relayGeneration, 1);
});

test("decideDispatch rejects a session without durable private ingest coordinates", async () => {
  const hash = hashStreamKey("abc123");
  const result = await decideDispatch("/live/abc123", "live", lookups(
    { [hash]: { id: "live_X", status: "active" } },
    { runnerIngestUrl: "", runnerIngestKey: "" },
  ));
  assert.equal(result.reject?.reason, "runner_ingest_missing");
});

test("dispatcher starts one redacted relay and schedules reconcile on disconnect", async () => {
  const listeners = new Map<string, (session: NmsSession) => void>();
  const nms = {
    on(event: string, listener: (session: NmsSession) => void) { listeners.set(event, listener); },
    async stop() {},
  } as NmsHandle;
  const logs: Array<{ message: string; context?: Record<string, unknown> }> = [];
  const logger = Object.fromEntries(["info", "warn", "error"].map((level) => [
    level,
    (message: string, context?: Record<string, unknown>) => logs.push({ message, context }),
  ])) as unknown as Logger;
  let current = owned();
  const progress: string[] = [];
  const statuses: string[] = [];
  const paidSessionStore = new Proxy({
    async claimByLiveStreamId() { return current; },
    async readSecrets() {
      return { runnerIngestUrl: "rtmps://runner.example/ingest", runnerIngestKey: "private-runner-key" };
    },
    async recordProgress(value: typeof current, update: { status: string; sessionRuntime: PaidOperation["sessionRuntime"] }) {
      progress.push(`${update.status}:${update.sessionRuntime?.relayStatus}`);
      current = owned(String(Number(value.claim.version) + 1), update.sessionRuntime?.relayGeneration);
      return current;
    },
    async release() { return true; },
  } as Partial<PaidSessionStore>, {
    get(target, property) {
      const value = target[property as keyof typeof target];
      if (value) return value;
      return async () => { throw new Error(`unexpected store call: ${String(property)}`); };
    },
  }) as PaidSessionStore;
  const liveStreamRepo = new Proxy({
    async byStreamKeyHash(hash: string) {
      return hash === hashStreamKey("customer-public-key")
        ? { id: "live_X", status: "active" }
        : null;
    },
    async updateStatus(_id: string, status: string) { statuses.push(status); },
  } as Partial<LiveStreamRepo>, {
    get(target, property) {
      const value = target[property as keyof typeof target];
      if (value) return value;
      return async () => { throw new Error(`unexpected repo call: ${String(property)}`); };
    },
  }) as LiveStreamRepo;
  const children: EventEmitter[] = [];
  const spawnedArgs: string[][] = [];
  const dispatcher = attachDispatcher(nms, {
    config: { RTMP_LISTEN_PORT: 1935, RTMP_RELAY_FFMPEG_BIN: "ffmpeg" } as Config,
    liveStreamRepo, paidSessionStore, logger,
    spawnRelay(_command, args) {
      spawnedArgs.push(args);
      const child = new EventEmitter() as EventEmitter & { stderr: EventEmitter; kill(): boolean };
      child.stderr = new EventEmitter();
      child.kill = () => true;
      children.push(child);
      return child as unknown as ChildProcess;
    },
  });
  let duplicateDestroyed = false;
  listeners.get("postPublish")!({ id: "nms-1", streamPath: "/live/customer-public-key" });
  await new Promise((resolve) => setImmediate(resolve));
  listeners.get("postPublish")!({
    id: "nms-2", streamPath: "/live/customer-public-key",
    socket: { destroy() { duplicateDestroyed = true; } },
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(spawnedArgs.length, 1);
  assert.equal(duplicateDestroyed, true);
  assert.ok(progress.includes("relay_starting:starting"));
  assert.ok(progress.includes("active:active"));
  const serializedLogs = JSON.stringify(logs);
  assert.doesNotMatch(serializedLogs, /customer-public-key|private-runner-key|runner\.example/);

  listeners.get("donePublish")!({ id: "nms-1", streamPath: "/live/customer-public-key" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(progress.includes("reconcile_pending:reconnecting"));
  assert.ok(statuses.includes("reconnecting"));
  await dispatcher.stop();
});

test("hashStreamKey is sha256 hex", () => {
  assert.equal(hashStreamKey("abc123"), "6ca13d52ca70c883e0f0bb101e425a89e8624de51db2d2392593af6a84118090");
});
