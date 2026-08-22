# DESIGN

The target architecture at a glance. Details live in
[`docs/design-docs/`](./docs/design-docs/) and the active breaking migration
is [plan 0018](./docs/exec-plans/active/0018-livepeer-modules-v2-migration.md).

## The pin

> A standalone, deployable Livepeer transcode product: VOD batch jobs and
> live RTMP/LL-HLS streams, with the smallest viable onboarding flow.

## Target shape

The Fastify gateway owns customer auth, `media.*` product state, uploads,
RTMP relay, and playback. It discovers brokers exclusively through
`service-registry-daemon` and delegates all network funding and settlement to
LOC. Brokers dispatch FFmpeg work to the Go runners.

- A VOD asset is one streaming `paid-job/v1` ABR exchange, not paid
  per-rendition sub-jobs.
- A live stream is one finite `paid-session/v1` session using the standard
  runner-owned-ingest `rtmp-hls/v1` descriptor.
- Durable request/session identity is persisted before side effects so
  retries and restart recovery converge.
- The customer RTMP key and private runner ingest key are different
  credentials; private session state is envelope-encrypted.

## Component layers

| Layer | What it owns | Repo/location |
|---|---|---|
| Customer gateway | HTTP API, RTMP relay, LL-HLS proxy, auth and media state | `transcode-gateway/` |
| Product engine | ABR planning, manifests, playback, lifecycle orchestration | `transcode-gateway/src/engine/` |
| Protocol seam | v2 route validation and LOC adapter | `transcode-gateway/src/livepeer/` |
| Workloads | FFmpeg ABR/single rendition and shared codec code | Go runner folders |
| External network | Resolver, LOC, capability broker | separately deployed repos |

## Load-bearing boundaries

- **Breaking cutover.** No v0 dual stack or fallback. `/v1/cap`, legacy mode
  headers/adapters, and direct payer-daemon code are deleted before release.
- **LOC-only payment seam.** LOC owns payment headers, funding, claims,
  settlement, and recovery. Product pricing remains a separate concern.
- **Resolver-only discovery.** No static broker URL.
- **Whole-release compatibility.** Gateway, route manifests, broker/runners,
  and LOC are versioned and deployed as a tested compatibility set.
- **Mainnet-only, read-only source repos, Docker-first.** See
  [core beliefs](./docs/design-docs/core-beliefs.md).

## Migration state

The initial v0 port has shipped, and its implementation remains in this
branch while plan 0018 is active. The documents under `docs/design-docs/`
define the replacement architecture; they do not claim the source migration
is complete. Beads epic `lmt-65a` is the authoritative status graph.

Customer pricing/Stripe, projects, webhooks, and live-to-VOD recording remain
out of scope. LOC network settlement does not introduce those product
features.
