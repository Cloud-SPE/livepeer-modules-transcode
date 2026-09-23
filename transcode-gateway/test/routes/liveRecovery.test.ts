import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { registerLiveStreams, type LiveStreamsDeps } from "../../src/routes/live/streams.js";
import { loadConfig } from "../../src/config.js";
import { LocTransportError } from "../../src/engine/interfaces/index.js";

const config = { ...loadConfig({ DATABASE_URL: 'postgres://test', ADMIN_TOKEN: 'a'.repeat(16), API_KEY_HASH_PEPPER: 'p'.repeat(16) }), RTMP_RELAY_ENABLED: true, LIVEPEER_GATEWAY_EXTERNAL_RTMP_URL: 'rtmp://localhost:1935/live' };
function fixture() {
  let stream = { id: 'live-test', apiKeyId: 'key-id', name: 'Demo', status: 'active', createdAt: new Date() };
  let operation = { id: 'op', kind: 'session', status: 'active', route: { protocol: 'paid-session/v1', workUnit: 'output_seconds' }, requestId: 'request', fundedUnits: '60', retryCount: 0, sessionRuntime: { relayStatus: 'pending' } };
  const deps = {
    config,
    pool: { async query(sql: string) { return { rowCount: 1, rows: sql.includes('key_hash = ANY') ? [{ id: 'key-id', user_id: 'user-id', key_prefix: 'tc_test', created_at: new Date() }] : [{ name: "Demo", email: "demo@example.test", key_prefix: "tc_test", key_created_at: new Date(), status: "approved", member_since: new Date() }] }; } },
    workerResolver: { async selectWorker() { return { protocol: 'paid-session/v1', capability: 'video:transcode.live', offering: 'gateway-ingest', workUnit: 'output_seconds', session: { descriptorSchema: 'rtmp-hls/v1', attachment: 'external', refill: 'extensible' }, constraintFingerprint: Buffer.alloc(32), routeFingerprint: Buffer.alloc(32), settlementKeys: [] }; } },
    paidSessionClient: { async open() { throw new LocTransportError('loc_timeout', { retryable: true }); } },
    paidSessionStore: {
      async release() { return true; },
      async byLiveStreamId() { return operation; },
      async create(value: object) { operation = { ...operation, ...value }; return { operation, claim: {} }; },
    },
    liveSessions: { getByStreamId() { return { streamKey: 'customer-key', brokerRtmpUrl: 'rtmp://private/runner-secret', hlsPlaybackUrl: 'https://runner/hls' }; } },
    liveStreamRepo: {
      async byId() { return stream; },
      async insert(value: typeof stream) { stream = { ...stream, ...value }; return stream; },
      async listForApiKey(id: string) { assert.equal(id, 'key-id'); return [stream]; },
    },
    playbackIdRepo: {},
  } as unknown as LiveStreamsDeps;
  const app = Fastify(); registerLiveStreams(app, deps);
  return { app, foreign() { stream.apiKeyId = 'other-key'; }, pending() { operation.status = 'opening'; }, ending() { operation.status = 'winddown_pending'; } };
}
const headers = { authorization: 'Bearer tc_fixture' };
test('ambiguous persisted live creation returns 202 with durable poll identity', async () => {
  const f = fixture();
  try {
    const r = await f.app.inject({ method: 'POST', url: '/v1/live/streams', headers, payload: { name: 'Demo' } });
    assert.equal(r.statusCode, 202); assert.equal(r.json().status, 'opening');
    assert.equal(r.headers.location, '/v1/live/streams/' + r.json().stream_id);
    assert.doesNotMatch(r.body, /customer-key|runner-secret/);
  } finally { await f.app.close(); }
});
test('live detail gives owner customer credentials only when ready and never leaks runner credentials', async () => {
  const f = fixture();
  try {
    let r = await f.app.inject({ url: '/v1/live/streams/live-test', headers });
    assert.equal(r.json().status, 'ready'); assert.equal(r.json().stream_key, 'customer-key');
    assert.equal(r.headers['cache-control'], 'no-store'); assert.doesNotMatch(r.body, /runner-secret/);
    f.pending(); r = await f.app.inject({ url: '/v1/live/streams/live-test', headers });
    assert.equal(r.json().status, 'opening'); assert.equal(r.json().stream_key, null);
    f.ending(); r = await f.app.inject({ url: '/v1/live/streams/live-test', headers });
    assert.equal(r.json().status, 'ending'); assert.equal(r.json().stream_key, null);
    f.foreign(); r = await f.app.inject({ url: '/v1/live/streams/live-test', headers });
    assert.equal(r.statusCode, 404); assert.doesNotMatch(r.body, /customer-key/);
  } finally { await f.app.close(); }
});
test('live listing is scoped to authenticated key and contains no ingest secrets', async () => {
  const f = fixture();
  try {
    const r = await f.app.inject({ url: '/v1/live/streams', headers });
    assert.equal(r.statusCode, 200); assert.equal(r.json().streams.length, 1);
    assert.doesNotMatch(r.body, /customer-key|runner-secret/);
    assert.equal((await f.app.inject({ url: '/v1/live/streams' })).statusCode, 401);
  } finally { await f.app.close(); }
});
