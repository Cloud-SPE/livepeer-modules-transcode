---
plan: 0010
title: abr-runner — Go multi-rendition (ABR ladder) VOD binary
status: completed
phase: shipped
opened: 2026-05-18
closed: 2026-05-18
owner: harness
related:
  - "docs/exec-plans/completed/0008-transcode-core-port.md (depends on)"
  - "docs/exec-plans/completed/0009-transcode-runner-port.md (sibling)"
  - "docs/exec-plans/active/0011-codecs-builder-port.md (Dockerfile FROMs codecs-builder)"
---

# Plan 0010 — abr-runner port

## 1. Problem

Sibling of `transcode-runner` (plan 0009) — same wire shape but ABR
ladder per request (one input → multiple renditions in one job).
Exposes `POST /v1/video/transcode/abr`.

## 2. Source

`livepeer-network-modules/video-runners/abr-runner/`: `main.go` (862
LOC), `presets.yaml`, `Dockerfile`, `go.mod` / `go.sum`. Same
structure as `transcode-runner`.

## 3. Execution

Verbatim port with the same import-path / module-path rewrites as
plan 0009. Scaffold (`Makefile`, `AGENTS.md`, `README.md`) follows
the `transcode-runner` template.

## 4. Acceptance

Same as plan 0009: lint + vet + build clean. Docker build deferred
to plan 0011 (codecs-builder).

## 5. Out of scope

Identical to plan 0009.

## 6. Decision log

| Date | Decision | Why |
|---|---|---|
| 2026-05-18 | Verbatim port; mirror plan 0009 scaffold | Sibling binaries; consistency cheaper than divergence |
