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

The v2 live path requires `LIVEPEER_OPERATION_SECRETS_KEK` (canonical base64
for 32 random bytes held outside Postgres) and an operator-visible
`LIVEPEER_OPERATION_SECRETS_KEY_ID`. They remain optional until that path is
enabled so the pre-cutover gateway can still boot.
