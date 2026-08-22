# Livepeer Modules v2 contract baseline — 2026-08-22

This is point-in-time provenance for the breaking `paid-job/v1` and
`paid-session/v1` retrofit tracked by Beads epic `lmt-65a`. It records the
exact upstream state reviewed by `livepeer-modules-transcode`; it is not a
floating pointer to either upstream branch. Supersede this file with a new
dated reference rather than editing it after adoption.

## Repository pins

| Repository | Branch | Reviewed source HEAD | Relation to origin | Working tree |
|---|---|---|---|---|
| `livepeer-network-modules` | `tasks/lpm-v2` | `15af4813d3b0271401b316495b17da5b18e209cd` | `0` behind, `0` ahead of `origin/tasks/lpm-v2` | clean at initial capture; see in-flight note below |
| `livepeer-modules-open-clearinghouse` (LOC) | `tasks/lpm-v2` | `8e4ea2c6fd5a7b2688b1f99796744ed311031af3` | `0` behind, `0` ahead of `origin/tasks/lpm-v2` | clean |

Both source repositories were reviewed and tested read-only. No files or
Beads records in either repository were changed by this review.

After the pinned Modules tests passed, its working tree gained an in-progress
`lnm-y08` patch in `capability-broker/internal/server/middleware/payment.go`,
`payment_test.go`, and `recorder.go`. The upstream Bead moved to
`in_progress`. Those uncommitted files are deliberately excluded from this
baseline: they have no immutable SHA, were still changing during review, and
were not the code exercised by the recorded test run.

The Modules repository HEAD is a release-record commit. The coherent Modules
`v2.0.0` binaries were built from
`e92ce32bdc699adc35f6b5dc8c5ce8b417a343be`.

The published image digests recorded at the reviewed Modules HEAD are:

| Image under `tztcloud/` | Digest |
|---|---|
| `livepeer-capability-broker` | `sha256:3642e4827c42b977cf5f0b2445a54040c5a0a005c2e86852bbd2a0207b003de9` |
| `livepeer-payment-daemon` | `sha256:3d1db2e43c2258de103182cec9b198a3b8d8f48fc59d3c199b6b20d60fc99d39` |
| `livepeer-protocol-daemon` | `sha256:6a07238dab3ae12465ccd25aa0594d733b6c66e21866fcddb3c2e3c282a2e705` |
| `livepeer-service-registry-daemon` | `sha256:c091d0f1a09b43f427e7fb805c2c5342d3be68800cc14e7e1420c0dc73d5dff8` |
| `livepeer-orch-coordinator` | `sha256:a9205adbe27681e506205d3af6d1d0c4635aca49358f854f2418fb0cfd71474c` |
| `livepeer-secure-orch-console` | `sha256:1ff3e0adf86018bc4303eadeecfa20beb515e0eac1f4e88afe91509c14193b50` |
| `livepeer-conformance` | `sha256:65455060875a1dee9d1e3cd7f5b453e1af363bfd9e4d5a2e058e06f149f4fca3` |

The mutable `v2.0.0` tag is not a deployment pin. Deployment work must use
the digests above or a deliberately reviewed superseding set.

## Contract surfaces adopted

The transcode migration follows these files at the Modules source pin:

- `livepeer-network-protocol/protocols/paid-job.md`
- `livepeer-network-protocol/protocols/paid-session.md`
- `livepeer-network-protocol/protocols/offering-axes.md`
- `livepeer-network-protocol/headers/livepeer-headers.md`
- `livepeer-network-protocol/manifest/schema.json`
- `livepeer-network-protocol/proto/livepeer/payments/v1/types.proto`
- `livepeer-network-protocol/proto/livepeer/payments/v1/payer_daemon.proto`
- `proto-contracts/livepeer/registry/v1/{types,resolver,publisher}.proto`

The resulting product contract is intentionally breaking:

- VOD uses one `paid-job/v1` exchange for the complete ABR ladder, selected
  through declared route protocol/transport axes. The old mode headers,
  `/v1/cap`, compensating settlement, and per-rendition job model do not remain.
