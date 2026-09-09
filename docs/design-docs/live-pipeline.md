# Live pipeline (RTMP + LL-HLS)

This document defines the implemented Modules v2 live pipeline. Live is
session work, not a long job: the gateway uses `paid-session/v1` and the
capability-owned `rtmp-hls/v1` descriptor. There is no legacy open/close path.

## Customer surface

```
POST   /v1/live/streams
GET    /v1/live/streams/:id
POST   /v1/live/streams/:id/end
GET    /_hls/*
GET    /v1/playback/:id
RTMP   <gateway-public-ingest>/live/<public-stream-key>
```

The gateway relay is the product ingress. The descriptor remains the standard
runner-owned-ingest shape; no new gateway-owned-ingest descriptor is needed.

## Credential topology

Two keys serve different trust domains:

| Credential | Consumer | Visibility |
|---|---|---|
| Public customer stream key | Customer encoder -> gateway | Returned once to customer; hash stored for lookup |
| Private runner ingest key | Gateway relay -> runner | Obtained by `stream-key-issue`; encrypted at rest; never returned or logged |

The paid-session open uses external attachment and `session_params` for the
runner-owned ingest configuration. Protocol infrastructure passes those
parameters verbatim and never interprets, logs, or relays them.

The versioned parameter schema is `rtmp-hls-session/v1`. It selects
`gateway-relay` or explicitly opted-in `direct-publisher`, names the output
profile and one metering rendition, and carries either runner-local storage
or short-lived S3/MinIO STS coordinates. The callback token and storage
credentials are create-only secrets. The ingest key is not a session
parameter: it is issued and rotated through the descriptor grant.

## Session flow

1. The gateway authenticates the customer, creates a public key, and persists
   a pending live-stream record.
2. It resolves a route advertising `paid-session/v1`, `rtmp-hls/v1`, external
   attachment, the expected work unit, quote metadata, and compatible
   settlement keys.
3. It persists the selected route, stable request ID/content hash, initial
   finite funding policy, and lifecycle state before asking LOC to open.
4. LOC opens the paid session. The gateway records the LOC operation/session
   and broker session IDs, then uses the session's `stream-key-issue` grant to
   obtain a separate runner ingest key.
5. The gateway stores the runner URL/key and other session parameters in an
   envelope encrypted with a key held outside the database. It returns only
   the gateway RTMP URL/public key and gateway LL-HLS playback URL.
6. When the customer publishes, the gateway terminates RTMP and relays with
   stream copy to the private runner ingress. The broker/runner produces
   LL-HLS; the gateway strict-proxies playback bytes.
7. LOC performs only finite, policy-bounded refills. Each accepted refill
   extends the lease. Explicit customer end, disconnect policy, exhaustion,
   lease expiry, or broker termination drives close and reconciliation.
8. At terminal state, the gateway records final signed usage/outcome and
   deletes the encrypted session secrets.

## Usage and balance

The billable work unit is `output_seconds`, reported and signed by the runner.
It is the cumulative whole seconds of finalized segments on the named
metering rendition, floored after summing segment durations. It is measured
once for the playable program timeline, not multiplied by the ABR ladder.
Gateway wall-clock duration, RTMP byte counts, and HLS observations are useful
cross-checks and anomaly signals only; they never replace the protocol claim.

Runner events use durable positive monotonic sequences and stable unique IDs.
Claims never decrease, retries reuse the same event identity, and terminal
events carry the final cumulative claim. An accepted usage event refreshes
liveness; the runner emits a separate heartbeat when no other event occurs
inside its declared cadence.

Heartbeat liveness and media health are separate signals. The runner reports
`output_state` (`waiting`, `producing`, or `stalled`) on status and heartbeats,
records bounded safe ladder failure codes, and fails a session with
`output_failed` when authenticated ingest does not yield finalized metering
segments before the output deadline. A synthesized HLS master lists only
renditions with playable media and returns `503 output_unavailable` while none
exist.

The release boundary is `paid-session/v1` schema `1.2.0` with `rtmp-hls/v1`
schema `1.1.0`, pinned to Modules revision
`d2f36cb984a0880cf82b768cb0f1e2900f491293`. Gateway reconciliation persists
the broker's safe output-health projection from both HTTP status and advisory
control events; an older broker is represented explicitly as `unknown`.

Runner callback delivery is a durable ordered outbox with per-head attempt and
next-retry state. Transport failures, 408, 429, and 5xx responses retry the
identical event with bounded exponential backoff and stable jitter. Other
non-2xx responses are permanently rejected: the runner atomically advances the
outbox and retains a bounded, credential-free dead letter so one incompatible
event cannot hide later usage or terminal state. Rejection diagnostics remain
runner-local and are not recursively emitted through the rejected callback
contract.

Runner-owned Prometheus counters separate ladder start failures, classified
process exits, output stalls, callback rejections, and GPU telemetry outcomes.
Their label domains are closed safe sets. NVIDIA starts take a timeout-bounded
encoder-session and used-memory snapshot; telemetry failure is observable but
never blocks session execution and raw command output is never logged.

The normative balance object includes `will_refuse_next_refill`. A broker must
advertise refusal before rejecting the next refill and must not accept funding
it will not honor with lease extension. The gateway/LOC policy has explicit
limits for total funded units, refill count/size, session duration, and
failure behavior—no unbounded auto-refill.

## Control and reconciliation

The optional control WebSocket carries low-latency usage, balance, and ended
frames so the gateway can stop relays quickly. It is advisory acceleration:
authenticated HTTP state remains authoritative, and startup/background
reconciliation repairs missed or reordered frames and process crashes.

Every lifecycle mutation is idempotent. An ambiguous open or refill is
recovered using the same request identity/LOC operation, never a replacement
session. Durable state includes the selected quote, funded/refilled totals,
lease expiry, runner/broker IDs, last control sequence, last HTTP reconcile,
and terminal reason.

## Playback

`GET /_hls/<session>/<rest>` strict-proxies the runner/broker origin without
playlist rewriting or gateway caching. A CDN may front this route. Public
status and admin responses expose only redacted state and correlation IDs.

## Known external issue

`INVALID_RECIPIENT_RAND` rotation remains a payer/clearinghouse seam issue;
v2 session semantics do not make a mid-broadcast `rotation_unrecoverable`
safe. Production release is gated on the coordinated LOC/clearinghouse
resolution tracked in Beads.

See [plan 0018](../exec-plans/active/0018-livepeer-modules-v2-migration.md)
and [requirements](./requirements.md). Executable cross-repository fixtures
and strict local types live in
[`live-runner/testdata/contracts/v1/`](../../live-runner/testdata/contracts/v1/)
and [`live-runner/contract.go`](../../live-runner/contract.go).
