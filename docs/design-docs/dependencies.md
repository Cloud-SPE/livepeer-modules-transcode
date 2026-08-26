# Dependencies

The Modules v2 boundary. Peer services live outside this repository and must
form one compatible release set. The gateway has no direct payer-daemon
client; LOC is the exclusive network-payment boundary.

## Required external services

### Livepeer Open Clearinghouse (LOC)

LOC is the gateway's only network payment integration. Its TypeScript SDK/API
accepts protocol-compatible resolver routes and owns funding, signing, open,
claim, settlement, retries, and durable recovery for `paid-job/v1` and
`paid-session/v1`. LOC also owns any payer-daemon/clearinghouse seam,
including recipient-rand rotation. The gateway never mints a payment header
or settles a broker directly.

Required LOC behavior includes stable idempotency, job/session inspection,
finite session refill policy, authoritative session HTTP state, optional
control-WebSocket consumption, and SDK error/result types that preserve
protocol codes and correlation IDs.

### `service-registry-daemon`

The resolver is the only broker-discovery path. Its selected route must carry
protocol, transport, request/response descriptors, work unit, estimator,
quote/fingerprint, settlement-key, and session-parameter metadata without
collapsing the job and session axes. The gateway filters incompatibility
before invoking LOC. There is no static URL fallback.

### `capability-broker`

The broker implements `POST /v1/job` for `paid-job/v1` plus the
`paid-session/v1` lifecycle. It enforces request-ID idempotency, dispatches
ABR and live runners, returns signed terminal usage, and exposes
authoritative session state. A fixed five-minute backend deadline is not
compatible with production VOD encodes.

### Postgres

Postgres stores `auth.*`, product-oriented `media.*`, and durable v2
correlation/recovery state. Live session secrets are stored only as
envelope-encrypted ciphertext; the wrapping key lives outside the database.

### S3-compatible object storage

Source uploads, VOD outputs, and playlists use S3-compatible storage.
Uploads are presigned and object bytes do not transit the HTTP gateway.

### Resend (optional)

Resend sends verification and API-key-delivery email. Development may use a
safe local email sink; raw secrets must not be written to production logs.

## In-repository components

- `transcode-gateway`: customer/auth/media owner, resolver and LOC client,
  RTMP relay, LL-HLS proxy.
- `abr-runner`: one streaming `video-transcode-abr/v2` request and terminal
  `video-transcode-abr-result/v2` response per ladder.
- `transcode-runner`: retained single-rendition runner where separately
  offered, but not used to split a product ABR request into paid sub-jobs.
- `live-runner`: paid-session runner that supervises the pinned MediaMTX
  `1.20.1` media router for authenticated RTMP and LL-HLS, and uses
  `transcode-core` for the live rendition ladder.
- `transcode-core` and `codecs-builder`: shared FFmpeg implementation/images.
- `transcode-tester` and `e2e`: contract and integrated release gates.

## Key TypeScript dependencies

- Fastify, Postgres/Drizzle, AWS S3 SDK, RTMP runtime, Zod, and the local
  strict LOC HTTP adapter.
- Resolver protobuf/gRPC support remains for `service-registry-daemon`.
- No direct payer-daemon protobuf or client library is shipped.

## Deliberately excluded

- `@livepeer-network-modules/customer-portal` and its shared workspace;
- direct payment-daemon or clearinghouse integration;
- static broker URLs or Livepeer testnet RPCs;
- Stripe/product billing, webhook delivery, or live-to-VOD recording;
- importing upstream source repos as mutable workspaces.

Dependencies default to latest stable under
[core beliefs](./core-beliefs.md). Exact approved Modules and LOC revisions
are recorded in the immutable
[contract baseline](../references/2026-08-24-livepeer-modules-v2-contract-baseline.md).