- Live uses `paid-session/v1`, including a capability-owned gateway-ingest
  descriptor, `session_params` secrets, durable top-up/lease state, settlement
  lookup by `gateway_session_id`, and explicit restart recovery. It does not
  remain on the paid-job path.
- LOC is the payment and settlement-verification boundary. This repository
  integrates the LOC TypeScript SDK rather than retaining direct payer-daemon
  payment minting in the final design.

The LOC consumer surface is its `openapi.json` plus
`sdks/typescript/src/{client,session_runner,errors,telemetry}.ts` at the LOC
pin. The LOC service and all four SDK manifests declare `2.0.0`, but version
metadata is not evidence that the still-open live release gates have passed.

## Verification evidence

The following commands passed against the pinned clean working trees on
2026-08-22:

| Repository/component | Command | Result |
|---|---|---|
| Modules `capability-broker/` | `go test ./...` | passed |
| Modules `service-registry-daemon/` | `go test ./...` | passed |
| Modules `orch-coordinator/` | `go test ./...` | passed |
| LOC repository root | `make test-release` | lint, formatting, layering and mypy passed; 397 backend tests passed; 3 shared Python conformance cases passed; Python SDK 46 tests passed; TypeScript SDK 43 tests passed and built; Go vet/tests/examples passed; Rust SDK/workspace tests and checks passed |

The LOC pilot evidence recorded in `loc-m7s.10.2.5.1` includes nine closed
real `paid-job/v1` exchanges, signed request-ID settlement recovery, and exact
balance reconciliation. Its paid-session exercise still uses a synthetic
session without runner metering, so it is not evidence for transcode-live
readiness.

## Known release conditions at this baseline

Passing tests and published images do not close the following conditions:

| Condition | Upstream evidence | Local gate |
|---|---|---|
| Unary `Livepeer-Work-Units` can be committed before final debit succeeds | Modules `lnm-y08` is `in_progress`; an uncommitted deferral/recorder patch was observed but is not adopted | `lmt-65a.1.6` |
| Broker backend HTTP client has a fixed five-minute timeout, unsuitable for long ABR work without a different supported exchange shape | `capability-broker/internal/backend/http.go` | `lmt-65a.1.6` |
| Concurrent identical paid-session opens can perform payment and runner side effects before `request_id` is reserved | reviewed `sessionengine.Engine.Open` at the Modules pin; no upstream Bead existed | `lmt-65a.1.5` |
| Session winddown records terminal state after runner termination or payment close failure, while the sweep skips terminal records | reviewed `sessionengine.winddownLocked` and `Sweep`; no upstream Bead existed | `lmt-65a.1.5` |
| LOC live job/session/idempotency/rotation matrix remains open | `loc-m7s.10.2.2` | `lmt-65a.1.4` |
| LOC official SDK publication is not yet gated on immutable v2 conformance evidence | `loc-m7s.10.3` | `lmt-65a.1.4` |
| Shared LOC pilot has not demonstrated a real metered transcode session | `loc-m7s.10.2.5` and `.1` | `lmt-65a.1.4` |
| Canonical multipart estimator adoption remains open in LOC even though Modules propagation bug `lnm-35a` is closed | `loc-m7s.10.8`; Modules fix `f42e5c675c0671a6a6e57c1f6feeb4d22d57544d` | `lmt-65a.1.4` |

`lnm-35a` is no longer a Modules implementation blocker: estimator schema,
coordinator, registry, proto, and `SelectedRoute` propagation are included in
the coherent artifact source. Transcode still has to consume and verify that
surface in its own resolver work.

## Advancing this baseline

Do not silently follow either `tasks/lpm-v2` branch. A proposed upstream
advance requires a new dated reference that records both new immutable SHAs,
the diff from these pins, changed protocol/proto/SDK surfaces, upstream Bead
state, clean working-tree evidence, and rerun results proportional to the
change. Update the relevant `lmt-65a` dependencies only after reviewing that
new reference. Never amend this file to make an old review appear current.
