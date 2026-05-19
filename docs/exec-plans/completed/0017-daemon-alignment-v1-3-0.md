---
plan: 0017
title: Align transcode-gateway with current service-registry-daemon and payment-daemon contracts
status: completed
phase: shipped
opened: 2026-05-19
closed: 2026-05-19
owner: harness
related:
  - "docs/design-docs/dependencies.md (resolver + payer-daemon boundaries)"
  - "docs/design-docs/core-beliefs.md §2 (resolver-only)"
  - "transcode-gateway/proto/livepeer/registry/v1/resolver.proto"
  - "livepeer-network-modules/proto-contracts/livepeer/registry/v1/resolver.proto"
  - "livepeer-network-modules/livepeer-network-protocol/proto/livepeer/payments/v1/payer_daemon.proto"
  - "livepeer-network-modules/livepeer-network-protocol/proto/livepeer/payments/v1/types.proto"
---

# Plan 0017 — daemon alignment

## 1. Problem

`transcode-gateway` was ported from an earlier `video-gateway` snapshot.
Since then, the upstream daemon contracts moved in two important ways:

- `service-registry-daemon` added the resolver-side `SelectMany`
  surface and now returns route-level quote metadata
  (`quote_id`, `quote_version`, `constraint_fingerprint`,
  `route_fingerprint`, `units_per_price`) in the `SelectedRoute`
  payload.
- `payment-daemon` sender mode now expects `PayerDaemon.CreatePayment`
  over gRPC-on-UDS with `recipient`, `ticket_params_base_url`,
  `accepted_price`, and `funding`, and returns raw `payment_bytes`
  rather than the older ad hoc gateway JSON envelope.

This repo currently still assumes the older shapes in
`transcode-gateway/src/livepeer/routeSelector.ts`,
`transcode-gateway/src/livepeer/resolverWorkerResolver.ts`, and
`transcode-gateway/src/livepeer/payerDaemonClient.ts`.

The alignment work needs to happen in staged PRs so the repo never sits
half-migrated with both runtime behavior and tests broken at once.

## 2. Required invariants

- **Resolver-only stays true.** No static broker URL fallback is
  reintroduced while adopting newer resolver RPCs.
- **Source repos stay read-only.** Contract files are copied or modeled
  from `livepeer-network-modules`; this repo does not edit upstream.
- **Proto-first for daemon boundaries.** Gateway assumptions about
  resolver and payer-daemon behavior must follow the current protobuf
  contracts rather than stale ported TS wrappers.
- **Small, reviewable slices.** Separate contract vendoring/type
  alignment from runtime behavior changes.

## 3. Execution

### 3.1 PR 1 — contract refresh only

Refresh vendored proto contracts and local type surfaces without
changing the gateway's behavior yet.

- Update `transcode-gateway/proto/livepeer/registry/v1/resolver.proto`
  to the current upstream contract.
- Vendor current payment-daemon protos into
  `transcode-gateway/proto/livepeer/payments/v1/`.
- Extend local route/header/type definitions so newer resolver route
  metadata has a place to live once the runtime starts using it.
- Document the new vendored proto locations in `transcode-gateway/`.

Acceptance:

- Vendored proto files match current upstream contracts.
- TypeScript still builds after the type-surface expansion.
- No runtime behavior change yet; resolver path still uses the old
  selection strategy and payer client still uses the pre-migration
  implementation until PR 2 / PR 3.

### 3.2 PR 2 — resolver migration

Move route selection from `ListKnown + ResolveByAddress + local filter`
to the current resolver selection surface.

- Dial the current `Resolver` proto with `SelectMany`.
- Thread `work_unit`, quote metadata, and `units_per_price` through
  `VideoRouteCandidate` and `SelectedWorkerRoute`.
- Preserve route-health ranking and suppression behavior on top of
  resolver-returned candidate lists.

Acceptance:

- Gateway route selection uses the resolver's current contract.
- Resolver-returned quote metadata is available to the payment builder.
- Existing route-health tests still pass, with new coverage for the
  updated candidate shape.

### 3.3 PR 3 — payer-daemon migration

Replace the legacy payer wrapper with a real gRPC-on-UDS client for the
current `PayerDaemon` contract.

- Vendor/load `livepeer/payments/v1/{types,payer_daemon}.proto`.
- Build `accepted_price` from resolver-selected route metadata.
- Build `funding` from gateway-side request budget assumptions.
- Pass `ticket_params_base_url` from the selected broker origin.
- Base64-encode returned `payment_bytes` for `Livepeer-Payment`.

Acceptance:

- The gateway can mint payments against the current sender daemon.
- The broker accepts the payment envelope against its newer
  expected-price validation path.
- Integration coverage exists against real or realistic daemon peers.

## 4. Out of scope

- Full budget/top-up policy design for long-lived live sessions.
- Broader gateway-adapter refactors beyond what `transcode-gateway`
  needs for current transcode modes.
- Capability-broker or daemon source changes in the upstream repo.

## 5. Decision log

| Date | Decision | Why |
|---|---|---|
| 2026-05-19 | Split alignment into three PR-shaped slices | Contract refresh, resolver migration, and payer migration are separable and easier to verify independently |
| 2026-05-19 | Treat upstream protos as the source of truth for daemon edges | The existing TS wrappers are older than the current daemon contracts |
| 2026-05-19 | Add a daemon-backed `e2e` variant with contract-level mocks instead of waiting for full upstream compose parity | It proves the gateway's real resolver/payer/broker wire path now, while keeping the stack owned by this repo |
