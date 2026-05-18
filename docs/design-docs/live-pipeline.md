# Live pipeline (RTMP + LL-HLS)

How a live stream moves from "customer's encoder pushes RTMP" to
"viewer plays LL-HLS." VOD is covered in
[transcode-pipeline.md](./transcode-pipeline.md).

## Two ingress modes — opt-in gateway relay

The gateway can act as the customer's RTMP ingress, or it can hand
the broker's URL back and let the customer push directly. Mode is
selected by the `LIVEPEER_GATEWAY_EXTERNAL_RTMP_URL` env var.

**Default (`LIVEPEER_GATEWAY_EXTERNAL_RTMP_URL` unset)**: `POST
/v1/live/streams` returns the **broker's** RTMP URL as `rtmp_push_url`
with `rtmp_push_url_kind: "broker_direct"`. The customer's encoder
pushes RTMP straight to the broker. The gateway is not in the RTMP
byte path.

**Opt-in (`LIVEPEER_GATEWAY_EXTERNAL_RTMP_URL=rtmp://gateway:1935/live`)**:
the route returns a **gateway-hosted** URL,
`rtmp_push_url_kind: "gateway_relay"`. The customer pushes to the
gateway; the gateway terminates RTMP via node-media-server, parses
the stream key from the AMF0 publish path, looks up
`media.live_streams.stream_key_hash`, finds the broker's RTMP URL in
the in-memory `liveSessionDirectory`, and spawns an `ffmpeg`
subprocess to relay the bytes (`-c copy -f flv`). Per-stream relay;
multiple concurrent streams each get their own ffmpeg process.

Both modes use the same HTTP path for session-open
(`POST /v1/live/streams` → `openRtmpSession` → broker `/v1/cap`).
The only thing that varies is what URL the customer's encoder sees
and whether bytes flow through the gateway socket.

## Surface

```
POST   /v1/live/streams              allocate live session + URLs
GET    /v1/live/streams/:id          inspect status
POST   /v1/live/streams/:id/end      end session
GET    /_hls/*                       LL-HLS strict-proxy to broker
GET    /v1/playback/:id              resolve playback URL
```

Customer-facing `/v1/live/*` routes are gated by the API key (see
[auth-model.md](./auth-model.md)). `/_hls/*` is **not** API-key-gated
— the URL itself is the bearer; operator CDN handles auth + caching
above the gateway.

## State machine

```
media.live_streams.status:
  active   → reconnecting (post-plan 0007 only)  → ended
                                                ↘ errored
```

(`reconnecting` is reserved; plan 0007's listener uses it.
Plan 0006 only flips `active → ended`.)

## Steps

### 1. Session-open (POST /v1/live/streams)

1. Caller hits `POST /v1/live/streams` with body `{ name?,
   encoding_tier?: "standard", offering? }`. API-key bearer required.
2. Gateway calls `livepeer/rtmpAdapter.ts::openRtmpSession` —
   this resolves a broker via `livepeer/routeSelector.ts`
   (resolver-only, per [core-beliefs §2](./core-beliefs.md)) and
   POSTs `/v1/cap` on the broker with `Livepeer-*` headers
   (`Capability: video:live.rtmp`, `Mode: rtmp-ingress-hls-egress@v0`,
   etc.).
3. Broker returns `{ session_id, rtmp_ingest_url, hls_playback_url,
   expires_at }`. Gateway records the route in
   `livepeer/liveSessionDirectory.ts` (in-memory `streamId/sessionId →
   route`).
4. Gateway inserts `media.live_streams` (status `active`, hashed
   stream key, `worker_url = broker.url`, selected capability /
   offering) and `media.playback_ids` (policy `public`, live-linked).
5. Returns `{ stream_id, api_key_id, name, session_id,
   rtmp_push_url, rtmp_push_url_kind, stream_key, hls_playback_url,
   playback_id, encoding_tier, expires_at, request_id }`.

Plan 0006: `rtmp_push_url` = broker's URL (`kind: "broker_direct"`).
Plan 0007: same field, but gateway URL (`kind: "gateway_relay"`).

### 2. RTMP ingest

**Plan 0006:** Customer's encoder connects directly to the broker
using the URL returned in step 1. The gateway is not involved in the
RTMP byte path. The broker handles handshake, parses the stream key,
runs FFmpeg, and produces LL-HLS.

**Plan 0007 (future):** Customer's encoder connects to the gateway.
The gateway terminates RTMP (`node-media-server`-class lib), extracts
the stream key from the AMF0 `connect` message, looks up
`media.live_streams.stream_key_hash` to find the assigned
`worker_url`, opens a per-stream TCP bridge to that broker, and pipes
bytes both directions. `reconnecting` status surfaces during transient
broker errors. `media.live_streams.status` flips `active →
reconnecting → active` automatically.

### 3. LL-HLS playback (strict proxy)

`GET /_hls/<sessionId>/<rest>` proxies to
`<session.brokerUrl>/_hls/<sessionId>/<rest>` **without** any
gateway-side caching, CORS headers, playlist rewriting, or
cache-control mutation. CDN concerns (caching, edge replication,
geo-routing) are operator add-ons — fronting the gateway with
CloudFront / Fastly / Cloudflare is the supported pattern.

