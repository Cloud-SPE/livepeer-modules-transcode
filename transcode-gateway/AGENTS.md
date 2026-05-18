# AGENTS.md

This is `transcode-gateway/` — the customer-facing gateway for the
Livepeer transcode module. TypeScript + Fastify. Owns customer auth
plus the `media.*` schema (added by later plans). Dispatches transcode
work to the external capability-broker.

Component-local agent map. Root [`../AGENTS.md`](../AGENTS.md) is the
cross-cutting map.

## Operating principles

Inherited from the repo root
([`../docs/design-docs/core-beliefs.md`](../docs/design-docs/core-beliefs.md)).
Plus:

- **Auth is Blueclaw-shaped.** Waitlist → email verify → admin
  approval → emailed API key → portal login. No customer-portal dep.
  See [`../docs/design-docs/auth-model.md`](../docs/design-docs/auth-model.md).
- **Schema namespace strict-split.** This component currently owns
  `auth.*`. `media.*` lands in plan 0005 (VOD routes + tus). Both
  schemas live in the same Postgres database; migrations run in
  filename order.
- **Resolver-only broker resolution.** No `LIVEPEER_BROKER_URL`
  static fallback (see core-beliefs §2). The resolver wiring lands in
  plan 0004 (livepeer wire layer).
- **Parse-don't-validate at boundaries.** Every route uses Zod to
  parse request bodies, params, and queries. Internal types are
  derived from Zod schemas.
- **TypeScript strict.** `tsc --noEmit` is the lint gate. No `any`
  past a Zod boundary.

## Where to look

| Question | File |
|---|---|
| What is this component? | [`README.md`](./README.md) |
| Build / run / smoke gestures | [`Makefile`](./Makefile) |
| Compose stack | [`compose.yaml`](./compose.yaml) |
| Auth design (route surface + schema) | [`../docs/design-docs/auth-model.md`](../docs/design-docs/auth-model.md) |
| VOD pipeline design (lands per plan 0005) | [`../docs/design-docs/transcode-pipeline.md`](../docs/design-docs/transcode-pipeline.md) |
| Live pipeline design (lands per plan 0006) | [`../docs/design-docs/live-pipeline.md`](../docs/design-docs/live-pipeline.md) |
| Required peer services | [`../docs/design-docs/dependencies.md`](../docs/design-docs/dependencies.md) |
| Current port plan | [`../docs/exec-plans/active/`](../docs/exec-plans/active/) |

## Source layout

```
src/
├── index.ts              # entry point
├── server.ts             # Fastify factory
├── config.ts             # Zod env parser
├── db/                   # pg pool + drizzle schema + migrator
├── auth/                 # crypto, rate-limit, sessions, api keys, waitlist
├── email/                # Resend client + HTML templates
├── engine/               # types, interfaces, repo contracts, service, dispatch, config (plan 0003)
├── repo/                 # drizzle-backed concrete media.* repos (plan 0003)
├── livepeer/             # wire layer: capability map, headers, payment, resolver,
│                         # routeHealth, real httpWorkerClient + resolverWorkerResolver,
│                         # stub fallbacks (plan 0004)
├── middleware/           # bearer / admin / user auth, request logger
└── routes/
    ├── health.ts
    └── auth/             # public + user + admin route handlers
```

Plus `proto/livepeer/registry/v1/{types,resolver}.proto` — vendored
verbatim from `livepeer-network-modules/proto-contracts/`. Loaded at
runtime by the resolver gRPC client when `LIVEPEER_RESOLVER_SOCKET` is
set.

`runtime/rtmp/` (live RTMP listener) lands under plan 0006. VOD routes
land under plan 0005.

## Doing work in this component

- Docker-first per core-beliefs §10. Use `make build`, `make smoke`.
- All routes Zod-parse request input at the boundary.
- All env reads go through `src/config.ts`; no `process.env`
  elsewhere.
- All randomness uses Node `crypto.randomBytes()`; never
  `Math.random()`.
- Admin token comparison must be constant-time
  (`crypto.timingSafeEqual` via `src/auth/crypto.ts::constantTimeEqual`).
- API key + session token raw values are returned to the caller
  **exactly once** (issue + rotation responses) and never persisted.
  Only hashes hit the DB.
- Commit messages that port a Blueclaw pattern cite the Blueclaw file,
  e.g.: `Modeled on blue-claw-network/web-platform/backend/src/routes/waitlist.rs::create_signup`.
  **Never modify any file in `~/git-repos/blue-claw-network/web-platform/`.**

## What lives elsewhere

- The other components in this repo (Go runners, frontends) sit beside
  this one as top-level subfolders; each will have its own
  `AGENTS.md` once it lands per its port plan.
- The `capability-broker`, `payment-daemon`, and
  `service-registry-daemon` peer services live in
  `livepeer-network-modules` — see
  [`../docs/design-docs/dependencies.md`](../docs/design-docs/dependencies.md).
