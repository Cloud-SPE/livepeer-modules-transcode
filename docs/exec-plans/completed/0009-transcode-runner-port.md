---
plan: 0009
title: transcode-runner — Go single-rendition VOD binary
status: completed
phase: shipped
opened: 2026-05-18
closed: 2026-05-18
owner: harness
related:
  - "docs/exec-plans/completed/0008-transcode-core-port.md (depends on)"
  - "docs/exec-plans/active/0011-codecs-builder-port.md (Dockerfile FROMs codecs-builder)"
  - "docs/exec-plans/completed/0001-initial-port-roadmap.md §3.2"
---

# Plan 0009 — transcode-runner port

## 1. Problem

Plan 0008 landed `transcode-core/`. The first consumer is
`transcode-runner/` — a Go HTTP server that accepts
`POST /v1/video/transcode` requests, runs FFmpeg per the
single-rendition preset, and reports progress.

## 2. Source

`livepeer-network-modules/video-runners/transcode-runner/`:

- `main.go` (829 LOC) — HTTP server + job orchestration
- `presets.yaml` — single-rendition preset table
- `Dockerfile` — multi-stage: codecs-builder → ffmpeg (NVIDIA / Intel
  / AMD variants) → go-builder → runtime
- `go.mod` / `go.sum` — depends on `transcode-core` via `replace`

## 3. Execution

Verbatim port with one rewrite:

- `go.mod` module path: `livepeer-network-modules/video-runners/transcode-runner`
  → `livepeer-modules-transcode/transcode-runner`
- `go.mod` require path for transcode-core: `livepeer-network-modules/video-runners/transcode-core`
  → `livepeer-modules-transcode/transcode-core`
- `replace` directive: `../transcode-core` (unchanged — same relative path in our repo)
- `main.go` import of transcode-core: `Cloud-SPE/livepeer-network-modules/video-runners/transcode-core`
  → `Cloud-SPE/livepeer-modules-transcode/transcode-core`
- `Dockerfile` defaults stay as-is (`REGISTRY=tztcloud`, `TAG=v1.2.0`);
  operator overrides via `--build-arg TAG=...`. The `COPY transcode-core/`
  + `COPY transcode-runner/` paths are relative to the repo-root build
  context — already matches our layout.

Add:
- `Makefile` (build / smoke / shell / help) matching the
  `transcode-core/` pattern
- Component `AGENTS.md` (~30 lines) + `README.md`

`go 1.25` per `.tool-versions` (source uses 1.22; bump matches plan
0008).

## 4. Acceptance

1. `cd transcode-runner && go vet ./...` clean.
2. `cd transcode-runner && go build .` succeeds — produces a binary
   that imports `transcode-core` via the `replace` directive.
3. `go test ./...` — main.go has no unit tests in source; runner-level
   testing happens via `transcode-tester` (plan 0012). This plan
   accepts an empty test suite.
4. `Dockerfile`, `presets.yaml`, `Makefile`, `AGENTS.md`, `README.md`
   present.
5. No reference to `Cloud-SPE/livepeer-network-modules/` left in the
   ported files.
6. Docker build NOT required for plan acceptance (requires
   codecs-builder image which lands plan 0011); validate via Go build
   only.
7. `PLANS.md` roadmap row for phase 7 flips to ✅.
8. Plan moves to `docs/exec-plans/completed/`.

## 5. Out of scope

- Docker image build verification — requires `codecs-builder` image
  (plan 0011); we validate Go build only here.
- Integration smoke — `transcode-tester` (plan 0012).
- The `live-transcode-runner` source variant — already dropped per
  plan 0001 §3.2.

## 6. Decision log

| Date | Decision | Why |
|---|---|---|
| 2026-05-18 | Verbatim port + single sed rewrite for import path | Source is self-contained. Risk: low |
| 2026-05-18 | Keep Dockerfile defaults as `tztcloud/codecs-builder:v1.2.0` | Matches source. Per [core-beliefs §11](../../design-docs/core-beliefs.md), image tags aren't bumped silently — we keep source's tag as the baseline |
| 2026-05-18 | Acceptance is Go-build-clean (not Docker-build) | codecs-builder image not available until plan 0011. Docker smoke deferred to plan 0011 acceptance |
