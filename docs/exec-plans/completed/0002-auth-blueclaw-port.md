---
plan: 0002
title: Auth — waitlist + admin approval + emailed API key + portal login (Blueclaw-shape port to TypeScript / Fastify)
status: completed
phase: shipped
opened: 2026-05-18
closed: 2026-05-18
owner: harness
related:
  - "docs/design-docs/auth-model.md (route surface + DB shape)"
  - "docs/design-docs/core-beliefs.md §4 (read-only source repos)"
  - "docs/design-docs/core-beliefs.md §9 (Blueclaw, not customer-portal)"
  - "docs/design-docs/dependencies.md (peer services + workspace deps explicitly not used)"
  - "docs/exec-plans/completed/0001-initial-port-roadmap.md §3.2 (sequencing)"
---

# Plan 0002 — auth port (Blueclaw shape → TypeScript / Fastify)

## 1. Problem

`livepeer-modules-transcode` has a docs-only scaffold. To start using the
gateway for any actual product call (VOD upload, RTMP push, etc.) we
need an auth surface a customer can sign up against, get approved on,
receive an API key in their inbox, and use to log into a portal.

The customer-portal workspace dep from `livepeer-network-modules` is
out (see [core-beliefs §9](../../design-docs/core-beliefs.md)). The
shape we want is Blue Claw Network's: a small public surface
(waitlist, verify), a small user surface (login, profile, rotate-key,
logout), and a small admin surface (list, approve, reject, delete,
stats, export). Blueclaw's backend is Rust/Axum + SQLx; ours is
TypeScript/Fastify + pg + drizzle. The shape is portable; the code is
not.

This plan ports that shape into TypeScript along with the bootable
shell of `transcode-gateway/`. After this plan ships, the gateway can
boot, accept waitlist signups, send verification email (env-gated),
admin-approve users, email API keys, and exchange API keys for
sessions.

## 2. Required invariants

Per [core-beliefs.md](../../design-docs/core-beliefs.md):

- **§4** Never modify any file in `~/git-repos/blue-claw-network/web-platform/`.
  Patterns come over as TS rewrites; no Rust code is copied verbatim.
- **§5–§7** No pricing, no projects, no webhooks in the auth surface.
- **§9** No `customer-portal` workspace dep. Auth is built fresh.
- **§10** `transcode-gateway/` ships with `Dockerfile` + `Makefile` +
  `compose.yaml` from day one. No host Node install required to boot
  the service.
- **§15** All deps pinned to current latest stable
  (Fastify 5, pg 8, drizzle 0.45+, zod 4, typescript 6, resend client
  latest).
- **§16** Commit messages cite the Blueclaw source file each ported
  piece is modeled on (e.g.
  `Modeled on blue-claw-network/web-platform/backend/src/routes/waitlist.rs::create_signup`).

## 3. Execution

### 3.1 Workspace + package skeleton

Create `transcode-gateway/` with:

```
transcode-gateway/
├── AGENTS.md                  # component-local map; points at root AGENTS.md
├── README.md                  # human overview; "for agents see AGENTS.md"
├── Dockerfile                 # multi-stage Node 24 alpine; tsc build; runtime
├── Makefile                   # build / test / shell / smoke / migrate
├── compose.yaml               # gateway + postgres for local dev
├── package.json               # @livepeer-modules-transcode/transcode-gateway
├── tsconfig.json              # strict, ESM, node24 target
├── tsconfig.test.json         # extends tsconfig.json for test build
├── migrations/
│   └── 0001_auth_init.sql     # auth.* schema (this plan)
└── src/
    ├── index.ts               # entry point — boot server, listen
    ├── server.ts              # Fastify factory; route registration
    ├── config.ts              # Zod env parser
    ├── db/
    │   ├── pool.ts            # pg pool factory
    │   ├── migrate.ts         # file-based SQL migrator
    │   └── schema.ts          # drizzle schema declarations (auth.*)
    ├── auth/
    │   ├── crypto.ts          # generateApiKey, sessions, verification tokens, hashes
    │   ├── rateLimit.ts       # in-memory per-IP token bucket + sweep
    │   ├── sessions.ts        # createSession / lookupSession (bump) / revoke
    │   ├── apiKeys.ts         # createApiKey / lookupByCandidates / revokeAll
    │   └── waitlist.ts        # insertSignup / verifyByToken / admin ops
    ├── email/
    │   ├── client.ts          # Resend REST client; no-op when key unset
    │   └── templates.ts       # verification / verified / apiKey HTML
    ├── middleware/
    │   ├── bearerAuth.ts      # extract Bearer token
    │   ├── adminAuth.ts       # constant-time compare ADMIN_TOKEN
    │   ├── userAuth.ts        # session lookup pre-handler
    │   └── requestLogger.ts   # structured request log
    └── routes/
        ├── health.ts          # GET /api/v1/health
        └── auth/
            ├── public.ts      # waitlist signup, verify, login
            ├── user.ts        # profile, rotate-key, logout
            └── admin.ts       # list, count, export, approve, reject, delete, stats
```

