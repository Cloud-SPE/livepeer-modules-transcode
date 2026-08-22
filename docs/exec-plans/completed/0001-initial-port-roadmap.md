---
plan: 0001
title: Initial port roadmap — sequencing component ports from livepeer-network-modules + Blueclaw shape
status: completed
phase: all component ports shipped
opened: 2026-05-18
closed: 2026-08-22
owner: harness
related:
  - "docs/design-docs/core-beliefs.md (invariants every port must uphold)"
  - "docs/design-docs/architecture-overview.md (component map)"
  - "docs/design-docs/transcode-pipeline.md (VOD design)"
  - "docs/design-docs/live-pipeline.md (live design)"
  - "docs/design-docs/auth-model.md (Blueclaw-shaped auth)"
  - "docs/design-docs/dependencies.md (peer-service inventory)"
---

# Plan 0001 — initial port roadmap

> Completed 2026-08-22. The scaffold and every component port listed by
> this roadmap shipped in plans 0002–0017. Ongoing work is tracked in
> Beads; the breaking Livepeer Modules v2 migration is epic `lmt-65a`.

## 1. Problem

`livepeer-modules-transcode` is a brand-new repo. It needs to land the
transcode product (VOD + live) plus a Blueclaw-shaped auth surface
without dragging in the workspace deps and product surfaces that the
source repo (`livepeer-network-modules`) tangles together. The repo
must be useful to agents from day one — meaning the docs, invariants,
and porting sequence are all in place before the first line of TS / Go
arrives.

This plan does **two** things:

1. Lands the **docs-only scaffold** (this PR / change-set).
2. Enumerates **each downstream port** as its own queued exec-plan, so
   the next agent can pick a queued plan, open a numbered file under
   `active/`, and execute against a settled set of invariants.

## 2. Required invariants

Every downstream port must uphold the invariants in
[`docs/design-docs/core-beliefs.md`](../../design-docs/core-beliefs.md).
The load-bearing ones for this roadmap:

- **§2 Resolver-only broker discovery.** No static `LIVEPEER_BROKER_URL`
  fallback anywhere.
- **§4 Read-only source repos.** Never modify
  `livepeer-network-modules` or `blue-claw-network/web-platform`. Each
  port commit cites the source path verbatim.
- **§5–§9 Scope cuts.** No pricing, no projects, no webhooks, no
  recording handoff, auth is Blueclaw-shaped.
- **§10 Docker-first.** Every component has `Dockerfile` + `Makefile`
  + (if multi-service) `compose.yaml`.
- **§14 Single root docs.** No per-component `docs/` directories.

## 3. Execution

### 3.1 This change-set: docs-only scaffold (in flight → close on merge)

Deliverables (already landed in this scaffold):

- Root markdown: `AGENTS.md`, `CLAUDE.md`, `README.md`, `DESIGN.md`,
  `PRODUCT_SENSE.md`, `PLANS.md`
- Workspace root: `package.json`, `pnpm-workspace.yaml`,
  `.tool-versions`, `.nvmrc`, `.npmrc`, `.gitignore`
- `docs/design-docs/`: `index.md`, `core-beliefs.md`, `requirements.md`,
  `architecture-overview.md`, `transcode-pipeline.md`,
  `live-pipeline.md`, `auth-model.md`, `dependencies.md`,
  `frontend-dom-and-css-invariants.md`
- `docs/exec-plans/`: this plan in `active/0001-…`, empty
  `completed/`, `tech-debt-tracker.md`
- `docs/references/openai-harness-engineer.md` (already present at scaffold time)
- `docs/product-specs/` and `docs/generated/` placeholders

No code lands in this change-set. Each downstream component port lands
under its own numbered exec-plan below.

### 3.2 Queued downstream plans

Each row becomes its own `active/NNNN-…md` exec-plan when picked up.
Sequencing is **suggested**, not strict — the auth port and the engine
port are independent and can run in parallel; the runners can land in
any order once `transcode-core` is in.

