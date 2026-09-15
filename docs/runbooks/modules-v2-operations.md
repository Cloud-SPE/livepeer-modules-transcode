# Modules v2 operations

This runbook covers the transcode gateway's breaking `paid-job/v1` and
`paid-session/v1` release. The gateway must be deployed with compatible,
immutable Modules and LOC revisions; mixed old/new versions are unsupported.
The live output-health boundary requires Modules revision
`d2f36cb984a0880cf82b768cb0f1e2900f491293`, `paid-session/v1` schema `1.2.0`,
and `rtmp-hls/v1` schema `1.1.0`. Deploy the broker before the updated runner
and gateway; an older broker yields `output_state: unknown` and provides no
output-health enforcement.

## Required boundary

- Configure resolver-only discovery with `LIVEPEER_RESOLVER_SOCKET`.
- Use the current Modules catalog offering IDs: `abr-default` for customer
  VOD/ABR and `gateway-ingest` for live, unless the deployment deliberately
  overrides those catalog entries.
- Configure LOC with `LIVEPEER_LOC_URL`, `LIVEPEER_LOC_API_KEY`, and a
  secret-manager-backed `LIVEPEER_CALLER_PRIVATE_KEY` (64 lowercase hex
  characters). Keep the delegated caller key stable across restart; drain all
  paid work before rotating it.
- Provide a canonical base64 32-byte `LIVEPEER_OPERATION_SECRETS_KEK` and an
  operator-visible `LIVEPEER_OPERATION_SECRETS_KEY_ID` outside Postgres.
- Configure S3 for VOD. Live additionally requires
  `LIVEPEER_GATEWAY_EXTERNAL_RTMP_URL` and `RTMP_RELAY_ENABLED=true`.
- Remove all legacy payer/funding variables. Startup rejects them explicitly.

Never log or copy LOC credentials, the caller private key, authorizations,
caller proofs, payment envelopes, grants, session credentials, or the private
runner ingest URL/key. Database backups contain encrypted session material;
the wrapping key must be backed up separately.

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

For live sessions, treat `output_state` independently from heartbeat liveness.
The gateway's derived `output_status` adds `no_ingest` when a gateway-relay
session is waiting and its publisher relay is absent; direct-publisher sessions
are not inferred from gateway relay state.
`waiting` is expected only during bounded encoder startup, `producing` means the
metering rendition has finalized media, and `stalled` means ingest is present
without playable output. Investigate the runner's safe `last_failure_code`; a
session that reaches the output failure deadline terminates as
`failed`/`output_failed` and must not continue holding runway. During `waiting`
or `stalled`, an HLS master request may correctly return
`503 output_unavailable` with `Retry-After`.

Inspect `callback_rejected_total` and `last_callback_rejection` when the broker
view missed an event. A permanent 4xx is parked and later callbacks continue;
the loopback runner metric `live_callback_rejected_total{status}` identifies
the response class. Retryable transport/408/429/5xx failures retain their event
identity and back off, so use the durable callback attempt timestamps rather
than manually replaying or replacing the session.

Scrape the runner's loopback metrics surface when diagnosing live failures.
Correlate `live_ladder_starts_total{code}` and
`live_ladder_exits_total{code}` with `live_sessions_stalled_total`. On NVIDIA
hosts, the ladder-start log includes bounded `encoder_sessions` and
`memory_used_mib`; compare those values with co-located ABR/VOD activity.
`live_gpu_telemetry_probes_total{result="unavailable"}` means the pressure
snapshot failed, not that the customer session itself failed.

On a member where live, ABR, and VOD share one physical GPU, all three runners
must report `gpu_admission_configured` and use one `GPU_ADMISSION_LOCK` base
derived from the physical GPU UUID. Live and batch work form separate cohorts:
same-cohort concurrency is governed by each runner's local limit, while a
cross-cohort request returns `capacity_reached` before FFmpeg. Rising
`gpu_admission_rejections` or `live_gpu_admission_rejected_total` is expected
during a conflicting cohort; a missing admission configuration on a co-located
host is a deployment defect. Do not infer that increasing three independent
queue limits increases safe physical-GPU capacity.

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
   On co-located GPU hosts, also verify that rendered runner services share one
   GPU-UUID-keyed admission mount, then test same-cohort concurrency and
   cross-cohort refusal in both start orders.
4. Stop admission, drain or settle existing operations, then deploy LOC,
   Modules, runners, and gateway in the coordinated release order recorded by
   the release bead.
5. Re-enable admission only after resolver manifests expose the required v2
   protocol axes and health checks pass.

Rollback restores the complete prior release set and its database backup.
Never attach a v2 gateway to old in-flight work or combine a v2 broker/LOC
with an old gateway. Preserve logs and database evidence for unresolved
operations before rollback.