Add `transcode-gateway` to root `pnpm-workspace.yaml`.

### 3.2 Migrations — `0001_auth_init.sql`

Blueclaw's 26 SQLx migrations collapse into one clean migration here.
We land the final shape (post-migration-024) from day 1: tokens
SHA-256-hashed at rest, `verification_token_expires_at` present,
`users` table as a separate row from waitlist, partial unique index
for "one active API key per user."

```sql
-- 0001_auth_init.sql
-- Collapses blue-claw-network/web-platform/backend/migrations/{001,002,003,004,006,019,023,024}.sql
-- into one initial migration. Lives in auth.* namespace per
-- docs/design-docs/auth-model.md.

CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE auth.waitlist (
  id                             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                           TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  email                          TEXT NOT NULL UNIQUE,
  ip_hash                        TEXT,
  status                         TEXT NOT NULL DEFAULT 'pending'
                                   CHECK (status IN ('pending', 'approved', 'rejected')),
  email_verified                 BOOLEAN NOT NULL DEFAULT FALSE,
  verification_token             TEXT,                          -- SHA-256(raw token), set at signup, NULL after verify
  verification_token_expires_at  TIMESTAMPTZ,                   -- 48h default; rejected past expiry
  created_at                     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_at                    TIMESTAMPTZ,
  rejected_at                    TIMESTAMPTZ
);
CREATE INDEX waitlist_status         ON auth.waitlist (status, created_at);
CREATE UNIQUE INDEX waitlist_verify  ON auth.waitlist (verification_token) WHERE verification_token IS NOT NULL;

CREATE TABLE auth.users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  waitlist_id UUID NOT NULL UNIQUE REFERENCES auth.waitlist(id) ON DELETE CASCADE,
  email       TEXT NOT NULL UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE auth.api_keys (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  key_prefix  TEXT NOT NULL,                     -- first 8 chars + "...", for UI display
  key_hash    TEXT NOT NULL,                     -- HMAC-SHA-256(API_KEY_HASH_PEPPER, raw_key)
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at  TIMESTAMPTZ
);
CREATE INDEX api_keys_hash               ON auth.api_keys (key_hash);
CREATE INDEX api_keys_user               ON auth.api_keys (user_id);
CREATE UNIQUE INDEX api_keys_active_user ON auth.api_keys (user_id) WHERE revoked_at IS NULL;

CREATE TABLE auth.sessions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  api_key_id   UUID NOT NULL REFERENCES auth.api_keys(id) ON DELETE CASCADE,
  session_hash TEXT NOT NULL,                    -- SHA-256(raw session token)
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at   TIMESTAMPTZ NOT NULL,
  revoked_at   TIMESTAMPTZ
);
CREATE INDEX sessions_hash_active ON auth.sessions (session_hash) WHERE revoked_at IS NULL;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";  -- for gen_random_uuid()
```

The schema differs from Blueclaw's union of migrations in two
deliberate ways:

1. **`api_keys.user_id` references `auth.users(id)`** (not
   `waitlist(id)` as in Blueclaw). Blueclaw added `users` later
   (migration 019) and kept `api_keys.waitlist_id` for backwards
   compat. We have no backwards compat — clean schema from day 1.
