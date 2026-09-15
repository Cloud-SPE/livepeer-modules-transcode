# Shared GPU admission — Modules handoff, 2026-09-11

This point-in-time handoff records the transcode runner contract that Livepeer
Modules must carry into managed member placements. It is not an approved
Modules revision; the upstream issue and immutable implementation SHA remain
open under transcode Bead `lmt-65a.1.20.4`.

## Incident and required invariant

The eu-central member co-locates `live-runner`, `abr-runner`, and
`transcode-runner` containers on one NVIDIA GPU. Each process has its own queue
limit, so increasing all three limits does not coordinate encoder sessions or
memory across containers.

Multiple live sessions may coexist up to the live runner's tested local limit,
and multiple VOD/ABR executions may coexist up to their tested batch limits.
Live and batch cohorts must not overlap on one physical GPU unless a later,
explicitly tested policy replaces this conservative boundary.

## Runner contract supplied by this repository

All three runners accept:

```text
GPU_ADMISSION_LOCK=/var/lib/livepeer-gpu-admission/<physical-gpu-uuid>
```

The value is a clean absolute base path, not a container-local device ordinal.
The runner derives `.mutex`, `.live`, and `.batch` files from it. Live sessions
join the live cohort at create and retain the lease through termination and
restart recovery. VOD and ABR join the batch cohort immediately before a new
execution and retain the lease through cleanup. Same-cohort leases coexist;
cross-cohort admission returns `capacity_reached` before FFmpeg starts.

The files contain no ownership record. Linux kernel locks are authoritative
and release on process exit. All co-located containers must therefore see the
same inode namespace; merely supplying identical container-local paths is not
sufficient. A configured path that is missing, unsafe, or unwritable fails
runner startup.

## Current Modules gap

At the inspected 2026-09-11 Modules checkout:

- `pool-controller/internal/desiredstate/desiredstate.go::renderCompose`
  injects the NVIDIA GPU UUID into Docker device reservations but does not
  inject a capacity-domain environment value or shared mount;
- `pool-controller/internal/templates/template.go::RunnerCompose` models
  image, command, environment, models, internal URL, and RTMP port, but no
  shared state/mount contract;
- `pool-member-agent/internal/desiredstate/apply.go::RenderCompose` assembles
  only supplied service fragments under `services:` and has no shared
  top-level volume/init resource; and
- no matching GPU capacity-domain issue exists in the upstream Beads tracker.

The existing placement key already carries `HardwareUnit.GPUUUID`. Modules
should derive the admission key from that authoritative value rather than
asking templates or operators to duplicate it.

## Requested Modules changes

Extend desired-state rendering and member application so every transcode
runner assigned to the same member and physical GPU receives:

- the identical `GPU_ADMISSION_LOCK` base path derived from `GPUUUID`;
- one shared, writable mount that resolves the three derived files to the same
  host inodes;
- initialization that is safe for the runners' non-root users and idempotent
  across compose recreation; and
- isolation from services assigned to any other GPU UUID on the member.

The generated compose revision must change when this contract changes.
Draining, restart, and `--remove-orphans` behavior must not strand a lease;
kernel process exit should be the reconciliation mechanism. Existing local
runner queue limits remain in force and must not be inferred from the cohort
lock.

Treat runner `429 capacity_reached` as an observable capacity refusal. It must
not count as successful execution or make the host look like available
cross-cohort capacity while the opposing cohort is active.

## Verification requested from Modules

Conformance should prove, on one rendered GPU placement:

- two live sessions can hold the live cohort concurrently up to the configured
  live limit;
- VOD and ABR can hold the batch cohort concurrently up to their configured
  limits;
- live is rejected while either batch runner is active;
- both batch runners are rejected while live is active;
- a killed/restarted runner releases its leases and can reconcile active work;
- two different GPU UUIDs never block each other; and
- desired-state output, attached-runner health, rejection metrics, and operator
  status identify the physical capacity domain without exposing host paths to
  customers.

Return the upstream Bead ID, immutable Modules SHA, generated-compose fixture,
and real eu-central fault evidence to close `lmt-65a.1.20.4` and its parent.
