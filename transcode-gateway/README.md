# transcode-gateway

The customer-facing gateway for the Livepeer transcode module.
TypeScript + Fastify. Owns customer auth (waitlist + admin approval +
emailed API key + portal login) and — as later plans land — the
`media.*` schema for VOD + live.

> **For agents:** start at [`AGENTS.md`](./AGENTS.md).

## Status

**Initial port complete; Modules v2 migration in progress.** The component
ships the auth, VOD, live, playback, resolver, payment, and operator surfaces
from completed plans 0002–0017. Representative customer/auth routes include:

- `POST   /api/v1/health`
- `POST   /api/v1/waitlist` — public waitlist signup
- `GET    /api/v1/waitlist/verify` — email verification via token
- `POST   /api/v1/user/login` — exchange API key for session token
- `GET    /api/v1/user/profile` — current user profile (session bearer)
- `POST   /api/v1/user/rotate-key` — rotate API key + session
- `POST   /api/v1/user/logout` — revoke current session
- `GET    /api/v1/admin/waitlist` — list signups (admin bearer)
- `GET    /api/v1/admin/waitlist/count`
- `GET    /api/v1/admin/waitlist/export` — CSV download
- `POST   /api/v1/admin/waitlist/approve` — batch approve + emit keys
- `POST   /api/v1/admin/waitlist/reject` — batch reject
- `DELETE /api/v1/admin/waitlist/:id` — delete
- `GET    /api/v1/admin/stats` — dashboard stats

The full historical component sequence is in the
[`completed initial-port roadmap`](../docs/exec-plans/completed/0001-initial-port-roadmap.md).

The resolver boundary is pinned to the breaking Modules v2 contract described
in [`../docs/references/2026-08-22-livepeer-modules-v2-contract-baseline.md`](../docs/references/2026-08-22-livepeer-modules-v2-contract-baseline.md).
Selected routes preserve `paid-job/v1` / `paid-session/v1` axes, work-unit
estimators, quote fingerprints, price denominators, and overlapping delegated
settlement keys. Unsupported protocols, ABR transports, and live descriptor
schemas are rejected during route selection, before payment minting or session
open.

Migrations `0003_paid_operations_v2.sql` and
`0004_paid_session_recovery.sql` add the durable v2 recovery boundary:
stable request/content identity, selected route and quote evidence, LOC and
broker correlations, funding/lease/settlement state, retries, and terminal
evidence. Paid-session recovery uses kind-scoped `FOR UPDATE SKIP LOCKED`
claims, expiring ownership leases, and a lifecycle-version fence on every
mutation and secret read. Runner credentials, exact open intent, grants, and
session parameters live only in a separate envelope-encrypted table and are
deleted atomically when an operation becomes terminal. The
`PaidSessionStore` is the process boundary for claiming and advancing that
state; startup reconciliation is completed by the later live-winddown work.
The v2 clients are not wired yet; Beads epic `lmt-65a` tracks that remaining
cutover work.

## Build + run

Per core-beliefs §10, every gesture is Docker-first.

```bash
make build               # build the gateway image
make smoke               # compose up + curl-based smoke
make help                # show all targets
```

No host `node` install required.

## Local development (host Node)

For tight iteration loops only — production / smoke goes through Docker.

```bash
pnpm install             # at repo root
pnpm -F @livepeer-modules-transcode/transcode-gateway lint
pnpm -F @livepeer-modules-transcode/transcode-gateway build
```

Then point `DATABASE_URL` at a local Postgres and `node dist/index.js`.

## Env vars

See [`AGENTS.md`](./AGENTS.md) and `src/config.ts`. The compose stack
in [`compose.yaml`](./compose.yaml) shows the local-dev defaults
(except secrets, which must be overridden).

The v2 VOD and live paths require `LIVEPEER_OPERATION_SECRETS_KEK` (canonical base64
for 32 random bytes held outside Postgres) and an operator-visible
`LIVEPEER_OPERATION_SECRETS_KEY_ID`. The process may boot without them, but
paid work fails closed before route selection until durable encrypted operation
storage is configured.

The LOC boundary is enabled only when `LIVEPEER_LOC_URL` and
`LIVEPEER_LOC_API_KEY` are both set; partial configuration fails startup.
`LIVEPEER_LOC_TIMEOUT_MS` defaults to 15 seconds and
`LIVEPEER_LOC_CLIENT_ID` defaults to `livepeer-modules-transcode/0.0.0`.
The gateway sends the credential only to `/v1/*` paths on the configured
origin, refuses redirects, requires a caller-owned idempotency key for every
mutation, and never includes LOC response bodies or credentials in transport
errors.

VOD probes the presigned source locally with `ffprobe` before opening its one
ABR paid job. `VOD_FFPROBE_BIN` defaults to `ffprobe` and
`VOD_SOURCE_PROBE_TIMEOUT_MS` defaults to 30 seconds.
Unknown VOD outcomes are reclaimed under a database lease and replayed with
the encrypted original request. The recovery interval, lease, and retry delay
default to 5 seconds, 60 seconds, and 2 seconds respectively and are controlled
by `VOD_RECOVERY_INTERVAL_MS`, `VOD_RECOVERY_LEASE_MS`, and
`VOD_RECOVERY_RETRY_MS`.

Live creation uses only `paid-session/v1` with gateway-owned public RTMP
ingest. Set `LIVEPEER_GATEWAY_EXTERNAL_RTMP_URL`, keep `RTMP_RELAY_ENABLED`
enabled, and configure LOC plus the operation-secrets key. The default live
offering is `live-standard`; finite funding defaults to 60 initial
`output_seconds` and a 3,600-unit lifetime ceiling through
`LIVEPEER_LIVE_INITIAL_RUNWAY_UNITS` and `LIVEPEER_LIVE_MAX_TOTAL_UNITS`.
