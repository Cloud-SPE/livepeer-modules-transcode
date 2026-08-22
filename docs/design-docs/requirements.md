# Requirements

The required end state for the Modules v2 release. Requirements marked as
v2 replace their legacy counterparts; backward compatibility is explicitly
not a requirement. Until plan 0018 completes, the repository is a migration
worktree and is not release-compatible with the v2 stack.

## Product surface

### F1. Customer onboarding and access

The module provides waitlist signup, email verification, operator approval,
API-key issuance/rotation, portal sessions, and an admin surface. Product API
resources remain scoped by `api_key_id`.

### F2. VOD upload and inspection

An authenticated customer can create and complete a presigned object-store
upload, submit it for transcode, poll asset state, list/inspect assets,
resolve playback, and soft-delete an asset.

### F3. One paid ABR exchange per asset

The gateway plans the whole ladder and submits it as one terminal SSE
`paid-job/v1` exchange using `video-transcode-abr/v2`. It does not open one
paid job per rendition and does not use a 202/poll runner contract. Progress
events may precede exactly one terminal `video-transcode-abr-result/v2`
result containing the ladder outputs.

### F4. Deterministic VOD metering

VOD bills `video-frame-megapixel` as:

```
ceil(sum(actual_frames_i * width_i * height_i) / 1_000_000)
```

The sum covers every delivered video rendition; audio-only output contributes
zero. The single ceiling is applied after summation. The gateway funds a
conservative upper bound, while the signed terminal claim is authoritative.

### F5. Paid live session with gateway relay

An authenticated customer can allocate a stream, receive a gateway RTMP URL
and LL-HLS playback URL, push using a public key, inspect status, and end the
stream. The gateway opens one `paid-session/v1` `rtmp-hls/v1` external-
attachment session, obtains a separate private runner ingest key, relays RTMP,
and reconciles the session until terminal.

### F6. Bounded live funding and usage

Live sessions bill signed runner-reported `output_seconds`. LOC may perform
finite policy-bounded refills that extend the lease. The gateway observes
normative balance state including `will_refuse_next_refill`; an optional
control WebSocket accelerates updates, but HTTP remains authoritative.

### F7. Workload runners

Go runners behind the capability broker perform FFmpeg work and remain blind
to customer identity. The ABR runner implements the streaming v2 schema and
terminal usage claim. Live runner credentials arrive only in
`session_params` and must not be interpreted, logged, or relayed by protocol
infrastructure.

### F8. Operator observability

The admin surface exposes resolver candidates, route health, assets, and live
streams. Operational views may show LOC/broker correlation IDs and redacted
lifecycle state, never payment secrets or runner credentials.

## Protocol and operational requirements

### NF1. Resolver-only, protocol-aware selection

Broker discovery uses `service-registry-daemon` only. A route must satisfy
protocol, transport, descriptor, work unit, quote, and settlement-key
requirements before any paid operation begins.

### NF2. LOC-only payment integration

The gateway uses the LOC TypeScript SDK/API for paid job and session
lifecycle. It does not call payer-daemon directly, create payment headers,
claim, or settle.

### NF3. Idempotent and durable recovery

Every open has a durable stable request ID and content hash. Gateway state
records LOC operation, broker job/session, route, quote, funded ceiling, and
terminal outcome. Unknown results converge by retrying/reconciling the same
operation. `request_id_reuse` is terminal corruption, not a retry signal.

### NF4. Secret handling

Session parameters and private ingest credentials are envelope-encrypted at
rest with the wrapping key outside the database, excluded from logs and API
responses, and deleted at terminal state.

### NF5. No compatibility layer

The release contains no `/v1/cap`, old mode headers/adapters, mode fallback,
direct payer client, or compensating settle queue. Deployment and rollback
move the gateway and its compatible external stack together.

### NF6. Docker-first and strict builds

Every component has a Docker-first build/run path. TypeScript remains strict;
Go and TypeScript test/lint gates pass for changed components.

### NF7. Mainnet-only and read-only sources

Production-shaped smoke uses Arbitrum One with bounded funds. Upstream source
repositories are read-only; copied code and contracts cite provenance.

## Deliberate exclusions

Customer pricing/Stripe, multi-tenant projects, customer webhooks, live-to-
VOD recording, and hard-delete storage cleanup remain outside this migration.
LOC network payment accounting does not imply those product features.