The strict-proxy boundary is intentional. The gateway does **not**
re-host segments; it forwards bytes. This keeps the trust spine simple
(broker is the origin) and avoids stale-cache divergence.

### 4. Playback URL resolution

`GET /v1/playback/:id` resolves an opaque `playback_id` to a playback
URL:

- Live-linked: returns `{ playback_id, live_stream_id, hls_url,
  policy }` where `hls_url` is the broker's `hls_playback_url` recorded
  in `liveSessionDirectory`. 404 if no session is active.
- VOD-linked: see
  [transcode-pipeline.md](./transcode-pipeline.md) — returns a signed
  HLS URL from storage.

### 5. End

The session ends two ways in plan 0006:

1. **Explicit:** `POST /v1/live/streams/:id/end` — gateway sets
   `media.live_streams.status='ended'`, `ended_at = now`, removes from
   `liveSessionDirectory`. Idempotent (200 OK if already ended).
2. **Stuck-session sweep:** the engine repo interface
   (`LiveStreamRepo.sweepStale(cutoff)`) exists but has no caller yet
   — wired in a future plan when needed.

Plan 0007 adds a third path: **Disconnect.** The gateway's RTMP
listener notifies when the customer's TCP socket closes and the
gateway calls broker close-session.

## Data model

```sql
CREATE TABLE media.live_streams (
  id                                 TEXT PRIMARY KEY,
  api_key_id                         UUID NOT NULL REFERENCES auth.api_keys(id) ON DELETE RESTRICT,
  name                               TEXT,
  stream_key_hash                    TEXT NOT NULL UNIQUE,
  status                             TEXT NOT NULL,                  -- active | reconnecting | ended | errored
  ingest_protocol                    TEXT NOT NULL DEFAULT 'rtmp',
  session_id                         TEXT,
  worker_id                          TEXT,
  worker_url                         TEXT,
  selected_capability                TEXT,
  selected_offering                  TEXT,
  selected_work_unit                 TEXT,
  selected_price_per_work_unit_wei   TEXT,
  last_seen_at                       TIMESTAMPTZ,
  created_at                         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at                           TIMESTAMPTZ
);

CREATE TABLE media.playback_ids (
  id              TEXT PRIMARY KEY,
  api_key_id      UUID NOT NULL REFERENCES auth.api_keys(id) ON DELETE RESTRICT,
  asset_id        TEXT REFERENCES media.assets(id) ON DELETE CASCADE,
  live_stream_id  TEXT REFERENCES media.live_streams(id) ON DELETE CASCADE,
  policy          TEXT NOT NULL,
  token_required  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT playback_ids_one_target CHECK ((asset_id IS NOT NULL) <> (live_stream_id IS NOT NULL))
);
```

`recording_enabled` + `recording_asset_id` columns from the source
schema are **omitted in v0** (no live→VOD handoff — see
[core-beliefs §8](./core-beliefs.md)).

## Cross-cutting

- **RTMP listener** (plan 0007): RTMP-parsing library + per-stream
  broker routing. Not yet implemented.
- **Live-session directory**: `livepeer/liveSessionDirectory.ts` —
  in-process map of `streamId/sessionId → route`. Multi-instance
  deployments need an external store (deferred).
- **Route selection**: `livepeer/routeSelector.ts` +
  `livepeer/routeHealth.ts` + `livepeer/selectionPolicy.ts`
  (`buildLiveSelectionHints` builds `Livepeer-Selector-Extra` payload
  hinting at `video.mode = "live"`, `ingress = "rtmp"`, `egress =
  "hls"`, encoding tier, required codecs, max resolution).
- **`gateway-route-health`**: inlined into
  `transcode-gateway/src/livepeer/routeHealth.ts` rather than carried
  as a workspace dep (see [core-beliefs §1](./core-beliefs.md)).

## What's NOT in v0

- `record_to_vod` parameter on `POST /v1/live/streams`
- `service/recordingHandoff.ts`
- `media.recordings` table
- Live → VOD bridge of any kind
- WebRTC ingest (deferred to phase 2; only RTMP in v0 schema)
- Per-customer ABR-ladder customization (`customer_tier` body field)
- `/admin/live-streams/*` ops endpoints
- Gateway-side RTMP listener with per-stream broker routing —
  **plan 0007**, deferred from this plan due to scope

## Provenance

Live HTTP surface ported from
`livepeer-network-modules/video-gateway/src/{routes/live-streams.ts,
livepeer/{rtmp-adapter,liveSessionDirectory}.ts, routes/playback.ts (`_hls/*` half)}`
per [plan 0006](../exec-plans/completed/0006-live-pipeline-port.md).
The broker-side RTMP / FFmpeg / LL-HLS pipeline lives in
`livepeer-network-modules/capability-broker/` (external peer; not in
this repo).

Gateway-side RTMP relay is plan 0007 (still queued).
