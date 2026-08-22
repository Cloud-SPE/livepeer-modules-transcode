# AGENTS.md

This is `livepeer-modules-transcode` — the standalone module for the
Livepeer **transcode** product (VOD batch + live RTMP/LL-HLS), extracted
from `livepeer-network-modules` so it can ship and operate on its own
release cadence.

## Operating principles

This repo follows the agent-first harness pattern in
[`docs/references/openai-harness-engineer.md`](./docs/references/openai-harness-engineer.md). Short version:

- **You steer; the agent executes.** Humans set intent; tools and feedback loops do the rest.
- **The repo is the system of record.** If it isn't checked in, it doesn't exist.
- **Progressive disclosure.** This file is a *map*, not a manual.
- **Enforce invariants, not implementations.** Constraints in lints/CI; choices in code.
- **Throughput over ceremony.** Short-lived PRs; fix-forward over block.

Read [`docs/design-docs/core-beliefs.md`](./docs/design-docs/core-beliefs.md) before making
load-bearing decisions.

## Where to look

| Question | File |
|---|---|
| What is this repo and why does it exist? | [`README.md`](./README.md) |
| What invariants must any change uphold? | [`docs/design-docs/core-beliefs.md`](./docs/design-docs/core-beliefs.md) |
| What's the proposed architecture at a glance? | [`docs/design-docs/architecture-overview.md`](./docs/design-docs/architecture-overview.md) |
| What must the module do? | [`docs/design-docs/requirements.md`](./docs/design-docs/requirements.md) |
| How does the VOD pipeline work? | [`docs/design-docs/transcode-pipeline.md`](./docs/design-docs/transcode-pipeline.md) |
| How does the live RTMP / LL-HLS pipeline work? | [`docs/design-docs/live-pipeline.md`](./docs/design-docs/live-pipeline.md) |
| How does auth work (waitlist → API key → session)? | [`docs/design-docs/auth-model.md`](./docs/design-docs/auth-model.md) |
| Which peer services does this module require? | [`docs/design-docs/dependencies.md`](./docs/design-docs/dependencies.md) |
| What frontend DOM / CSS rules apply repo-wide? | [`docs/design-docs/frontend-dom-and-css-invariants.md`](./docs/design-docs/frontend-dom-and-css-invariants.md) |
| What's the index of all design docs? | [`docs/design-docs/index.md`](./docs/design-docs/index.md) |
| What was the porting roadmap from `livepeer-network-modules`? | [`docs/exec-plans/completed/0001-initial-port-roadmap.md`](./docs/exec-plans/completed/0001-initial-port-roadmap.md) |
| What design work has shipped? | [`docs/exec-plans/completed/`](./docs/exec-plans/completed/) |
| What known tech debt are we tracking? | [`docs/exec-plans/tech-debt-tracker.md`](./docs/exec-plans/tech-debt-tracker.md) |
| Reference material (papers, transcripts, external posts) | [`docs/references/`](./docs/references/) |
| What work is ready or blocked? | Beads (`bd`) — run `bd prime`, then `bd ready` / `bd blocked` |

## Repo shape — monorepo with a single root `docs/`

Each component lands as a top-level subfolder with its own `AGENTS.md`,
source, and tests. **All design docs, exec-plans, and references live at
the repo root in `docs/`** — there are no per-component `docs/`
directories. This deviates from the `livepeer-network-modules` pattern
because the narrower scope of this module makes a single doc tree both
sufficient and easier to keep coherent.

Repository components:

- `transcode-gateway/` — TypeScript / Fastify. Customer-facing HTTP +
  RTMP listener. Dispatches transcode jobs to the capability-broker.
  Owns the `media.*` schema.
- `transcode-core/` — Go shared library. FFmpeg + GPU + presets + HLS +
  progress + thumbnails + filters.
- `transcode-runner/` — Go binary. `POST /v1/video/transcode` — VOD
  single-rendition.
- `abr-runner/` — Go binary. `POST /v1/video/transcode/abr` — VOD
  multi-rendition ABR ladder.
- `codecs-builder/` — Dockerfile-only. Multi-stage base image with x264,
  SVT-AV1, libopus, libvpx, libzimg compiled from source. Other runners
  `FROM codecs-builder:<tag>`.
- `transcode-tester/` — Node integration smoke harness.
- `site/` — Lit zero-build waitlist signup site.
- `portal/` — Lit zero-build authenticated user portal (API key + video
  product UIs).
- `admin/` — Lit zero-build admin dashboard (waitlist approval + video
  ops: route-health, resolver candidates, asset / live-stream inspection).

Navigate from this `AGENTS.md` to each component's own `AGENTS.md` for
component-specific guidance.

## Doing work in this repo

### Task tracking (Beads)

Beads is the sole source of truth for open, blocked, deferred, and in-progress
work. Design docs and exec-plans retain rationale and implementation detail;
they do not duplicate the live task list.

- Run `bd prime` at session start and after context compaction.
- Find work with `bd ready`; claim it atomically with `bd update <id> --claim`.
- Create a bead before writing code, with a concrete description and acceptance
  criteria. Search first to avoid duplicates.
- Record discovered work with `discovered-from:<current-id>` and add real
  blocking dependencies with `bd dep add <dependent> <blocker>`.
- Close completed work with a reason. Never use `bd edit` or a Markdown
  checklist as a parallel tracker.
- This checkout currently has no git/Dolt remote. Do not invent one or run a
  remote sync command without explicit authorization.

- **All design docs, exec-plans, and references live in root `docs/`.**
  No per-component `docs/` directories. Component-local guidance lives in
  the component's `AGENTS.md` and `README.md` only.
- **Exec-plans are numbered (`0001-…`, `0002-…`)** and start in
  `docs/exec-plans/active/`. Move to `completed/` when shipped.
- **References (`docs/references/`) are point-in-time provenance.** Do
  not edit after the fact; supersede with a new dated reference if the
  picture changes.
- **Two source repos provide patterns and code; both are read-only.**
  - `livepeer-network-modules` is the source of truth for the video
    pipeline (`video-gateway/` + `video-runners/`). All TS engine and Go
    runner code is ported verbatim from there. Commit messages that
    introduce a copy must cite the source path verbatim, e.g.
    `livepeer-network-modules/video-gateway/src/engine/service/manifestBuilder.ts`.
  - `blue-claw-network/web-platform` is the **shape reference** for the
    auth model (waitlist + admin approval + emailed API key + portal
    login). Patterns are ported into TypeScript; **no code is copied
    verbatim**, since Blueclaw is Rust/Axum and this module's backend is
    TS/Fastify. Cite the Blueclaw file as inspiration in the commit
    message that introduces the equivalent TS code.
  - **Never modify a file in either source repo** from this module's
    working tree.
- **Docker-first.** Every component ships with a `Dockerfile`, a
  `Makefile` wrapping common gestures, and a `compose.yaml` where
  multi-service orchestration is needed.

## Doc-gardening expectations

Stale docs are worse than missing docs. When you change a process or an
invariant, update the doc in the same PR. References (`docs/references/`)
are point-in-time and do **not** get edited after the fact — supersede
with a new dated reference if the picture changes.