2. **No `usage_reservations`, `models`, `stripe_billing`, etc.** —
   those Blueclaw tables are for product-specific concerns (inference
   billing, model registry) we don't have here.

### 3.3 Crypto helpers (`src/auth/crypto.ts`)

Ports `blue-claw-network/web-platform/backend/src/crypto.rs` symbol-for-symbol.

| Blueclaw function | TS equivalent | Notes |
|---|---|---|
| `generate_api_key()` | `generateApiKey()` → `tc_<48 random alphanum>` | Prefix changes `bc_` → `tc_` (transcode) |
| `sha256_hex(input)` | `sha256Hex(input)` | `crypto.createHash('sha256').update(input).digest('hex')` |
| `peppered_hash(input, pepper)` | `pepperedHash(input, pepper?)` | `sha256(pepper + '|' + input)` when pepper set; plain otherwise |
| `hash_api_key_for_storage(raw_key, pepper)` | `hashApiKeyForStorage(rawKey, pepper?)` | Alias of `pepperedHash` for call-site clarity |
| `api_key_hash_candidates(raw_key, pepper)` | `apiKeyHashCandidates(rawKey, pepper?)` | Returns `[peppered, plain]` for dual-lookup — supports future pepper rotation |
| `key_prefix(key)` | `keyPrefix(key)` | First 8 chars + `"..."` for UI |
| `generate_verification_token()` | `generateVerificationToken()` | 32 random bytes hex |
| `generate_session_token()` | `generateSessionToken()` | `sess_` + 32 random bytes hex |
| `subtle::ConstantTimeEq` (admin compare) | `constantTimeEqual(a, b)` | Wraps Node `crypto.timingSafeEqual` with length-equalizing buffer copy |

All randomness uses Node `crypto.randomBytes()`, **not** `Math.random()`.

### 3.4 Rate limiter (`src/auth/rateLimit.ts`)

Ports Blueclaw's in-memory per-IP token bucket from
`routes/waitlist.rs::check_rate_limit` + `spawn_rate_limit_sweep`.

- `createRateLimiter()` → `{ check, sweep }` where `check(key, max, windowSecs)` returns boolean
- Background sweep on a 60s interval; reclaims map entries whose
  timestamp lists are empty
- Used at: waitlist signup (5/min/IP), login (5/min/IP)

In-memory is fine for v0 single-instance deploys. Multi-instance is a
phase-2 ticket.

### 3.5 Email client (`src/email/`)

`client.ts` exposes `EmailClient.send(to, subject, html)`. Reads
`RESEND_API_KEY` from config. If unset, logs the email body instead of
sending — matches Blueclaw's `is_enabled()` fallback. Uses
`fetch()` (native in Node 24) with a 10s timeout.

`templates.ts` has three templates, all simple HTML with inline
brand-neutral styling:

- `verificationEmail({ name, verifyUrl })` — "Verify your email" with a
  CTA button. Plain blue/dark color scheme, generic enough to ship
  before product branding lands.
- `verifiedEmail({ name, portalUrl })` — "You're verified — wait for
  approval."
- `apiKeyEmail({ name, apiKey, portalUrl })` — "Your API key" with the
  raw key in a copyable block + a curl quick-start.

Templates do **not** ship with Blueclaw's marketing copy or color
palette. Pure HTML, brand-neutral. Re-branding is a phase-2 task once
product naming is locked.

### 3.6 Sessions + API keys + waitlist (`src/auth/`)

`sessions.ts`:

