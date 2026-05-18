---
plan: 0012
title: transcode-tester — Node integration smoke harness for transcode-runner + abr-runner
status: completed
phase: shipped
opened: 2026-05-18
closed: 2026-05-18
owner: harness
related:
  - "docs/exec-plans/completed/0009-transcode-runner-port.md"
  - "docs/exec-plans/completed/0010-abr-runner-port.md"
---

# Plan 0012 — transcode-tester port

## 1. Problem

The runner binaries (plans 0009 + 0010) compile + lint clean but
have no integration smoke yet. Source ships `transcode-tester/` —
two Node scripts (`test-transcode.mjs`, `test-abr.mjs`) that submit a
job, poll for status, and validate the output.

## 2. Source

`livepeer-network-modules/video-runners/transcode-tester/`:
- `test-transcode.mjs` (300 LOC) — single-rendition smoke
- `test-abr.mjs` (188 LOC) — ABR ladder smoke
- `renditions.json` (24 LOC) — test rendition configs
- `Dockerfile` (10 LOC) — node:22-alpine + scripts
- `package.json` — `type: module`, no runtime deps

## 3. Execution

Verbatim port. Files copy as-is; no source-path imports to rewrite
(scripts only fetch the runner URL via `OPENAI_BASE_URL` env).
Add scaffold: AGENTS.md, README.md, Makefile for docker build/run.

Notes:
- The env var is misleadingly named `OPENAI_BASE_URL` (because the
  scripts were factored out of an OpenAI-shaped harness). Source
  hasn't renamed it; we follow suit. Tester scripts expect it to
  point at the runner's `/v1/video/transcode*` endpoints.
- No new runtime deps.
- Add to root `pnpm-workspace.yaml`.

## 4. Acceptance

1. `pnpm install` resolves with `transcode-tester/` in the workspace.
2. `cd transcode-tester && node test-transcode.mjs presets` connects
   to a configured runner URL — visual smoke only; no automated
   acceptance against a live runner here.
3. Scaffold present (AGENTS.md + README.md + Makefile).
4. PLANS.md roadmap row 10 → ✅.
5. Plan moves to `completed/`.

## 5. Out of scope

- Pointing at a live runner — operator concern.
- Renaming `OPENAI_BASE_URL` env — source names it that way; rename
  is a separate cleanup.

## 6. Decision log

| Date | Decision | Why |
|---|---|---|
| 2026-05-18 | Verbatim port | Scripts have no repo-internal imports; nothing to rewrite |
| 2026-05-18 | Keep `OPENAI_BASE_URL` env name | Matches source; rename is gratuitous churn |
