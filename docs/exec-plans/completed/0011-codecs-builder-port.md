---
plan: 0011
title: codecs-builder — Dockerfile-only base image (x264 + SVT-AV1 + libopus + libvpx + libzimg)
status: completed
phase: shipped
opened: 2026-05-18
closed: 2026-05-18
owner: harness
related:
  - "docs/exec-plans/completed/0009-transcode-runner-port.md (Dockerfile FROMs codecs-builder)"
  - "docs/exec-plans/completed/0010-abr-runner-port.md (same)"
---

# Plan 0011 — codecs-builder port

## 1. Problem

The transcode runners (plans 0009 + 0010) both `FROM
${REGISTRY}/codecs-builder:${TAG}` in their Dockerfiles. The
codecs-builder image is a single Ubuntu-based stage that compiles
x264, SVT-AV1, libopus, libvpx, and libzimg from source and exposes
the libs at `/usr/local/{lib,include}` for the downstream FFmpeg
builds.

## 2. Source

`livepeer-network-modules/video-runners/codecs-builder/Dockerfile`
(72 lines). No Go, no source code — only the Dockerfile + the libs it
builds.

## 3. Execution

- `mkdir -p codecs-builder/`
- Copy `Dockerfile` verbatim (no edits — it has no repo-specific
  imports)
- Add `Makefile` (`build`, `push`, `help` targets) matching the runner
  pattern
- Add `AGENTS.md` (~20 lines) + `README.md`
- Image namespace: `tztcloud/codecs-builder` (matches source). Default
  tag `v0.1.0` for this repo (source uses `v1.2.0` — both runners'
  Dockerfiles default `TAG=v1.2.0`; operators override at build time
  per [core-beliefs §11](../../design-docs/core-beliefs.md))

## 4. Acceptance

1. `cd codecs-builder && make help` lists targets.
2. `Dockerfile` is a verbatim copy.
3. `AGENTS.md`, `README.md`, `Makefile` present.
4. Actual `docker build` is **not** required for plan acceptance —
   the image takes 20+ minutes to build (compiles ffmpeg deps from
   source) and the GitHub Actions / CI pipeline that builds + pushes
   is itself a phase-2 concern. Acceptance is "Dockerfile parses + ports
   verbatim."
5. `PLANS.md` roadmap row for phase 9 flips to ✅.
6. This plan moves to `docs/exec-plans/completed/`.

## 5. Out of scope

- Building + pushing the image — phase 2 (CI/CD plan).
- Per-codec version bumps — match source pins exactly (x264 stable,
  SVT-AV1 v2.3.0, opus v1.5.2, libvpx v1.15.2, zimg 3.0.6).
- Adding new codecs — out of scope.

## 6. Decision log

| Date | Decision | Why |
|---|---|---|
| 2026-05-18 | Verbatim Dockerfile port; no edits | Image has no repo-specific imports |
| 2026-05-18 | Acceptance does NOT require running `docker build` | 20+ min build for ffmpeg deps. Validation deferred to phase-2 CI |
| 2026-05-18 | Default `TAG=v0.1.0` in Makefile; runners default `TAG=v1.2.0` (matches source) | We don't republish source's image; we ship our own at our version. Operators override at build time |