- `createSession(apiKeyId, ttlHours) → { rawToken, expiresAt }`
- `lookupSession(rawToken, ttlHours) → { apiKeyId, userId } | null` —
  single `UPDATE … RETURNING` that bumps `expires_at = now() + ttl`
  on hit (matches Blueclaw's "bumped" CTE)
- `revokeSession(rawToken)`
- `revokeAllSessionsForApiKey(apiKeyId)` — used during key rotation

`apiKeys.ts`:

- `createApiKey(userId, pepper?) → { rawKey, prefix }` — generates,
  hashes, inserts; raw key returned to caller once and never persisted
- `lookupActiveByCandidates(rawKey, pepper?) → ApiKeyRecord | null` —
  uses `apiKeyHashCandidates` for the SQL `key_hash = ANY($1)` lookup
- `revokeApiKey(apiKeyId)`

`waitlist.ts`:

- `insertSignup({ name, email, ipHash })` → atomic
  `INSERT … ON CONFLICT (email) DO NOTHING RETURNING id` + token mint;
  returns the raw verification token only on a fresh insert (caller
  decides whether to send the email)
- `verifyEmail(rawToken)` — atomic `UPDATE` matching hashed token
  AND `email_verified=false` AND not-expired; returns `{ name, email
  }` or null
- `listForAdmin({ page, perPage, sort, order, search, status,
  verified })` — paginated query; mirrors Blueclaw's dynamic WHERE
  builder but uses parameterized queries with positional `$N`
  placeholders only
- `countByStatus()`, `stats()`, `exportCsv()` — straightforward
- `approveBatch(ids, sendEmails)` — per-id atomic transaction:
  - `UPDATE auth.waitlist SET status='approved', approved_at=now()
    WHERE id=$1 AND status='pending' RETURNING …`
  - if `email_verified=false`, skip with a per-id warning
  - `INSERT INTO auth.users …` (idempotent via `ON CONFLICT`)
  - `INSERT INTO auth.api_keys …` (skip if active key already exists)
  - if `sendEmails`, fire-and-forget the API-key email
- `rejectBatch(ids)`, `deleteOne(id)`

### 3.7 Routes

Each handler uses Zod for request parse-don't-validate (per
[requirements §NF4](../../design-docs/requirements.md)).

**`routes/health.ts`** — `GET /api/v1/health` → `{ status: 'ok' }`.

**`routes/auth/public.ts`** (no auth):

