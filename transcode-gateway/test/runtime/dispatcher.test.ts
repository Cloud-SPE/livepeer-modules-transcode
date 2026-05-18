import { test } from "node:test";
import assert from "node:assert/strict";
import { decideDispatch, hashStreamKey } from "../../src/runtime/rtmp/index.js";

function makeRepoStub(rows: Record<string, { id: string; status: string; sessionId?: string } | null>) {
  return {
    byStreamKeyHash: async (hash: string) => rows[hash] ?? null,
  };
}

function makeSessionDirStub(map: Record<string, { brokerRtmpUrl: string } | null>) {
  return {
    get: (sessionId: string) => map[sessionId] ?? null,
  };
}

test("decideDispatch rejects unparseable stream paths", async () => {
  const r = await decideDispatch("not-a-path", "live", {
    byStreamKeyHash: makeRepoStub({}).byStreamKeyHash,
    sessionDir: makeSessionDirStub({}),
  });
  assert.equal(r.parsed, false);
  assert.equal(r.reject?.reason, "stream_path_unparseable");
});

test("decideDispatch rejects unknown app", async () => {
  const r = await decideDispatch("/foo/abc123", "live", {
    byStreamKeyHash: makeRepoStub({}).byStreamKeyHash,
    sessionDir: makeSessionDirStub({}),
  });
  assert.equal(r.parsed, true);
  assert.equal(r.reject?.reason, "unknown_app");
});

test("decideDispatch rejects unknown stream key (no DB row)", async () => {
  const r = await decideDispatch("/live/abc123", "live", {
    byStreamKeyHash: makeRepoStub({}).byStreamKeyHash,
    sessionDir: makeSessionDirStub({}),
  });
  assert.equal(r.reject?.reason, "stream_not_found");
});

test("decideDispatch rejects ended streams", async () => {
  const hash = hashStreamKey("abc123");
  const r = await decideDispatch("/live/abc123", "live", {
    byStreamKeyHash: makeRepoStub({ [hash]: { id: "live_X", status: "ended", sessionId: "s1" } }).byStreamKeyHash,
    sessionDir: makeSessionDirStub({}),
  });
  assert.equal(r.reject?.reason, "stream_ended");
});

test("decideDispatch rejects when liveSessionDirectory missing", async () => {
  const hash = hashStreamKey("abc123");
  const r = await decideDispatch("/live/abc123", "live", {
    byStreamKeyHash: makeRepoStub({ [hash]: { id: "live_X", status: "active", sessionId: "s_missing" } }).byStreamKeyHash,
    sessionDir: makeSessionDirStub({}),
  });
  assert.equal(r.reject?.reason, "session_directory_miss");
});

test("decideDispatch accepts active stream with session directory hit", async () => {
  const hash = hashStreamKey("abc123");
  const r = await decideDispatch("/live/abc123", "live", {
    byStreamKeyHash: makeRepoStub({ [hash]: { id: "live_X", status: "active", sessionId: "s_ok" } }).byStreamKeyHash,
    sessionDir: makeSessionDirStub({ s_ok: { brokerRtmpUrl: "rtmp://broker.example.com/live/sk" } }),
  });
  assert.equal(r.accept?.streamId, "live_X");
  assert.equal(r.accept?.brokerRtmpUrl, "rtmp://broker.example.com/live/sk");
});

test("hashStreamKey is sha256 hex (matches plan 0006 schema constraint)", () => {
  // sha256("abc123") = 6ca13d52ca70c883e0f0bb101e425a89e8624de51db2d2392593af6a84118090
  assert.equal(
    hashStreamKey("abc123"),
    "6ca13d52ca70c883e0f0bb101e425a89e8624de51db2d2392593af6a84118090",
  );
});
