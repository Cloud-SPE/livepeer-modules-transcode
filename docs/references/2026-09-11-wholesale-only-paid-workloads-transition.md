# Wholesale-only paid workloads transition — 2026-09-11

This point-in-time reference records a coordinated contract change that began
after the approved 2026-08-24 Modules v2 baseline. It does **not** approve a
new release baseline: Modules and LOC implementation and conformance are still
in progress, so immutable source revisions remain intentionally unpinned.

## Upstream decision

Modules `lnm-4zb` and LOC `loc-0m4` replace the negotiated dual
ticket/wholesale workload path with one authorization-only accounting path:

- every `paid-job/v1` invocation requires a payer-signed, route- and
  workload-scoped `SpendAuthorization` in `Livepeer-Authorization`;
- every `paid-session/v1` open and cap revision requires the corresponding
  scoped authorization;
- `Livepeer-Payment` never authorizes work by itself; it may only fund the
  stable payer-payee account at the account funding endpoint or accompany a
  valid authorization as a bounded shortfall top-up;
- the `extra.features.wholesale_accounts` negotiation flag is removed because
  the protocol itself implies authorization-backed accounting; and
- active legacy engagements are drained before upgrade. Implementations do not
  fabricate authorization state for pre-cutover work.

Closed historical records remain readable audit evidence. Their legacy labels
do not confer new spending authority.

## State observed on 2026-09-11

Modules has completed the normative specification in `lnm-4zb.1`. Paid-job
and paid-session implementation (`lnm-4zb.2` and `lnm-4zb.3`) is in progress;
authorization-only certification and hard-cut operations (`lnm-4zb.4` and
`lnm-4zb.5`) remain open.

LOC has begun removing legacy issuance in `loc-0m4.2`. Its four official SDKs
still need the wholesale-only contract migration (`loc-0m4.3`), and the
cutover/conformance gate (`loc-0m4.4`) remains open.

## Transcode consequences

The existing product boundary remains: LOC owns account funding,
authorization issuance, caller proof, recovery, and settlement. The transcode
gateway owns durable customer/job/session identities and supplies the selected
route, quote, conservative ceiling, and stable operation IDs to LOC. It does
not mint network payment or authorization headers itself.

For VOD and ABR, one durable gateway request maps to one scoped authorization
and one `paid-job/v1` exchange. For live, the durable session open and every
cap increase map to the authorization chain defined by `paid-session/v1`.
Neither path may retry by falling back to a payment-only request.

The coordinated release must update LOC, its SDKs, broker configuration and
conformance before transcode relies on the new path. A mixed deployment would
either admit work without the required authority or reject all paid work, so
cutover and rollback remain whole-release operations.

## Conditions for an approved successor baseline

A later dated reference may supersede the 2026-08-24 approved baseline only
after it records immutable Modules and LOC revisions proving:

- payment-only job, session, and refill requests fail before execution;
- job/session authorization scope, replay, concurrency, restart, settlement,
  and optional shortfall funding conformance;
- all four LOC SDKs send authorization and caller proof without a legacy
  workload-payment fallback;
- preflight refuses cutover while active legacy engagements remain; and
- production-shaped VOD, ABR, and live acceptance through LOC uses the
  authorization-only path.