| Method | Path | Behavior |
|---|---|---|
| `POST` | `/api/v1/waitlist` | Rate-limit 5/min/IP. Parse `{ name, email }`. Atomic insert (silent on dup). Fire-and-forget verification email. Response shape identical for new vs dup (prevents email enumeration). |
| `GET`  | `/api/v1/waitlist/verify?token=…` | Hash token, atomic UPDATE matching hash + not-verified + not-expired. Fire-and-forget "verified" confirmation email. Response is `{ status: 'verified' }` on hit OR on already-verified (don't leak which). |
| `POST` | `/api/v1/user/login` | Rate-limit 5/min/`login:<IP>`. Parse `{ api_key }`. Validate `tc_` prefix. Dual-candidate lookup. If found and user is `approved`, create session and return `{ session_token, expires_at, user: { name, email, key_prefix, key_created_at, account_status, member_since } }`. |

**`routes/auth/user.ts`** (session bearer, via `middleware/userAuth.ts`):

| Method | Path | Behavior |
|---|---|---|
| `GET`  | `/api/v1/user/profile` | Returns same `UserProfile` shape as login. |
| `POST` | `/api/v1/user/rotate-key` | Tx: revoke old key, insert new key, revoke all sessions for old key, create new session for new key. Return `{ api_key, key_prefix, session_token, expires_at }` — raw new key returned once. |
| `POST` | `/api/v1/user/logout` | Mark current session revoked. `{ status: 'ok' }`. |

**`routes/auth/admin.ts`** (admin bearer, via `middleware/adminAuth.ts`):

| Method | Path | Behavior |
|---|---|---|
| `GET`    | `/api/v1/admin/waitlist`         | Paginated list with `?page`, `?per_page`, `?sort` (name|email|status|created_at), `?order` (asc|desc), `?search`, `?status`, `?verified`. |
| `GET`    | `/api/v1/admin/waitlist/count`   | `{ count }`. |
| `GET`    | `/api/v1/admin/waitlist/export`  | CSV download. `Content-Type: text/csv`, `Content-Disposition: attachment`. |
| `POST`   | `/api/v1/admin/waitlist/approve` | Body `{ ids: string[], send_emails?: bool }`. Per-id approval as in §3.6. Returns `{ approved, emails_sent, email_errors, keys: ApiKeyGenerated[] }`. |
| `POST`   | `/api/v1/admin/waitlist/reject`  | Body `{ ids: string[] }`. Atomic `UPDATE … WHERE status='pending'` IN clause. Returns `{ rejected }`. |
| `DELETE` | `/api/v1/admin/waitlist/{id}`    | Delete a row; 404 if not found. |
| `GET`    | `/api/v1/admin/stats`            | `{ total_signups, today, this_week, this_month, daily_counts: [{ date, count }] }`. |

Admin video-ops endpoints (resolver candidates, route-health, asset
inspection, etc.) are **out of plan 0002** — they land in their
respective component port plans (live pipeline → 0006; assets → 0005).

### 3.8 Middleware

- `bearerAuth.ts` — utility: extract `Authorization: Bearer <token>` →
  `string | null`.
- `adminAuth.ts` — preHandler that constant-time-compares against
  `config.adminToken`; throws 401 on mismatch.
- `userAuth.ts` — preHandler that extracts the session token, validates
  the `sess_` prefix, calls `lookupSession`, attaches
  `{ apiKeyId, userId }` to `req`. Throws 401 on miss.
- `requestLogger.ts` — Fastify `onRequest` + `onResponse` hooks that
  emit one structured log line per request: `method`, `path`, `status`,
  `duration_ms`, `request_id` (UUID v4 minted on `onRequest`).

### 3.9 Config (`src/config.ts`)

Zod-parsed env at boot. Crashes the process on a missing required var.

| Env | Required | Default | Purpose |
|---|---|---|---|
| `DATABASE_URL` | yes | — | Postgres connection |
| `ADMIN_TOKEN` | yes | — | Admin bearer |
| `API_KEY_HASH_PEPPER` | yes | — | HMAC pepper for `api_keys.key_hash` |
| `IP_HASH_PEPPER` | no | (none) | If set, peppered hash for waitlist `ip_hash`; plain SHA-256 otherwise |
| `SESSION_TTL_HOURS` | no | `24` | Session lifetime |
| `VERIFICATION_TOKEN_TTL_HOURS` | no | `48` | Verification token lifetime |
| `RESEND_API_KEY` | no | — | If unset, email is logged not sent |
| `FROM_EMAIL` | no | `Livepeer Transcode <noreply@example.com>` | Email From: header |
| `BASE_URL` | no | `http://localhost:4000` | Used to build verification URLs |
| `PORTAL_URL` | no | `http://localhost:3002` | Used in API-key emails |
| `PORT` | no | `4000` | HTTP listen port |
| `LOG_LEVEL` | no | `info` | pino log level |
| `ALLOWED_ORIGINS` | no | `*` | CORS |

All env reads go through `loadConfig()`; no direct `process.env`
elsewhere.

### 3.10 Server + entry (`src/server.ts`, `src/index.ts`)

`server.ts` exports `createServer(deps) → FastifyInstance` for testing.
`index.ts` is the binary: parse config, create pool, run migrations,
create email client, create rate-limiter, build server, listen,
register shutdown hooks.

### 3.11 Migrations runner (`src/db/migrate.ts`)

Tiny file-based migrator. On boot:

1. Ensure `_migrations(filename TEXT PRIMARY KEY, applied_at
   TIMESTAMPTZ)` exists.
2. List `migrations/*.sql` sorted lexically.
3. For each file not in `_migrations`, run inside a transaction and
   insert the filename.

This mirrors `livepeer-network-modules`'s `runMigrations(db, dir)`
helper that the source video-gateway uses. No drizzle-kit needed; we
write SQL directly.

Drizzle is used at the **query** layer (typed schema in
`src/db/schema.ts`, queries via `drizzle-orm`), not at the migration
layer.

### 3.12 Docker + Makefile + compose

`Dockerfile` — multi-stage:

- `node:24-alpine` builder: `pnpm install --frozen-lockfile`, `tsc`
- `node:24-alpine` runtime: copy `dist/`, `migrations/`,
  `node_modules/`, run `node dist/index.js`

`Makefile` targets:

- `make build` — `docker build`
- `make smoke` — `docker compose up` + curl-based smoke
- `make migrate` — run migrations against the compose postgres
- `make shell` — interactive shell into the gateway container
- `make help` — list targets

`compose.yaml`:

- `postgres:16-alpine`
- `transcode-gateway` (built from `Dockerfile`) — depends on postgres,
  passes the env vars from §3.9

## 4. Acceptance

Plan is **complete** when:

1. `cd transcode-gateway && make build` succeeds with no host Node install.
2. `make smoke` brings up the stack and these curl commands all
   succeed end-to-end:
   - `POST /api/v1/waitlist` → 200 (signup)
   - Read the verification token from the gateway's log (Resend unset
     in smoke) → `GET /api/v1/waitlist/verify?token=…` → `{ status:
     'verified' }`
   - `POST /api/v1/admin/waitlist/approve` with the signed-up id →
     `keys[0].key` returned
   - `POST /api/v1/user/login` with that key → `session_token`
     returned
   - `GET /api/v1/user/profile` with the session bearer → profile JSON
   - `POST /api/v1/user/rotate-key` → new key + new session
   - `POST /api/v1/user/logout` → `{ status: 'ok' }`
