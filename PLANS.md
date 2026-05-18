# PLANS

Current state of work in this repo, plus pointers to active plans.

## Current state

**Docs scaffold + auth + engine + wire + VOD + live HTTP surface complete.**
The repo contains:

- The agent-first harness scaffold per plan 0001.
- A bootable `transcode-gateway/` Fastify service with the Blueclaw-shaped
  auth surface per plan 0002.
- The TS engine + `media.*` schema + concrete drizzle repos per plan 0003.
- The wire layer (capability map, headers, payment minting via
  payer-daemon UDS, resolver-aware route selector against
  `service-registry-daemon`, vendored protos, real worker client +
  resolver-backed worker resolver) per plan 0004.
- The VOD route surface per plan 0005: presigned-S3-PUT upload (no tus),
  API-key-bearer middleware, `POST /v1/uploads`,
  `POST /v1/uploads/:id/complete`, `POST /v1/vod/submit` (fire-and-forget
  `probeAndSchedule`), `GET /v1/vod/:asset_id`, `GET /v1/videos/assets`,
  `GET /v1/videos/assets/:id`, `DELETE /v1/videos/assets/:id`. S3
  storage provider, VOD selection-policy hints, ABR ladder selector.
- The live HTTP surface per
  [`docs/exec-plans/completed/0006-live-pipeline-port.md`](./docs/exec-plans/completed/0006-live-pipeline-port.md):
  `POST /v1/live/streams` (session-open via broker), `GET /v1/live/streams/:id`,
  `POST /v1/live/streams/:id/end`, `GET /_hls/*` (strict-proxy to broker),
  `GET /v1/playback/:id` extended to serve live too. `liveSessionDirectory`,
  `rtmpAdapter`, live half of `selectionPolicy`. The route returns the
  broker's RTMP URL as `rtmp_push_url` (kind `broker_direct`); plan 0007
  will flip the URL to a gateway-hosted listener. 33 unit tests pass;
  auth + VOD regressions clean. `live-pipeline.md` updated to describe
  the two-plan transition.

Frontends (plans 0013–0015) and the e2e smoke (plan 0016) plus the
integration smoke harness (plan 0012) have not been ported yet.
Each lands under its own numbered exec-plan, sequenced by the roadmap.

## Active plans

| Plan | Title | Status |
|---|---|---|
| [0001](./docs/exec-plans/active/0001-initial-port-roadmap.md) | Initial port roadmap — sequencing component ports from `livepeer-network-modules` | active (gateway + runners + RTMP listener done; tester + frontends queued) |

## Completed plans

| Plan | Title | Closed |
|---|---|---|
| [0002](./docs/exec-plans/completed/0002-auth-blueclaw-port.md) | Auth — waitlist + admin approval + emailed API key + portal login | 2026-05-18 |
| [0003](./docs/exec-plans/completed/0003-engine-port.md) | Engine — types, interfaces, repo, service, dispatch + media.* migration | 2026-05-18 |
| [0004](./docs/exec-plans/completed/0004-wire-layer-port.md) | Wire layer — real WorkerClient + WorkerResolver (resolver-aware, payment-aware) | 2026-05-18 |
| [0005](./docs/exec-plans/completed/0005-vod-routes-port.md) | VOD routes — upload + submit + asset + playback (API-key auth, real S3) | 2026-05-18 |
| [0006](./docs/exec-plans/completed/0006-live-pipeline-port.md) | Live pipeline — `/v1/live/streams` + `/_hls/*` proxy + adapter + session directory + live selection hints | 2026-05-18 |
| [0007](./docs/exec-plans/completed/0007-rtmp-listener.md) | Gateway RTMP listener (NMS + ffmpeg per-stream relay) — flips rtmp_push_url to gateway URL when env set | 2026-05-18 |
| [0008](./docs/exec-plans/completed/0008-transcode-core-port.md) | transcode-core — Go shared library (FFmpeg + GPU + presets + HLS + progress + thumbnails + filters) | 2026-05-18 |
| [0009](./docs/exec-plans/completed/0009-transcode-runner-port.md) | transcode-runner — Go single-rendition VOD binary | 2026-05-18 |
| [0010](./docs/exec-plans/completed/0010-abr-runner-port.md) | abr-runner — Go multi-rendition (ABR ladder) VOD binary | 2026-05-18 |
| [0011](./docs/exec-plans/completed/0011-codecs-builder-port.md) | codecs-builder — Dockerfile-only base image (x264 + SVT-AV1 + libopus + libvpx + libzimg) | 2026-05-18 |

