# DESIGN

Architectural overview at a glance. The deep version lives in
[`docs/design-docs/`](./docs/design-docs/); the agent-first pattern this
repo follows lives in
[`docs/references/openai-harness-engineer.md`](./docs/references/openai-harness-engineer.md).

## The pin

> **A standalone, deployable Livepeer transcode product** — VOD batch
> jobs and live RTMP / LL-HLS streams — with the smallest viable
> self-service onboarding flow attached.

Every architectural choice in this repo flows from that requirement.

## Shape in one sentence

A TypeScript Fastify gateway that owns customer auth and the `media.*`
schema, dispatches transcode work to an external capability-broker over
HTTP request-response and HTTP streaming modes, terminates RTMP locally
for live ingest, and strict-proxies LL-HLS playback back from the broker
— with Go workload runners performing the actual FFmpeg work behind the
broker.

## Component layers

| # | Layer | What it does | Repo subfolder |
|---|---|---|---|
| 1 | **Customer-facing gateway** | HTTP API + RTMP listener + LL-HLS proxy + Lit frontends (site / portal / admin) | `transcode-gateway/`, `site/`, `portal/`, `admin/` |
| 2 | **Engine** | Cost-free ABR planning, manifest building, playback URL minting, job orchestration, dispatch to broker | `transcode-gateway/src/engine/` |
| 3 | **Wire layer** | Capability mapping, payment header minting, resolver-aware broker selection, route health | `transcode-gateway/src/livepeer/` |
| 4 | **Auth** | Waitlist → email verify → admin approval → emailed API key → session login (Blueclaw-modeled) | `transcode-gateway/src/auth/` |
| 5 | **Workload runners** | FFmpeg-based VOD transcode (single + ABR ladder) sitting behind the broker | `transcode-runner/`, `abr-runner/`, `transcode-core/`, `codecs-builder/` |
| 6 | **Integration smoke** | End-to-end fixture-driven test harness | `transcode-tester/` |

For the deep-dive sketch see
[`docs/design-docs/architecture-overview.md`](./docs/design-docs/architecture-overview.md).

## What stays sacred

- **No payment chokepoint changes.** Livepeer payment minting is delegated
  to an external `payment-daemon` over its existing gRPC-on-UDS interface.
- **No broker forking.** The gateway speaks the existing
  `http-reqresp@v0` / `http-stream@v0` modes; the capability-broker is an
  external peer service.
- **Resolver-only broker discovery.** Service-registry-daemon resolver
  socket is the **only** broker resolution path — no static
  `LIVEPEER_BROKER_URL` fallback.
- **Mainnet only.** Smoke deploys against Arbitrum One. No testnets.
- **Read-only source repos.**
  `livepeer-network-modules` (video pipeline) and `blue-claw-network`
  (auth shape) are referenced but **never** modified from this working
  tree.

## What's explicitly out of v0

The following are deferred to phase 2 (post-v0 ship) or dropped:

- **Pricing / billing.** No cost quoter, no `/v1/vod/quote`, no usage
  ledger, no `media.pricing` or `media.live_session_debits` tables. The
  module is functionally free in v0; billing is a layer added on top.
- **Multi-tenant projects.** No `media.projects` table or `/v1/projects`
  routes. Assets, jobs, and streams are scoped by `api_key_id`. A user
  with one API key is one logical customer.
- **Webhooks.** No webhook endpoint management, no signer, no dispatcher,
  no `webhook_endpoints` / `webhook_failures` tables. Asset and stream
  state are poll-only in v0.
- **Live → VOD recording handoff.** `record_to_vod: true` is not a
  supported live-session parameter in v0. The `recordingHandoff` service
  and `media.recordings` table do not exist.
- **Static broker URL fallback.** Resolver-only.

See [`docs/design-docs/core-beliefs.md`](./docs/design-docs/core-beliefs.md)
for the full invariant set and
[`docs/exec-plans/active/0001-initial-port-roadmap.md`](./docs/exec-plans/active/0001-initial-port-roadmap.md)
for the porting sequence.
