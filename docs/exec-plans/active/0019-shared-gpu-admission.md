---
plan: 0019
title: Shared physical-GPU admission across transcode runners
status: active
phase: implementation
opened: 2026-09-11
owner: livepeer-modules-transcode
tracker: Beads feature lmt-65a.1.20
related:
  - docs/design-docs/core-beliefs.md
  - docs/exec-plans/active/0018-livepeer-modules-v2-migration.md
  - docs/references/2026-09-11-shared-gpu-admission-modules-handoff.md
  - infra/portainer/nvidia-gtx1080/README.md
---

# Plan 0019 — shared physical-GPU admission

## Problem

The eu-central member runs live, ABR, and single-rendition VOD in separate
containers on one NVIDIA GPU. Per-process queue limits cannot see work in the
other containers. Raising all three limits therefore permits batch work to
consume encoder sessions or memory while a latency-sensitive live ladder is
starting or producing.

GPU pressure telemetry explains contention after admission; it does not stop
the conflicting admission.

## Contract

All runners assigned to one physical GPU receive the same clean, absolute lock
file path on a host-shared filesystem. The path key is derived from the
physical device identity, not a container-local ordinal.

VOD and ABR executions join a batch cohort. Live sessions join a live cohort
before admission and hold that membership through termination. Multiple
members of either cohort may coexist up to their runner-local limits, but a
short admission mutex prevents the two cohorts from becoming active together.
An incompatible cohort produces a safe capacity response before FFmpeg starts.
Kernel-owned advisory locks release automatically when a runner process exits,
providing crash reconciliation without a second state service.

The lock is an additional host safety boundary. Existing per-runner queue
limits still bound concurrency among compatible workloads, and Modules still
owns network-wide placement and capacity accounting.

An unset lock path means the runner is not participating in a shared physical-
GPU domain. A configured path must be valid and writable at startup; runners
fail startup rather than silently disabling requested enforcement.

## Delivery

`transcode-core` owns the lock primitive so all three binaries implement one
policy. Runner integration, the Portainer shared-volume wiring, and the
Modules placement handoff are tracked as children of `lmt-65a.1.20`; Beads is
the authoritative live status and dependency graph.

## Acceptance boundary

Repository-local acceptance proves lock semantics, runner lease lifetimes,
compose wiring, safe capacity errors, and crash release. Final acceptance also
requires an immutable Modules revision that maps one member/physical-GPU
capacity domain into every co-located runner and production-shaped eu-central
fault injection in both admission orders.
