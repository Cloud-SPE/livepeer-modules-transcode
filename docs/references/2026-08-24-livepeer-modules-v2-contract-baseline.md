# Livepeer Modules v2 contract baseline — 2026-08-24

This point-in-time reference supersedes the
[2026-08-22 baseline](./2026-08-22-livepeer-modules-v2-contract-baseline.md)
for implementation under Beads epic `lmt-65a`. It does not amend the earlier
review or turn either upstream branch into a floating dependency.

## Approved revisions

| Repository | Approved source | Reviewed branch state | Working tree |
|---|---|---|---|
| `livepeer-network-modules` | `1241d76e5061bd1a3366045e0b5da28b5e317ff1` | `tasks/lpm-v2`, equal to origin | clean |
| `livepeer-modules-open-clearinghouse` | `f739a2876b6e7791935309e16cea02dfe49ac8bd` (`v2.0.0`) | followed only by `ab5cef72`, which closes LOC tracking | clean |

Modules `1241d76` records that the v2.0.0 artifact set was built from
`215e8a4`. Deployment still requires immutable image digests; neither a branch
name nor a mutable image tag is a deployment pin.

## LOC contract adopted by transcode

LOC is authoritative for funding and settlement. A transcode gateway selects
and validates a registry route first, then supplies a mandatory
`route_binding` on every network-paid job or session open:

- `quote_id`;
- canonical decimal-string `quote_version`;
- `constraint_fingerprint`;
- `route_fingerprint`.

LOC resolves that exact candidate through `SelectMany` before minting and
returns the persisted `route_snapshot` used for the open. The snapshot is
versioned as `route-snapshot/v1` and includes broker and recipient identity,
capability/offering/protocol axes, complete signed offering extra metadata,
work unit and estimator declaration, price and denominator, quote identity,
fingerprints, and the complete delegated settlement-key set.

Registry `uint64` values are canonical decimal strings across discovery,
bindings, snapshots, OpenAPI, and generated SDKs. JavaScript consumers must
not convert them to `number`. Identical idempotent opens return the recorded
response and snapshot without reselection; changed open input returns
`request_id_reuse`; a stale binding returns `route_binding_mismatch` before
payment side effects.

The transcode gateway owns durable request, refill, close, and recovery
identities in Postgres. It uses a narrow LOC HTTP adapter rather than relying
on SDK runner memory, and it does not expose LOC types across the engine seam.

## Verification evidence

At LOC `f739a287`/tracking commit `ab5cef72`, `make test-release` passed:

- 416 backend tests and all lint, formatting, layering, and mypy gates;
- 3 shared Python conformance cases;
- 47 Python SDK tests;
- 43 TypeScript SDK tests plus build;
- Go vet/tests/examples;
- Rust tests and workspace checks.

The LOC real-process result reports success against clean Modules `1241d76`
for paid jobs, sessions, idempotent opens/refills, request-ID recovery,
settlement verification, restart, debit failure, and recipient rotation. The
route-hardening commit adds symmetric job and session stale-binding tests that
assert refusal before minting.

## Remaining release gates

This baseline permits gateway implementation; it does not declare the joint
release production-ready.

- Modules still creates payment and runner side effects before reserving a
  paid-session request ID, so concurrent identical opens can duplicate work.
- Modules session winddown can record terminal state after runner termination
  or payment close fails, while the sweep skips terminal records.
- The broker HTTP backend still has a fixed five-minute timeout, unsuitable
  for long ABR exchanges.
- Modules does not yet provide the agreed aggregate multi-rendition
  frame-megapixel extractor/config and shared fixtures.
- LOC `loc-m7s.10.2.5` (shared live pilot) and `loc-m7s.10.3` (official SDK
  release gate) remain open.

These are tracked by `lmt-65a.1.4`, `lmt-65a.1.5`, and `lmt-65a.1.6`. Advance
this baseline only with another dated reference and proportional source/test
review.
