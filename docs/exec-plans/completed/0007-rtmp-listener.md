---
plan: 0007
title: Gateway RTMP listener — terminate RTMP at the gateway + per-stream broker routing + flip rtmp_push_url to gateway URL
status: completed
phase: shipped
opened: 2026-05-18
closed: 2026-05-18
owner: harness
related:
  - "docs/exec-plans/completed/0006-live-pipeline-port.md (closes the deferred half)"
  - "docs/design-docs/live-pipeline.md §2 (target end state vs v0 implementation reality)"
  - "docs/exec-plans/active/0001-initial-port-roadmap.md §3.2"
---

# Plan 0007 — gateway RTMP listener

## 1. Problem

Plan 0006 shipped the live HTTP surface but returned the **broker's**
`rtmp_push_url` to the customer (kind: `"broker_direct"`). The
customer's encoder pushes RTMP straight to the broker; the gateway
doesn't see the RTMP byte path at all.

Per the user-directed end state, the gateway should be the **single
ingress** for RTMP: customers push to a gateway-hosted URL, the
gateway parses the stream key, looks up the assigned broker for that
stream, and bridges the RTMP byte stream per-connection.

Source's `runtime/rtmp/{listener,proxy,keyParser}.ts` (91 lines) is a
**blind TCP relay** — accepts any TCP connection on :1935, pipes to a
single static broker host. That works only for single-broker deploys
and contradicts our resolver-aware multi-broker model. We won't port
those three files.

This plan ships a real gateway-side RTMP termination layer that
parses the RTMP `connect` AMF0 message to extract the stream key,
looks up `media.live_streams.stream_key_hash`, and opens a per-stream
TCP bridge to the broker recorded in `live_streams.worker_url`.

## 2. Library choice — node-media-server v4

Source's `video-gateway/package.json` already declares
`node-media-server@^4.0.5` as a dep but doesn't import it anywhere
(it was reserved for future work). We adopt it for real here.

Why node-media-server (not custom):

- Real RTMP protocol implementation (handshake, chunking, AMF0,
  control messages, codec messages — hundreds of edge cases)
- Active maintenance + MIT license + production-tested in CDN-style
  ingress
- Exposes `prePublish` event with the publish stream path
  (`/{app}/{streamKey}`) — exactly what we need for per-stream broker
  routing
- Has built-in relay session model we can hook into

Why not a custom AMF0 parser:

- RTMP chunked AMF0 is non-trivial: variable chunk sizes, message
  splitting across chunks, multiple AMF0 type tags, encoder-vendor
  quirks
- We'd still own all the edge cases
- node-media-server is ~10x more code than we'd write but it's
  battle-tested

## 3. Required invariants

Per [core-beliefs.md](../../design-docs/core-beliefs.md):

- **§2 Resolver-only.** The HTTP session-open path (plan 0006) still
  goes through the resolver to pick a broker. This plan just bridges
  the RTMP bytes once the broker is already chosen.
- **§4 No source modification.** Source has the dep but not the
  implementation; we write the implementation new.
- **§5 No billing creep.**
- **§8 No live → VOD recording.** node-media-server can do
  HLS / MP4 mux — **disable**; we only want it as RTMP server +
  relay.
- **§10 Docker-first.** New TCP port (default 1935) exposed in
  `compose.yaml`.
