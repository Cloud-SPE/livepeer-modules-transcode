# Core beliefs

Invariants any change in this repo must uphold. These exist because past
decisions (or strong stakeholder preference) made them load-bearing. To
change one, open a numbered plan under `../exec-plans/active/` first.

## 1. This module ships the **transcode** product end-to-end

The pin: *a customer can sign up, get an API key, and either submit a
VOD job or push an RTMP live stream — without standing up the broader
`livepeer-network-modules` suite.* Every architectural choice in this
repo serves that pin. Surfaces that don't are out of scope for v0.

## 2. Resolver-only broker discovery

The gateway resolves brokers **only** through the
`service-registry-daemon` resolver socket. There is no static
`LIVEPEER_BROKER_URL` fallback. Single-broker dev setups run a one-orch
resolver, not a hard-coded URL env.

**Why:** This module is built for production-shaped operation from day
one. Static-URL fallbacks accumulate divergence between dev and prod
behavior, and they invite operators to deploy without on-chain identity.
We want the on-chain manifest + signed-broker selection path validated
on every boot.

## 3. Mainnet-only — no Livepeer testnets

Inherited from `livepeer-network-modules`. Deploy and smoke against
Arbitrum One from day one. Mitigate risk with dust amounts, not
testnets. Testnets diverge from mainnet in ways that mask real failures.

## 4. Read-only source repos

Two source repos provide patterns and code; **never modify a file in
either** from this working tree.

- `livepeer-network-modules` — source of truth for the video pipeline
  (`video-gateway/` + `video-runners/`). All TS engine and Go runner
  code is ported verbatim from there. Commit messages that introduce a
  copy cite the source path verbatim.
- `blue-claw-network/web-platform` — shape reference for auth UX
  (waitlist + admin approval + emailed API key + portal login). Borrow
  the route layout, DB-table shape, and frontend UX; do **not** copy
  the Rust/Axum code — this module's backend is TypeScript / Fastify.

## 5. No pricing or billing in v0

No cost quoter, no `/v1/vod/quote` route, no usage ledger, no
`media.pricing` or `media.live_session_debits` tables, no Stripe, no
prepaid wallet. The module is functionally free at the module's layer in
v0. Commercial wrappers are a separate, post-v0 layer.

**Why:** Pricing is what made the source `video-gateway` depend on the
`customer-portal` shell. Deferring it lets us ship a useful transcode
endpoint without dragging in identity, ledger, Stripe, and rate-card
machinery.

## 6. No multi-tenant projects in v0

No `media.projects` table, no `/v1/projects` routes. Assets, encoding
jobs, and live streams scope by `api_key_id` (the column replaces
`project_id` from the source schema). One API key = one customer
surface.

## 7. No webhooks in v0

No customer-facing webhook endpoint management, no HMAC signer, no
delivery worker, no retry/replay infrastructure, no `webhook_endpoints`
or `webhook_failures` tables. Asset and stream state are poll-only in
v0.

## 8. No live → VOD recording handoff in v0

`record_to_vod: true` is not a supported live-session parameter. The
`service/recordingHandoff.ts` module and `media.recordings` table are
not ported. Live sessions are ephemeral.

## 9. Auth is Blueclaw-shaped, not customer-portal-shaped

The waitlist + admin approval + emailed API key + portal login flow is
modeled directly on Blue Claw Network's UX. The `customer-portal`
workspace dep from `livepeer-network-modules` is **never** imported by
this module.

## 10. Docker-first build and run

Every component in this monorepo ships with a Docker-first build and run
story: a `Dockerfile`, a `Makefile` wrapping common gestures (`build`,
`test`, `shell`, `smoke`), and a `compose.yaml` where multi-service
orchestration is needed. Implementers and operators do not install
language runtimes (Go, Node, Python, ffmpeg) on their hosts to use a
component.

## 11. Image tags are not bumped silently

Inherited. Republishing an image overwrites the existing named tag.
Version bumps require explicit approval.

## 12. Documentation is enforced, not aspirational

Stale docs are worse than missing docs. Update docs in the same PR that
changes the behavior they describe. References (`../references/`) are
point-in-time provenance and do **not** get edited after the fact —
supersede with a new dated reference if the picture changes.

## 13. Throughput-friendly merge gates

Short-lived PRs. Minimal blocking checks. Test flakes get follow-up
runs, not indefinite blocks. Corrections are cheap; waiting is
expensive.

## 14. Single root `docs/` — no per-component doc directories

This module is narrow enough that one doc tree is sufficient. Component
subfolders carry only an `AGENTS.md` + `README.md`. Promoting a
component-local concern to a design doc is the right move; the wrong
move is creating `<component>/docs/`.

## 15. Dependencies stay current

Any external dependency — Go module, npm package, Docker base image,
GitHub Action, system package — defaults to its **latest stable
release**. Pinning to an older version is a deliberate decision recorded
in the commit message that creates the pin and added to
[`../exec-plans/tech-debt-tracker.md`](../exec-plans/tech-debt-tracker.md)
until resolved.

## 16. Every code copy is commit-recorded

Code that lands in this repo and originated elsewhere
(`livepeer-network-modules`, the Blueclaw shape reference) is **copied
in on a deliberate exec-plan**, with the source path or shape reference
named in the commit message that introduces it. There is no auto-sync.
