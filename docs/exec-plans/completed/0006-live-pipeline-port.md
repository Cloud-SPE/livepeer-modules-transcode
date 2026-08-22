---
plan: 0006
title: Live pipeline — POST /v1/live/streams + /_hls/* strict-proxy + rtmp-adapter + liveSessionDirectory + live selection hints
status: completed
phase: shipped
opened: 2026-05-18
closed: 2026-05-18
owner: harness
related:
  - "docs/exec-plans/completed/0005-vod-routes-port.md (sibling product surface)"
  - "docs/exec-plans/completed/0004-wire-layer-port.md (routeSelector + workerResolver already in)"
  - "docs/design-docs/live-pipeline.md (live design — needs an update; see §6)"
  - "docs/design-docs/core-beliefs.md §8 (no live→VOD recording handoff in v0)"
  - "docs/exec-plans/completed/0001-initial-port-roadmap.md §3.2 (sequencing)"
---

# Plan 0006 — live pipeline port

## 1. Problem

After plan 0005 the gateway can drive VOD end-to-end. Live RTMP +
LL-HLS is the second customer-facing surface and the last piece of the
gateway's product API. Without it, customers can't push a stream.

The source layout splits live across:

| Source file | What it does | LOC |
|---|---|---|
| `livepeer/liveSessionDirectory.ts` | in-memory `streamId/sessionId → route` map | 31 |
| `livepeer/rtmp-adapter.ts` | `openRtmpSession(...)` — broker HTTP session-open + retry/health | 109 |
| `livepeer/selectionPolicy.ts` (live half) | `buildLiveSelectionHints`, `candidateSupportsLive` | ~70 of 219 |
| `routes/live-streams.ts` | `POST /v1/live/streams`, `GET /v1/live/streams/:id`, `POST /v1/live/streams/:id/end` | 372 |
| `routes/playback.ts` (`/_hls/*` half) | gateway-side strict-proxy of LL-HLS playlist + segments to broker | ~25 of 77 |
| `runtime/rtmp/{listener,proxy,keyParser}.ts` | raw TCP relay for an optional gateway-hosted RTMP listener | 91 |

## 2. Design alignment — gateway-as-single-ingress (target end state, two-plan path)

**Target end state** (user-directed): the gateway is the single
customer-facing ingress for RTMP. Customer's `rtmp_push_url` points at
the gateway; the gateway terminates RTMP, parses the stream key from
the RTMP `connect` AMF0 message, looks up
`media.live_streams.workerUrl` (set when the HTTP session-open
returned), and opens a per-stream TCP bridge to the assigned broker.

This needs real RTMP `connect`-message parsing (node-media-server-class
library or equivalent), per-stream broker routing, and disconnect /
error / stuck-session handling. **That is non-trivial** — easily
~400+ lines plus a heavy dep — and warrants its own focused exec-plan
with its own decision log.

**Two-plan path:**

- **Plan 0006 (this plan)** — ships the live HTTP surface end-to-end
  (session-open, get, end, HLS strict-proxy), the broker adapter, the
  live selection hints, and the in-memory session directory. **No RTMP
  listener.** For the duration of this plan the route returns the
  broker's RTMP URL as `rtmp_push_url` — temporary; documented as
  "deferred to plan 0007" in the route handler + in
  `live-pipeline.md`. Customer can push RTMP and play LL-HLS *today*
  with a real broker, just not through the gateway's TCP socket yet.
- **Plan 0007 (new)** — gateway-side RTMP listener with per-stream
  broker routing. Adds `node-media-server` (or equivalent), per-stream
  bridge, stream-key-hash lookup, disconnect handling. Flips
  `rtmp_push_url` in the live route response from broker URL to gateway
  URL. The runner ports (transcode-core, transcode-runner, abr-runner,
  codecs-builder, transcode-tester) and frontends (site, portal,
  admin) all renumber by +1 (becoming 0008–0015).

Source's `runtime/rtmp/{listener,proxy,keyParser}.ts` (91 lines, a
blind TCP relay) is **NOT what we want** — it doesn't parse RTMP and
only works with a single static broker. Plan 0007 will not port those
files verbatim; it will replace them with a real RTMP-parsing pathway
that integrates with `liveSessionDirectory` for per-stream broker
routing.

This contradicts the original
[`docs/design-docs/live-pipeline.md`](../../design-docs/live-pipeline.md)
wording ("Customer pushes RTMP to the gateway's pure-TS listener…")
— which described the target end state in the same words but did not
acknowledge the implementation gap. The doc gets updated in §4.9 of
this plan to call out the two-plan path explicitly.

## 3. Required invariants

Per [core-beliefs.md](../../design-docs/core-beliefs.md):

- **§2 Resolver-only.** Live session-open goes through `routeSelector`
  → real impl when env set, stub otherwise.
- **§4 Read-only source repos.** Cite source paths in commits.
- **§5 No pricing.** Drop `usageLedger.getChargeByLiveStream`,
  `usageLedger.recordLiveUsage`, `serializeCharge`, `cost_accrued_cents`.
- **§6 No projects.** `project_id` body field → `api_key_id` (scoped
  from `req.apiKey.id`).
- **§7 No webhooks.** No callbacks on session lifecycle.
- **§8 No live → VOD recording.** Drop `record_to_vod`,
  `recording_enabled`, `recordingsRepo`, `maybeHandoffRecording`,
  `recording_asset_id` field, `recording_execution_id` field.
- **§10 Docker-first.** No new host dependencies.
- **§15 Deps current.** No new deps added.

Plus from plan 0001 / VOD port pattern:

- API-key bearer middleware (`userApiKeyAuth` from plan 0005) gates
  all three live routes.
- Stream is scoped by `api_key_id`; GET / END both verify
  `liveStream.apiKeyId === req.apiKey.id` (404 on mismatch — no
  enumeration leak).
- `randomHex16()` (source uses `Math.random()`) → `crypto.randomBytes`.
- No `customer_tier` in request — caller picks `encoding_tier`
  directly, default `"standard"` (matches VOD shape from plan 0005).

## 4. Execution

### 4.1 Port `livepeer/liveSessionDirectory.ts`

Verbatim — 31 lines. `createLiveSessionDirectory() → { record, get, getByStreamId }`.

### 4.2 Port `livepeer/rtmp-adapter.ts`

Verbatim — 109 lines. `openRtmpSession(input) → { sessionId,
brokerRtmpUrl, hlsUrl, expiresAt, requestId, brokerUrl }`. Calls
broker `/v1/cap` with `Livepeer-*` headers, parses response, records
route outcomes for health tracking.

### 4.3 Port live half of `livepeer/selectionPolicy.ts`

Extend the existing `livepeer/selectionPolicy.ts` (which currently only
has the VOD half) with `buildLiveSelectionHints` + `candidateSupportsLive`.
**Edits vs source:**

- Drop `customerTier` field from `LiveSelectionProfile` (we infer
  codec set from `encodingTier` instead).
- Drop `recordToVod` field (and the related candidate filter).
- Reuse the existing JSON-traversal helpers in the file.

Final shape:

```ts
export interface LiveSelectionProfile {
  encodingTier: EncodingTier;
  ladder: RenditionSpec[];   // caller-supplied or derived from tier
}

export function buildLiveSelectionHints(profile: LiveSelectionProfile): DerivedSelectionHints { … }
```

### 4.4 Live routes — `src/routes/live/streams.ts`

New file (replaces source's `routes/live-streams.ts`). Three routes,
all gated by API key.

| Method | Path | Behavior |
|---|---|---|
| `POST` | `/v1/live/streams` | Body: `{ name?, encoding_tier?: "standard", offering? }`. Call `openRtmpSession`, store `media.live_streams` row, register session in `liveSessionDirectory`, return `{ stream_id, name, session_id, rtmp_push_url, stream_key, hls_playback_url, abr_ladder, expires_at, request_id }`. |
| `GET` | `/v1/live/streams/:id` | Scope-check `api_key_id`. Returns stream row + current session info. No billing fields. |
| `POST` | `/v1/live/streams/:id/end` | Scope-check. Update `media.live_streams.status = 'ended'`, `ended_at = now`. Idempotent (returns 200 if already ended). No recording handoff. No billing accumulation. |

Stream id: `live_<16 hex>`. Stream-key hash: `sha256(streamKey)` —
matches source. Stored in `media.live_streams.stream_key_hash` (UNIQUE).

Per [core-beliefs §6](../../design-docs/core-beliefs.md): the
`project_id` body field from source is removed. Stream rows always
scope by `api_key_id`.

Per [auth-model.md](../../design-docs/auth-model.md) consistency:
default `encoding_tier` is `"standard"` (NOT source's `"free"` customer
tier → baseline encoding).

### 4.5 Live playback — extend `src/routes/vod/playback.ts`

Currently plan 0005 stubs the live half with 501
`live_playback_not_yet_implemented`. Replace with: look up
`media.playback_ids.liveStreamId` → look up session via
`liveSessionDirectory.getByStreamId(liveStreamId)` → return
`{ playback_id, live_stream_id, hls_url: session.hlsPlaybackUrl }`.

Note: live `playback_ids` rows are created at session creation (in the
new live route handler), not at session-ready (live has no "ready"
event the way VOD does).

### 4.6 `/_hls/*` strict-proxy — `src/routes/live/hlsProxy.ts`

New file. Source's `routes/playback.ts` has this; the per-CDN strict
proxy that forwards LL-HLS playlist + segment requests to the broker
without rewriting headers / caching. From source:

```
GET /_hls/<sessionId>/<rest>
  → upstream = `${session.brokerUrl}/_hls/<sessionId>/<rest>`
  → fetch upstream, forward bytes + headers verbatim
  → 404 if session not in liveSessionDirectory
```

No API-key auth on `/_hls/*` (matches source) — the URL itself is the
bearer (operator's CDN handles auth + caching above the gateway). Per
[live-pipeline.md](../../design-docs/live-pipeline.md): strict proxy,
no rewrites.

### 4.7 Wire `src/index.ts` + `src/server.ts`

- In `index.ts`: instantiate `liveSessionDirectory` (a process-singleton
  in-memory map). Pass to server.
- In `server.ts`: register the two new route groups —
  `registerLiveStreams(app, { … })` and `registerHlsProxy(app, { … })`.
  `ServerDeps` grows by one field: `liveSessions: LiveSessionDirectory`.

### 4.8 Update `livepeer/index.ts`

Re-export the newly-ported `liveSessionDirectory` + rtmp-adapter
symbols.

### 4.9 Update design doc — `docs/design-docs/live-pipeline.md`

Fix the v0 reality (§2 above). Change "Customer pushes RTMP to the
gateway's pure-TS listener" → "Customer pushes RTMP to the resolved
broker URL returned in the session-open response." Note the
gateway-side TCP relay (`runtime/rtmp/`) as a phase-2 add.

### 4.10 Unit tests

- `test/livepeer/selectionPolicy.live.test.ts` —
  `buildLiveSelectionHints` produces hints whose `preferredExtra`
  mentions `video.mode = "live"`, ingress = "rtmp", egress = "hls".
  `candidateSupportsLive` filter rejects candidates that don't declare
  live mode.
- `test/livepeer/liveSessionDirectory.test.ts` — record + lookup by
  both `sessionId` and `streamId`; null on miss.

Integration test against a real broker is out of scope (no broker in
CI). The stub `workerResolver` returns `null`, so live session-open
returns 503 `no_live_route` — exercised by the smoke.

## 5. Acceptance

Plan is **complete** when:

1. `pnpm -F @livepeer-modules-transcode/transcode-gateway lint` passes.
2. `pnpm -F @livepeer-modules-transcode/transcode-gateway test` passes
   (existing 26 + ~4 new live tests).
3. Boot with **no new env vars**: gateway boots, all auth + VOD
   surfaces continue to work (regression check). Live surface returns
   503 `no_live_route` on POST `/v1/live/streams` (because stub
   resolver returns empty).
4. `GET /_hls/foo` returns 404 `playback_session_not_found` when no
   live session exists (default state).
5. Every TS file ≤ 300 lines. Source's `live-streams.ts` is 372 lines;
   after cuts (drop billing + recording + projects) should land
   under 250.
6. `live-pipeline.md` updated to match v0 reality (§4.9 above).
7. `PLANS.md` roadmap row for phase 5 (live) flips to ✅.
8. This plan moves to `docs/exec-plans/completed/`.

## 6. Out of scope

- **Gateway-side RTMP listener with per-stream broker routing —
  plan 0007 (new).** Until that ships, the `POST /v1/live/streams`
  response returns the broker's `rtmp_push_url` directly. Customer
  pushes RTMP straight to the broker. The route handler explicitly
  comments this as deferred. Plan 0007 will flip the URL to a
  gateway-hosted URL and add the listener + per-stream relay.
- Live → VOD recording handoff — phase 2 (per core-beliefs §8).
- WebRTC ingest — phase 2 (RTMP is the only `ingestProtocol` in v0
  schema).
- Per-customer ABR-ladder customization (`customer_tier` field) —
  phase 2.
- `/admin/video/*` ops endpoints (resolver candidates, route-health
  metrics, route-controls) — separate admin frontend plan.
- Live session stuck-sweep background tick (`liveStreamRepo.sweepStale`)
  — exists in engine repo interface (plan 0003) but no caller yet;
  wire later when needed.

## 7. Decision log

| Date | Decision | Why |
|---|---|---|
| 2026-05-18 | Split live work into 0006 (HTTP surface) + 0007 (RTMP relay) | Real per-stream broker routing needs RTMP parsing + lifecycle handling — ~400+ extra lines + heavy dep (node-media-server-class). Coherent unit of its own. Plan 0006 ships the live HTTP surface and the broker call; plan 0007 ships the gateway-side RTMP termination + relay. The post-roadmap plans (runners, frontends) renumber to 0008–0015 |
| 2026-05-18 | This plan returns the broker's RTMP URL temporarily | Plan 0007 flips it to gateway-hosted URL. Documented in the route handler + the design doc. Customer can still push RTMP + play LL-HLS today (just not through the gateway socket) |
| 2026-05-18 | Update `live-pipeline.md` to describe two-plan path | Original doc described the target end state ("customer pushes to gateway") without the implementation gap. Honest doc says both: end state is gateway-ingress (plan 0007), v0 ships with broker-URL passthrough (plan 0006) |
| 2026-05-18 | Drop `customer_tier` body field; use `encoding_tier` directly | Matches VOD route shape from plan 0005. v0 has no per-customer tier negotiation |
| 2026-05-18 | Default `encoding_tier` is `"standard"` (not source's `"free"` mapping) | Consistency with VOD (plan 0005); per [auth-model.md](../../design-docs/auth-model.md) |
| 2026-05-18 | Create `media.playback_ids` row at session creation (not at "ready") | Live streams don't have a "ready" event the way VOD assets do (post-finalize). Session-create is the only natural insert point |
| 2026-05-18 | `/_hls/*` is NOT API-key-gated | Matches source. Playback URLs are themselves opaque bearer tokens. Operator-side CDN handles auth + caching above the gateway |
| 2026-05-18 | Extend existing `selectionPolicy.ts` (not split into two files) | The VOD + live halves share ~5 helpers; keeping them in one file is cleaner than duplicating helpers across two files. Still under 300-line cap after extension |
| 2026-05-18 | Single PR (live routes + adapter + directory + selection-hints extension + HLS proxy + doc-fix + tests) | Per [core-beliefs §13](../../design-docs/core-beliefs.md) throughput-friendly; coherent unit |
