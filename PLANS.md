# PLANS

Current state of work in this repo, plus pointers to active plans.

## Current state

**Local Modules v2 development is complete; release acceptance remains.**
The gateway now uses resolver-selected routes and LOC exclusively. One VOD
ladder is one durable streaming `paid-job/v1` exchange; live RTMP is one
recoverable `paid-session/v1` session with separate customer and runner
credentials, bounded refills, rotation/rebind, authoritative reconciliation,
and settlement-safe winddown. Public/admin lifecycle surfaces and OpenAPI are
shipped. The legacy mode, direct payer, compatibility proto, and mock stack
have been deleted.

The remaining frontier is the immutable upstream readiness evidence, joint
real-process matrix, repository-wide release gates, and coordinated deploy /
whole-release rollback drill tracked in Beads epic `lmt-65a`.

## Active plans

| Plan | Title | Tracker |
|---|---|---|
| [0018](./docs/exec-plans/active/0018-livepeer-modules-v2-migration.md) | Breaking migration to `paid-job/v1`, `paid-session/v1`, and LOC | Beads epic `lmt-65a` |

The exec-plan records architecture and release criteria. Beads remains the
sole live status/dependency tracker.

## Completed plans

| Plan | Title | Closed |
|---|---|---|
| [0001](./docs/exec-plans/completed/0001-initial-port-roadmap.md) | Initial port roadmap — sequencing component ports from `livepeer-network-modules` | 2026-08-22 |
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
| [0013](./docs/exec-plans/completed/0013-site-port.md) | site/ — Vite + Lit waitlist signup (public-facing marketing + signup form) | 2026-05-18 |
| [0014](./docs/exec-plans/completed/0014-portal-port.md) | portal/ — Vite + Lit user portal (account + asset library + live streams + upload) | 2026-05-18 |
| [0015](./docs/exec-plans/completed/0015-admin-port.md) | admin/ — Vite + Lit admin dashboard (waitlist approval + stats) | 2026-05-18 |
| [0012](./docs/exec-plans/completed/0012-transcode-tester-port.md) | transcode-tester — Node integration smoke harness for transcode-runner + abr-runner | 2026-05-18 |
| [0016](./docs/exec-plans/completed/0016-e2e-smoke.md) | e2e/ — compose-stack smoke (gateway + postgres + MinIO + fixture flows) | 2026-05-18 |
| [0017](./docs/exec-plans/completed/0017-daemon-alignment-v1-3-0.md) | Align transcode-gateway with current service-registry-daemon and payment-daemon contracts | 2026-05-19 |

## Initial port roadmap (completed)

The historical sequence is recorded in
[`docs/exec-plans/completed/0001-initial-port-roadmap.md`](./docs/exec-plans/completed/0001-initial-port-roadmap.md).

| Phase | Outcome | Component subfolder | Status |
|---|---|---|---|
| 0 | Docs + workspace scaffold | (root) + `docs/` | ✅ shipped |
| 1 | Auth (waitlist + sessions + API keys) ported from Blueclaw shape | `transcode-gateway/src/auth/` | ✅ shipped (plan 0002) |
| 2 | Engine + types + interfaces + dispatch (no live, no VOD route handlers yet) | `transcode-gateway/src/engine/` | ✅ shipped (plan 0003) |
| 3 | Historical wire layer port, later replaced by the v2 LOC boundary | `transcode-gateway/src/livepeer/` | ✅ superseded by plan 0018 |
| 4 | VOD pipeline routes (`/v1/uploads`, `/v1/vod/*`, `/v1/videos/assets`, `/v1/playback/:id`) | `transcode-gateway/src/routes/` | ✅ shipped (plan 0005) |
| 5a | Live HTTP surface (`/v1/live/streams`, `/_hls/*` proxy, session directory) | `transcode-gateway/src/routes/live/` + `src/livepeer/` | ✅ shipped (plan 0006; v2-retrofitted) |
| 5b | Gateway-side RTMP listener with per-stream broker routing (RTMP-parsing lib) | `transcode-gateway/src/runtime/rtmp/` | ✅ shipped (plan 0007) |
| 6 | `transcode-core` Go library port | `transcode-core/` | ✅ shipped (plan 0008) |
| 7 | `transcode-runner` Go binary port | `transcode-runner/` | ✅ shipped (plan 0009) |
| 8 | `abr-runner` Go binary port | `abr-runner/` | ✅ shipped (plan 0010) |
| 9 | `codecs-builder` Docker base port | `codecs-builder/` | ✅ shipped (plan 0011) |
| 10 | `transcode-tester` Node smoke harness port | `transcode-tester/` | ✅ shipped (plan 0012) |
| 11 | `site/` waitlist signup (Vite + Lit) | `site/` | ✅ shipped (plan 0013) |
| 12 | `portal/` user portal (Vite + Lit) | `portal/` | ✅ shipped (plan 0014) |
| 13 | `admin/` admin dashboard (Vite + Lit) | `admin/` | ✅ shipped (plan 0015) |
| 14 | End-to-end smoke (compose stack + fixture VOD + fixture live) | `e2e/` | ✅ shipped (plan 0016) |

## Current delivery frontier

Use `bd ready` for work that can start now and `bd blocked` for work
waiting on local dependencies or the Livepeer Modules / LOC release
gates. The v2 graph deliberately does not preserve the v0 protocol path.

## Versioning

Pre-1.0.0 on a coordinated monorepo release line. Components inside the
monorepo do not have independent versions yet; when a component is
extracted to a standalone repo, its versioning becomes its own concern.

This module's release line is **independent of `livepeer-network-modules`**.
The source repo continues to ship on its own cadence; copies into this
repo are deliberate, commit-recorded decisions, not synced bumps. The
v2 retrofit is coordinated against the
[`2026-08-22 contract baseline`](./docs/references/2026-08-22-livepeer-modules-v2-contract-baseline.md)
recorded by Bead `lmt-65a.1.1`.

## Tracking debt

Beads is the sole tracker for open work and technical debt. The former
Markdown tracker is retained as a
[`historical record`](./docs/exec-plans/tech-debt-tracker.md).