3. `tsc --noEmit` passes (the lint gate, per [requirements §NF4](../../design-docs/requirements.md)).
4. Every TS file ≤ 300 lines (soft cap to keep agent legibility high).
5. The component `transcode-gateway/AGENTS.md` exists and points back
   to root `AGENTS.md`.
6. Root `pnpm-workspace.yaml` lists `transcode-gateway` and
   `pnpm install` resolves cleanly.
7. `PLANS.md` roadmap row for phase 1 (auth) flips to ✅.
8. This plan moves to `docs/exec-plans/completed/`.

## 5. Out of scope

- **Drizzle migration generation (drizzle-kit).** We use raw SQL files
  + a tiny migrator. Drizzle is for query typing only.
- **Multi-instance rate limiting.** v0 single-instance only.
- **OAuth, social login, magic links.** API key only.
- **Per-route ACLs, per-key scopes.** One key → full access.
- **`/api/v1/user/usage`.** Blueclaw has it; we don't have usage data
  to surface in v0 (no billing). Reserve the route for phase 2.
- **Admin video-ops routes.** Resolver candidates, route-health, asset
  inspection — those land in their respective component plans (0005,
  0006).
- **CSRF.** All state-changing routes require a bearer (admin or
  session); no cookie-based session means no CSRF surface in v0.
- **Frontends (`site/`, `portal/`, `admin/`).** Plans 0012–0014.

## 6. Decision log

| Date | Decision | Why |
|---|---|---|
| 2026-05-18 | Collapse Blueclaw's 8 auth-related migrations into one initial migration | No backwards compat to preserve; ship the final shape (hashed verification tokens, separate users table, partial unique index for one-active-key) from day 1 |
| 2026-05-18 | `api_keys.user_id` references `auth.users(id)`, not `waitlist(id)` | Blueclaw kept waitlist FK for back-compat; we don't need to |
| 2026-05-18 | API key prefix is `tc_<48 alphanum>` | Distinguishes from Blueclaw's `bc_`; matches [auth-model.md](../../design-docs/auth-model.md) |
| 2026-05-18 | Session token is `sess_<64 hex>` | Lift Blueclaw shape verbatim — keeps the prefix recognizable |
| 2026-05-18 | Use drizzle for typed queries, raw SQL files for migrations | Drizzle-kit migration generation isn't worth the indirection at this scale; raw SQL is auditable and matches the source `video-gateway` pattern |
| 2026-05-18 | In-memory per-IP rate limiter (5/min) | Matches Blueclaw; multi-instance deferred to phase 2 |
| 2026-05-18 | Email templates are brand-neutral plain HTML | Product branding isn't finalized; placeholder templates are easy to swap |
| 2026-05-18 | Constant-time admin token compare via `crypto.timingSafeEqual` | Mirrors Blueclaw's `subtle::ConstantTimeEq`; standard library is sufficient |
| 2026-05-18 | Single PR per this plan (gateway scaffold + migrations + crypto + auth backend + middleware + tests + Dockerfile + Makefile + compose) | Per [core-beliefs §13](../../design-docs/core-beliefs.md) throughput-friendly merging; component is coherent enough to land atomically |
