# transcode-gateway

The customer-facing gateway for the Livepeer transcode module.
TypeScript + Fastify. Owns customer auth (waitlist + admin approval +
emailed API key + portal login) and — as later plans land — the
`media.*` schema for VOD + live.

> **For agents:** start at [`AGENTS.md`](./AGENTS.md).

## Status

**Plan 0002 — auth port.** The component currently ships:

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

VOD upload, live RTMP, playback, and the admin video-ops routes land
under subsequent plans
([`../docs/exec-plans/active/0001-initial-port-roadmap.md`](../docs/exec-plans/active/0001-initial-port-roadmap.md)).

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
