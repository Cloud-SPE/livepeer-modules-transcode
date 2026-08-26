# Modules v2 operations

This runbook covers the transcode gateway's breaking `paid-job/v1` and
`paid-session/v1` release. The gateway must be deployed with compatible,
immutable Modules and LOC revisions; mixed old/new versions are unsupported.

## Required boundary

- Configure resolver-only discovery with `LIVEPEER_RESOLVER_SOCKET`.
- Configure LOC with both `LIVEPEER_LOC_URL` and `LIVEPEER_LOC_API_KEY`.
- Provide a canonical base64 32-byte `LIVEPEER_OPERATION_SECRETS_KEK` and an
  operator-visible `LIVEPEER_OPERATION_SECRETS_KEY_ID` outside Postgres.
- Configure S3 for VOD. Live additionally requires
  `LIVEPEER_GATEWAY_EXTERNAL_RTMP_URL` and `RTMP_RELAY_ENABLED=true`.
- Remove all legacy payer/funding variables. Startup rejects them explicitly.

Never log or copy LOC credentials, payment envelopes, grants, session
credentials, or the private runner ingest URL/key. Database backups contain
encrypted session material; the wrapping key must be backed up separately.

## Observe

Customer asset and live detail responses contain a safe `paid_operation`
projection. Operators use `GET /api/v1/admin/operations` or the admin
Operations view. Watch protocol state, request/operation IDs, funded/claimed
units, balance and lease warnings, retry count, next retry, winddown reason,
and terminal time. Correlate with structured gateway events by identifiers;
do not request raw secret rows.

Important nonterminal states include `in_flight`, `accounting_pending`,
`reconcile_pending`, `winddown_requested`, and `winddown_retry`. A recovered
operation has a nonzero retry count. `encumbered` or `debit_failed` is not a
successful product result and must remain visibly unavailable.

## Recover VOD jobs

The recovery scanner claims expired leases and replays the encrypted canonical
request using the original request ID. Do not submit another asset/job to work
around a timeout. `job_in_flight` and `accounting_pending` remain retryable;
`request_id_reuse`, identity drift, expired admitted evidence, and debit
failure require investigation and must not publish output. Restarting the
gateway is safe provided Postgres and the wrapping key are intact.

## Recover live sessions

On startup the gateway replays incomplete open/key issuance with their exact
identities and repairs active playback/HLS routing from durable encrypted
state. HTTP reconciliation is authoritative; control-WebSocket frames only
accelerate it. Never create a replacement session for an ambiguous open or
refill.

When `will_refuse_next_refill` appears, stop expecting more funded runway and
allow bounded winddown. Recipient rotation uses one durable rebind linked to
the preceding refill; repeated or unrecoverable rotation requests winddown.
Customer end, disconnect grace expiry, relay failure, lease exhaustion, and
broker end all remain nonterminal until broker settlement is accepted by LOC.
`winddown_retry` means upstream termination or accounting is unresolved—keep
the reconciler running and do not mark the stream successfully ended by hand.

## Deploy and roll back

1. Pin the approved Modules, LOC, gateway, ABR runner, and live runner SHAs.
2. Back up Postgres and verify access to the operation-secrets wrapping key.
3. Run repository gates and the joint real-process VOD/live matrix.
4. Stop admission, drain or settle existing operations, then deploy LOC,
   Modules, runners, and gateway in the coordinated release order recorded by
   the release bead.
5. Re-enable admission only after resolver manifests expose the required v2
   protocol axes and health checks pass.

Rollback restores the complete prior release set and its database backup.
Never attach a v2 gateway to old in-flight work or combine a v2 broker/LOC
with an old gateway. Preserve logs and database evidence for unresolved
operations before rollback.