- **§15 Latest stable deps.** `node-media-server@^4.0.5` (matches
  source's existing pin).

## 4. Architecture

```
Customer's encoder
   |
   | RTMP (push)
   v
Gateway TCP :1935  --(node-media-server terminates RTMP)
   |
   | prePublish event with path /{app}/{streamKey}
   v
src/runtime/rtmp/dispatcher.ts
   |
   | sha256(streamKey) -> media.live_streams.stream_key_hash lookup
   | -> reads live_streams.worker_url
   |
   v
NodeRelaySession (RTMP push to worker_url)
   |
   | RTMP relay
   v
Capability-broker (the one picked by openRtmpSession in plan 0006)
   |
   | (broker runs FFmpeg + produces LL-HLS)
   v
Gateway /_hls/* strict-proxy (plan 0006) <-- viewer
```

Stream-key path convention (matches plan 0006's `parseStreamKey`):
`rtmp://gateway:1935/{app}/{streamKey}`. We use `live` as the app
name; full path is `rtmp://gateway:1935/live/<streamKey>`.

## 5. Execution

### 5.1 New deps

Add to `transcode-gateway/package.json`:

```
"node-media-server": "^4.0.5"
```

### 5.2 New env vars (`src/config.ts`)

| Env | Required for RTMP? | Default | Purpose |
|---|---|---|---|
| `RTMP_LISTEN_PORT` | yes (when relay enabled) | `1935` | Where the gateway's TCP listener binds |
| `RTMP_LISTEN_HOST` | no | `0.0.0.0` | Bind host (containers usually default fine) |
| `LIVEPEER_GATEWAY_EXTERNAL_RTMP_URL` | yes (when relay enabled) | (unset → fall back to plan-0006 broker URL) | The public RTMP URL the gateway is reachable at, e.g. `rtmp://stream.example.com:1935/live` — used in the `POST /v1/live/streams` response. When unset, the route returns broker's URL (plan 0006 behavior) |
| `RTMP_RELAY_ENABLED` | no | `true` when both above are set | Hard kill-switch for ops |

If `LIVEPEER_GATEWAY_EXTERNAL_RTMP_URL` is unset, the listener doesn't
start and `rtmp_push_url_kind` stays `"broker_direct"` — i.e. plan
0007 is opt-in; plan 0006's behavior is the default.

### 5.3 RTMP server (`src/runtime/rtmp/`)

New directory (not from source). Three files:

- `server.ts` — wraps `NodeMediaServer` from `node-media-server`.
  Disables HLS/DASH/recording; configures the RTMP port; exposes
  `start()` / `stop()` / event hooks (`prePublish`, `donePublish`).
- `dispatcher.ts` — on `prePublish`:
  - Parse the publish path `/{app}/{streamKey}` (drop the leading
    `/live/` app prefix to get the raw stream key)
  - `hashStreamKey(streamKey)` (sha256, matches plan 0006's
    `parseStreamKey` + `hashStreamKey` shape)
  - Look up `media.live_streams` by `stream_key_hash`. If missing or
    `ended`, **reject the publish** (NMS supports rejection via the
    event callback).
  - Read `live_streams.worker_url` → assemble broker RTMP URL using
    the broker's host (broker URL is typically https://; we derive
    the RTMP URL from `liveSessionDirectory.get(sessionId).brokerRtmpUrl`).
  - Spin up a `NodeRelaySession` (or equivalent v4 API) that pushes
    the publishing stream to the broker URL. Capture the relay
    handle for `donePublish` teardown.
- `index.ts` — re-exports + a `createRtmpListener(deps) → handle`
  factory.

### 5.4 Live route response flip (`src/routes/live/streams.ts`)

If `LIVEPEER_GATEWAY_EXTERNAL_RTMP_URL` is set, the route returns:

```ts
rtmp_push_url: `${config.LIVEPEER_GATEWAY_EXTERNAL_RTMP_URL}/${streamKey}`,
rtmp_push_url_kind: "gateway_relay",
```

(Otherwise, plan-0006 behavior unchanged: broker URL + `broker_direct`.)

`hls_playback_url` still comes from the broker via `openRtmpSession`
— that part doesn't change.

### 5.5 Wiring (`src/index.ts`, `src/server.ts`)

In `src/index.ts`:

```ts
let rtmpHandle: { stop(): Promise<void> } | null = null;
if (config.RTMP_RELAY_ENABLED && config.LIVEPEER_GATEWAY_EXTERNAL_RTMP_URL) {
  rtmpHandle = createRtmpListener({
    config,
    pool,
    liveStreamRepo,
    liveSessions,
    logger: consoleLogger,
  });
  consoleLogger.info("rtmp.listener.started", {
    port: config.RTMP_LISTEN_PORT,
    external_url: config.LIVEPEER_GATEWAY_EXTERNAL_RTMP_URL,
  });
} else {
  consoleLogger.info("rtmp.listener.disabled", {
    reason: "LIVEPEER_GATEWAY_EXTERNAL_RTMP_URL unset",
  });
}
```

Shutdown hook calls `rtmpHandle?.stop()`.

`src/server.ts` already has `liveSessions` in `ServerDeps` from plan
0006; the live route handler reads
`config.LIVEPEER_GATEWAY_EXTERNAL_RTMP_URL` to decide the response
shape.

### 5.6 compose.yaml

Expose port 1935:

```yaml
gateway:
  ports:
    - "4000:4000"
    - "1935:1935"
  environment:
    RTMP_LISTEN_PORT: "1935"
    LIVEPEER_GATEWAY_EXTERNAL_RTMP_URL: "rtmp://localhost:1935/live"
```

### 5.7 Update `live-pipeline.md`

Flip the "v0 reality" section from "Customer pushes to broker URL" →
"Customer pushes to gateway URL (when env set)." Update the state
machine if needed.

### 5.8 Update component AGENTS.md

Note the new `src/runtime/rtmp/` directory + dep.

### 5.9 Update transcode-gateway Dockerfile

Expose 1935.

### 5.10 Tests

- `test/runtime/rtmp/dispatcher.test.ts` — pure-function tests of
  the stream-key parsing + lookup logic (mock liveStreamRepo;
  publishing-rejection paths).

End-to-end RTMP smoke against a real OBS/FFmpeg push is **out of
scope** for this plan (requires a customer encoder + live broker;
deferred to plan 0016 e2e smoke).

## 6. Acceptance

1. `pnpm install` resolves with new `node-media-server` dep.
2. `pnpm lint` passes.
3. `pnpm test` passes (existing 33 + new dispatcher tests).
4. With **no new env vars**, gateway boots and `rtmp.listener.disabled`
   logs at startup. Live route still returns
   `rtmp_push_url_kind: "broker_direct"`. Auth + VOD + live HTTP
   regressions clean.
5. With `LIVEPEER_GATEWAY_EXTERNAL_RTMP_URL=rtmp://localhost:1935/live`
   set, gateway boots and `rtmp.listener.started` logs. `netstat`
   shows :1935 LISTEN. Live route returns
   `rtmp_push_url: "rtmp://localhost:1935/live/<streamKey>"`,
   `kind: "gateway_relay"`.
6. Every TS file ≤ 300 lines.
7. PLANS.md row for phase 5b flips to ✅.
8. `live-pipeline.md` updated.
9. Plan moves to `docs/exec-plans/completed/`.

## 7. Out of scope

- End-to-end RTMP push test with real encoder — plan 0016 (e2e smoke).
- node-media-server's HLS / DASH / MP4 transmuxing — disabled.
- node-media-server's auth callback — we use stream-key-hash lookup
  in the dispatcher instead.
- Multi-instance RTMP session state — single-instance v0
  (liveSessionDirectory is in-memory).
- RTMPS / RTMPT / RTMPE — RTMP only.
- WebRTC ingest.
- `reconnecting` status transitions on broker hiccups — useful, but
  needs more state machine work; deferred to phase 2 (livestream-stale-sweep
  background tick can cover the worst case).

## 8. Decision log

| Date | Decision | Why |
|---|---|---|
| 2026-05-18 | Adopt `node-media-server@^4` (matches source's existing dep pin) | Battle-tested RTMP impl; rolling our own AMF0 parser is real work for limited upside. Source already declared the dep — it was reserved for this work |
| 2026-05-18 | Opt-in via `LIVEPEER_GATEWAY_EXTERNAL_RTMP_URL` (not enabled by default) | Operators may not want the gateway as RTMP ingress (firewall constraints, NAT, ALB-without-TCP). When unset, plan-0006 behavior unchanged |
| 2026-05-18 | Don't port source's `runtime/rtmp/{listener,proxy,keyParser}.ts` | Source's 91-line blind TCP relay is incompatible with resolver-aware multi-broker routing. We write from scratch with NMS |
| 2026-05-18 | App name = "live" (single static app) | RTMP convention. `rtmp://gateway:1935/live/<streamKey>` |
| 2026-05-18 | Disable NMS's HLS / DASH / record outputs | Broker owns HLS; we only relay RTMP bytes |
| 2026-05-18 | dispatcher rejects publish on missing/ended live_streams row | The stream_key_hash IS the auth; rejection at the AMF0-handshake stage prevents tying up TCP resources |
| 2026-05-18 | No bisectable acceptance for RTMP byte flow | Real RTMP encoder push deferred to plan 0016 e2e. This plan's acceptance: clean lint + boot + correct route response shape based on env |
| 2026-05-18 | Single PR | Per [core-beliefs §13](../../design-docs/core-beliefs.md). Coherent unit |