## Roadmap (rough; subject to change)

Sequencing is driven by [`docs/exec-plans/active/0001-initial-port-roadmap.md`](./docs/exec-plans/active/0001-initial-port-roadmap.md).
Each row below becomes its own numbered exec-plan when picked up.

| Phase | Outcome | Component subfolder | Status |
|---|---|---|---|
| 0 | Docs + workspace scaffold | (root) + `docs/` | ✅ shipped |
| 1 | Auth (waitlist + sessions + API keys) ported from Blueclaw shape | `transcode-gateway/src/auth/` | ✅ shipped (plan 0002) |
| 2 | Engine + types + interfaces + dispatch (no live, no VOD route handlers yet) | `transcode-gateway/src/engine/` | ✅ shipped (plan 0003) |
| 3 | Wire layer (capability map, headers, payment, resolver routing) | `transcode-gateway/src/livepeer/` | ✅ shipped (plan 0004) |
| 4 | VOD pipeline routes (`/v1/uploads`, `/v1/vod/*`, `/v1/videos/assets`, `/v1/playback/:id`) | `transcode-gateway/src/routes/` | ✅ shipped (plan 0005) |
| 5a | Live HTTP surface (`/v1/live/streams`, `/_hls/*` proxy, adapter, session directory) | `transcode-gateway/src/routes/live/` + `src/livepeer/` | ✅ shipped (plan 0006) |
| 5b | Gateway-side RTMP listener with per-stream broker routing (RTMP-parsing lib) | `transcode-gateway/src/runtime/rtmp/` | ✅ shipped (plan 0007) |
| 6 | `transcode-core` Go library port | `transcode-core/` | ✅ shipped (plan 0008) |
| 7 | `transcode-runner` Go binary port | `transcode-runner/` | ✅ shipped (plan 0009) |
| 8 | `abr-runner` Go binary port | `abr-runner/` | ✅ shipped (plan 0010) |
| 9 | `codecs-builder` Docker base port | `codecs-builder/` | ✅ shipped (plan 0011) |
| 10 | `transcode-tester` Node smoke harness port | `transcode-tester/` | ⏳ queued (plan 0012) |
| 11 | `site/` waitlist signup (Vite + Lit) | `site/` | ✅ shipped (plan 0013) |
| 12 | `portal/` user portal (Vite + Lit) | `portal/` | ✅ shipped (plan 0014) |
| 13 | `admin/` admin dashboard (Vite + Lit) | `admin/` | ⏳ queued (plan 0015) |
| 14 | End-to-end smoke (compose stack + fixture VOD + fixture live) | (cross-cutting) | ⏳ queued (plan 0016) |

## What does not exist yet

Everything outside the scaffold. See the roadmap above; each row is a
queued port from `livepeer-network-modules` (for video pipeline code) or
from the Blueclaw shape (for auth + frontend layouts).

## Versioning

Pre-1.0.0 on a coordinated monorepo release line. Components inside the
monorepo do not have independent versions yet; when a component is
extracted to a standalone repo, its versioning becomes its own concern.

This module's release line is **independent of `livepeer-network-modules`**.
The source repo continues to ship on its own cadence; copies into this
repo are deliberate, commit-recorded decisions, not synced bumps.

## Tracking debt

[`docs/exec-plans/tech-debt-tracker.md`](./docs/exec-plans/tech-debt-tracker.md).
Append as debt accumulates.
