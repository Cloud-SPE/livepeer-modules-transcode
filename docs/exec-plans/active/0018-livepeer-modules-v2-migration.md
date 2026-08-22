---
plan: 0018
title: Breaking migration to Livepeer Modules v2
status: active
phase: implementation
opened: 2026-08-22
owner: livepeer-modules-transcode
tracker: Beads epic lmt-65a
related:
  - docs/references/2026-08-22-livepeer-modules-v2-contract-baseline.md
  - docs/design-docs/architecture-overview.md
  - docs/design-docs/transcode-pipeline.md
  - docs/design-docs/live-pipeline.md
---

# Plan 0018 — breaking Livepeer Modules v2 migration

## Problem

The shipped gateway was built around the legacy broker mode taxonomy and
direct payer-daemon calls. Those choices require mode guessing/retries,
ambiguous open compensation, usage scraping, and volatile live-session state.
Modules v2 replaces that seam with idempotent `paid-job/v1` and
`paid-session/v1`; LOC becomes the gateway's payment and settlement boundary.

This is a retrofit, not a compatibility project. The final release deletes
the old wire path. During implementation, references to v0 in source describe
work still to remove and do not define an alternate supported deployment.

## Locked product contracts

### VOD

One customer ABR submission maps to one `paid-job/v1` SSE exchange. The
request and terminal descriptors are `video-transcode-abr/v2` and
`video-transcode-abr-result/v2`. The runner emits progress/keepalive events
and one terminal result containing all rendition outputs.

The work unit is `video-frame-megapixel`, calculated as
`ceil(sum(actual_frames_i * width_i * height_i) / 1_000_000)` across delivered
video renditions, with audio-only output contributing zero. The gateway funds
a conservative ceiling; the signed terminal result determines settlement.

### Live

One customer stream maps to one finite `paid-session/v1` session using the
standard `rtmp-hls/v1` external-attachment descriptor. The runner owns ingest.
The gateway issues a public customer key, obtains a different private runner
key via the `stream-key-issue` grant, and relays RTMP to the runner.

Live bills signed runner-reported `output_seconds`. Refills are finite and
policy-bounded and extend the lease. The optional control WebSocket accelerates
usage/balance/end signals; HTTP is authoritative. Session parameters and
private credentials are envelope-encrypted and deleted after termination.

## Delivery slices

Beads is the live dependency graph and status source; the identifiers below
are navigation, not a second task list.

| Beads scope | Architectural outcome |
|---|---|
| `lmt-65a.1` | Contract decisions, pinned external baselines, and Modules/LOC release evidence |
| `lmt-65a.2` | Shared route validation, LOC adapter, paid protocol clients, durable correlation, and error model |
| `lmt-65a.3` | Single-exchange ABR schema, runner execution, metering, recovery, and VOD integration |
| `lmt-65a.4` | Live session runner/descriptor, private-key relay, bounded funding, recovery, and integration |
| `lmt-65a.5` | Cross-repo release matrix, deletion of v0, security/quality gates, deployment, and rollback drill |

Implementation should move from shared persistence and the LOC boundary into
the job/session clients, then into product-specific orchestration. Unit and
contract tests precede destructive removal of the v0 path. The old path is
deleted only after both new products pass integrated tests, but it is never
offered as runtime fallback.

## External release gates

The migration cannot ship on repository-local evidence alone:

- Modules must publish production-ready paid-job behavior, including a
  terminal response usage extractor that implements the agreed ABR formula
  and timeout behavior suitable for long encodes (`lmt-65a.1.6`).
- Modules must publish paid-session production evidence for external
  attachment, grants, concurrency, lease/refill, control events, and winddown
  (`lmt-65a.1.5`).
- LOC must publish a stable TypeScript SDK and a live pilot demonstrating job
  and session lifecycle, durable idempotency/recovery, and actionable protocol
  errors (`lmt-65a.1.4`).
- LOC/clearinghouse must resolve recipient-rand rotation sufficiently that a
  recoverable rotation cannot become an unrecoverable live outage.

The immutable baseline records what was reviewed; later upstream facts must
be captured in a new dated reference rather than rewriting history.

## Release invariants

A release candidate must prove that incompatible routes are rejected before
funding, identical job opens converge without duplicate execution/debit,
unknown job/session outcomes recover after restart, work-unit drift is
rejected, session secrets never escape their boundary, and bounded live
funding cannot refill indefinitely.

The joint matrix pins mutually compatible gateway, registry, broker, runner,
and LOC revisions and exercises unary refusal, streaming VOD, live open/
attach/refill/end, timeout and reconnect, restart recovery, malformed claims,
and recipient rotation on production-shaped infrastructure.

## Cutover and rollback

Cutover is coordinated across route manifests, Modules broker/runners, LOC,
and this gateway. The release removes legacy mode headers/adapters, `/v1/cap`
calls, direct payer-daemon code, compensating settles, and stale configuration.
No component is upgraded alone.

Rollback restores the complete previous compatibility set and its database-
compatible application version. It never routes v2 durable operations into a
v0 gateway or asks a v2 gateway to resume v0 work. Before rollout, the team
must demonstrate backup/restore and a whole-release rollback drill.

## Completion

Plan 0018 completes only when epic `lmt-65a` and its required external gates
are closed, the repository contains no production v0 payment/mode path, the
joint release matrix passes, operator docs describe the deployed v2 system,
and the coordinated cutover plus rollback drill have succeeded.
