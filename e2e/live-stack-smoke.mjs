// Run inside the local gateway container after copying this file to its working
// directory. Creates a dedicated local test account (no email), opens ONE paid
// session using configured LOC limits, publishes a 20s test pattern, verifies
// HLS, and requests end. Leaves accounting records for audit; revokes test key.
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { loadConfig } from './dist/config.js';
import { createApiKey, revokeApiKey } from './dist/auth/apiKeys.js';
const config = loadConfig(process.env);
const pool = new pg.Pool({ connectionString: config.DATABASE_URL });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let key, streamId, publisher, publishDeadline;
async function api(path, body) {
  const r = await fetch('http://127.0.0.1:4000' + path, { method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${key.rawKey}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(100000) });
  const data = await r.json();
  if (!r.ok) throw new Error(`gateway ${r.status}: ${data.error ?? 'request_failed'}`);
  return data;
}
try {
  const email = `live-smoke-${randomUUID()}@example.invalid`;
  const { rows: [w] } = await pool.query("insert into auth.waitlist(name,email,status,email_verified,approved_at) values ('Live lifecycle smoke',$1,'approved',true,now()) returning id", [email]);
  const { rows: [u] } = await pool.query('insert into auth.users(waitlist_id,email) values($1,$2) returning id', [w.id, email]);
  key = await createApiKey(pool, u.id, config.API_KEY_HASH_PEPPER);
  const opened = await api('/v1/live/streams', { name: 'Bounded live lifecycle smoke', encoding_tier: 'standard' });
  streamId = opened.stream_id;
  console.log(JSON.stringify({ phase: 'create', stream_id: streamId, status: opened.status }));
  let stream;
  for (let i = 0; i < 24; i++) {
    stream = await api(`/v1/live/streams/${streamId}`);
    if (stream.stream_key && stream.status === 'ready') break;
    if (i % 2 === 0) console.log(JSON.stringify({ phase: 'opening', status: stream.status, operation: stream.paid_operation?.state, error: stream.paid_operation?.error_code }));
    await sleep(5000);
  }
  if (!stream?.stream_key || stream.status !== 'ready') throw new Error('stream did not become ready within 120 seconds');
  const target = `${stream.rtmp_push_url.replace(/\/$/,'')}/${stream.stream_key}`;
  publisher = spawn('ffmpeg', ['-hide_banner','-loglevel','error','-re','-f','lavfi','-i','testsrc2=size=1280x720:rate=30','-f','lavfi','-i','sine=frequency=1000:sample_rate=48000','-t','20','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-g','60','-c:a','aac','-f','flv',target], { stdio: ['ignore','ignore','pipe'] });
  publishDeadline = setTimeout(() => publisher.kill('SIGTERM'), 45000);
  let bytes = 0; publisher.stderr.on('data', d => { bytes += d.length; });
  const published = new Promise(resolve => publisher.on('exit', code => resolve({ code, error_bytes: bytes })));
  let hls = false;
  for (let i = 0; i < 12; i++) {
    await sleep(2000);
    stream = await api(`/v1/live/streams/${streamId}`);
    const url = stream.playback_url;
    if (url) {
      try {
        const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
        if (r.ok) {
          let playlist = await r.text(), playlistUrl = url;
          if (playlist.includes('#EXT-X-STREAM-INF')) {
            const variant = playlist.split('\n').find(line => line.trim() && !line.startsWith('#'));
            if (variant) { playlistUrl = new URL(variant.trim(), url).href; playlist = await (await fetch(playlistUrl, { signal: AbortSignal.timeout(5000) })).text(); }
          }
          const segment = playlist.split('\n').find(line => line.trim() && !line.startsWith('#'));
          if (playlist.includes('#EXTINF') && segment) {
            const media = await fetch(new URL(segment.trim(), playlistUrl), { signal: AbortSignal.timeout(5000) });
            if (media.ok && (await media.arrayBuffer()).byteLength > 0) { hls = true; break; }
          }
        }
      } catch {}
    }
  }
  const publishResult = await published;
  console.log(JSON.stringify({ phase: 'publish', ...publishResult, hls_media_segment: hls }));
  await api(`/v1/live/streams/${streamId}/end`, {});
  let settled = false;
  for (let i = 0; i < 18; i++) {
    stream = await api(`/v1/live/streams/${streamId}`);
    if (stream.paid_operation?.state === 'settled') { settled = true; break; }
    if (i % 2 === 0) console.log(JSON.stringify({ phase: 'closing', status: stream.status, operation: stream.paid_operation?.state, error: stream.paid_operation?.error_code }));
    await sleep(5000);
  }
  console.log(JSON.stringify({ phase: 'result', published: publishResult.code === 0, hls_media_segment: hls, settled }));
  if (!hls || publishResult.code !== 0 || !settled) process.exitCode = 1;
} catch (error) {
  console.log(JSON.stringify({ phase: 'failed', message: error.message })); process.exitCode = 1;
} finally {
  clearTimeout(publishDeadline);
  if (publisher && publisher.exitCode === null) publisher.kill('SIGTERM');
  if (streamId) {
    try { await api(`/v1/live/streams/${streamId}/end`, {}); } catch { console.log('End pending: durable recovery record retained.'); }
  }
  if (key) await revokeApiKey(pool, key.id);
  await pool.end();
}