| Next plan # | Title | Source path(s) | Notes |
|---|---|---|---|
| 0002 | Auth + waitlist + sessions + API keys (Blueclaw-shape port) | `blue-claw-network/web-platform/{backend/migrations,backend/src/routes,backend/src/models,backend/src/crypto.rs,backend/src/email.rs}` | TS / Fastify rewrite; do NOT copy Rust source. Land `auth.*` migrations first. |
| 0003 | Engine — types, interfaces, dispatch, config, repo | `livepeer-network-modules/video-gateway/src/engine/` | Verbatim port minus `costQuoter.ts`, `webhookSigner.ts`, and `liveStreamRepo.ts` references that pull projects. Replace `project_id` with `api_key_id` at the type / repo boundary. |
| 0004 | Wire layer — capability map, headers, payment, resolver routing | `livepeer-network-modules/video-gateway/src/livepeer/` | Verbatim port minus `rtmp-adapter.ts` (that lands in 0006). Inline `gateway-route-health` helpers into `src/livepeer/`. |
| 0005 | VOD routes + tus + media migrations | `livepeer-network-modules/video-gateway/src/routes/{uploads,vod,playback}.ts` + `migrations/0000_video_init.sql` (subset) | Drop `/v1/projects` and `/v1/webhooks*`. Replace `project_id` columns with `api_key_id`. Land migrations in `transcode-gateway/migrations/`. |
| 0006 | Live RTMP listener + `/v1/live/streams` + `/_hls/*` proxy | `livepeer-network-modules/video-gateway/src/runtime/rtmp/` + live routes + `media.live_streams` + `media.playback_ids` | Drop `record_to_vod` parameter, recording handoff, `media.recordings`. |
| 0007 | `transcode-core` Go shared library | `livepeer-network-modules/video-runners/transcode-core/` | Verbatim port. Adjust import path to `github.com/Cloud-SPE/livepeer-modules-transcode/transcode-core`. Audit `live.go` for residual helpers; delete unreferenced symbols. |
| 0008 | `transcode-runner` Go binary | `livepeer-network-modules/video-runners/transcode-runner/` | Verbatim port. `FROM codecs-builder:<tag>`. |
| 0009 | `abr-runner` Go binary | `livepeer-network-modules/video-runners/abr-runner/` | Verbatim port. `FROM codecs-builder:<tag>`. |
| 0010 | `codecs-builder` multi-stage Docker base | `livepeer-network-modules/video-runners/codecs-builder/` | Verbatim port. Default tag `v0.1.0` (reset from source's `v1.2.0` since this is a new repo). |
| 0011 | `transcode-tester` Node integration smoke | `livepeer-network-modules/video-runners/transcode-tester/` | Verbatim port. Adjust fixture paths. |
| 0012 | `site/` waitlist signup (Lit zero-build) | `blue-claw-network/web-platform/site/` | Port layout + components + CSS; do NOT copy verbatim (Blueclaw is product-branded). Use `lmt-` prefix. |
| 0013 | `portal/` user portal (Lit zero-build) extended with video UIs | `blue-claw-network/web-platform/portal/` + new video components | Blueclaw's portal layout + new components for asset library, live streams, upload widget. Drop playground + usage. |
| 0014 | `admin/` admin dashboard (Lit zero-build) extended with video ops | `blue-claw-network/web-platform/admin/` + new ops components | Blueclaw's admin layout + new components for resolver candidates, route-health, asset/live-stream inspection. Drop customer / topup management. |
| 0015 | End-to-end smoke (compose + fixture VOD + fixture live) | (new) | Compose stack with postgres + gateway + a mock broker / mock resolver / mock payment-daemon. Validates the full request flow without depending on a real Livepeer network. |

Each downstream plan must:

- Open as `active/NNNN-<slug>.md` with the frontmatter shape used by
  this plan.
- Cite the source path(s) verbatim in its problem statement and in
  every commit message that introduces a port.
- Update `PLANS.md`'s roadmap row to ✅ on landing.
- Move itself to `completed/` on merge.

## 4. Acceptance for this scaffold plan

This scaffold plan is **complete** when:

1. ✅ All root markdown files exist and cross-link correctly.
2. ✅ All design-docs in
   [`docs/design-docs/index.md`](../../design-docs/index.md) exist (or
   are explicitly flagged as stubs in the index).
3. ✅ Workspace root files (`package.json`, `pnpm-workspace.yaml`,
   `.tool-versions`, `.nvmrc`, `.npmrc`, `.gitignore`) exist.
4. ✅ `docs/exec-plans/active/`, `completed/`, `tech-debt-tracker.md`,
   `docs/product-specs/`, `docs/generated/`, `docs/references/` all
   exist.
5. ✅ This plan moved to `completed/` after every downstream component
   port shipped.
6. ✅ The first downstream plan (0002 — auth port) opened and shipped.

## 5. Out of scope for this scaffold plan

- No TS / Go / SQL files. No `transcode-gateway/`, runners, frontends,
  or migrations. Those are downstream plans 0002–0015.
- No CI workflows. The first CI workflow lands when the auth port
  (plan 0002) introduces the first lintable / testable code.
- No `Dockerfile` / `Makefile` / `compose.yaml`. Those land per
  component, under their respective port plans.

## 6. Decision log

| Date | Decision | Why |
|---|---|---|
| 2026-05-18 | Single root `docs/` (no per-component `docs/`) | Narrower scope than `livepeer-network-modules`; one tree is sufficient and easier to keep coherent (see [core-beliefs §14](../../design-docs/core-beliefs.md)) |
| 2026-05-18 | Resolver-only broker discovery (no static URL fallback) | Force on-chain manifest path on every boot; avoid dev/prod divergence (see [core-beliefs §2](../../design-docs/core-beliefs.md)) |
| 2026-05-18 | Auth modeled on Blueclaw, not customer-portal | Smallest viable onboarding; avoids dragging the whole `customer-portal` workspace dep in (see [core-beliefs §9](../../design-docs/core-beliefs.md)) |
| 2026-05-18 | Drop pricing, projects, webhooks, recording handoff from v0 | Each is non-essential to "transcode a video"; each defers cleanly to phase 2 (see [core-beliefs §5–§8](../../design-docs/core-beliefs.md)) |
| 2026-05-18 | Inline `gateway-route-health` rather than carry as workspace dep | Only two helpers consumed; one workspace package per tiny module isn't worth it (see [dependencies.md](../../design-docs/dependencies.md)) |
| 2026-05-18 | Rename `video-gateway` → `transcode-gateway` | Cohesive with the project name; commits cite source path regardless |
