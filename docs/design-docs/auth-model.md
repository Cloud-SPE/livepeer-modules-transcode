# Auth model

How `livepeer-modules-transcode` authenticates waitlist signups, admin
operators, portal users, and product-API callers. The shape is modeled
directly on [Blue Claw
Network](https://github.com/blue-claw-network/web-platform)'s
onboarding flow — see [core-beliefs.md](./core-beliefs.md) §4 and §9 for
the rationale.

> **Blueclaw is a shape reference, not a code source.** Blueclaw's
> backend is Rust/Axum; this module's backend is TypeScript/Fastify.
> Route layouts, DB-table shapes, and frontend UX are ported; code is
> not. **No file in `~/git-repos/blue-claw-network/web-platform/` is
> ever modified** from this working tree.

## Identity model

Three actor types and three credential types:

| Actor | Credential | Validates on |
|---|---|---|
| Visitor (anonymous) | none | public routes only |
| Operator | static `ADMIN_TOKEN` bearer (env-set) | `/api/v1/admin/*` |
| User | session token (`Authorization: Bearer <token>`) | `/api/v1/user/*` |
| User (API caller) | long-lived API key (`Authorization: Bearer tc_<rand>`) | `/v1/uploads`, `/v1/vod/*`, `/v1/videos/*`, `/v1/live/streams`, `/_hls/*`, `/v1/playback/:id`, RTMP push key |

Sessions and API keys are owned by the same `users` row. A user with
one API key is one logical customer. Multi-tenant projects do not exist
in v0 (see [core-beliefs.md](./core-beliefs.md) §6).

The API-key prefix `tc_` distinguishes this module's keys from Blueclaw's
`bc_` keys at a glance. The prefix is not load-bearing; it's a debugging
convenience.

## Routes

### Public

| Method | Route                              | Purpose |
|---|---|---|
| `GET`  | `/api/v1/health`                   | Health check |
| `POST` | `/api/v1/waitlist`                 | Signup (`name`, `email`) |
| `GET`  | `/api/v1/waitlist/verify`          | Verify email via `?token=…` |
| `POST` | `/api/v1/user/login`               | Exchange API key for session token |

### User (session bearer)

| Method | Route                              | Purpose |
|---|---|---|
| `GET`  | `/api/v1/user/profile`             | Return user + active API key (masked) |
| `POST` | `/api/v1/user/rotate-key`          | Revoke current key, generate new one |
| `POST` | `/api/v1/user/logout`              | Invalidate session |

### Admin (`ADMIN_TOKEN` bearer)

| Method | Route                                    | Purpose |
|---|---|---|
| `GET`    | `/api/v1/admin/waitlist`              | List signups (paginated, searchable) |
| `GET`    | `/api/v1/admin/waitlist/count`        | Count signups by status |
| `GET`    | `/api/v1/admin/waitlist/export`       | Export waitlist as CSV |
| `POST`   | `/api/v1/admin/waitlist/approve`      | Approve entries (`send_email: bool`) |
| `POST`   | `/api/v1/admin/waitlist/reject`       | Reject entries |
| `DELETE` | `/api/v1/admin/waitlist/{id}`         | Delete a signup |
| `GET`    | `/api/v1/admin/stats`                 | Dashboard statistics |

The admin surface **also** carries video ops endpoints — see
[architecture-overview.md](./architecture-overview.md) and the F7
requirement in [requirements.md](./requirements.md).

### Product API (API key bearer)

See [transcode-pipeline.md](./transcode-pipeline.md) (VOD) and
[live-pipeline.md](./live-pipeline.md) (live).

## Data model

```sql
CREATE SCHEMA auth;

CREATE TABLE auth.waitlist (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  email           TEXT NOT NULL UNIQUE,
  ip_hash         TEXT,
  status          TEXT NOT NULL DEFAULT 'pending',  -- pending | approved | rejected
  email_verified  BOOLEAN NOT NULL DEFAULT FALSE,
  verify_token    TEXT,
  verify_expires  TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_at     TIMESTAMPTZ,
  rejected_at     TIMESTAMPTZ
);
CREATE INDEX waitlist_status ON auth.waitlist (status, created_at);

CREATE TABLE auth.users (
  id              TEXT PRIMARY KEY,
  waitlist_id     TEXT NOT NULL REFERENCES auth.waitlist(id),
  email           TEXT NOT NULL UNIQUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE auth.api_keys (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  key_hash        TEXT NOT NULL UNIQUE,           -- HMAC-SHA-256(pepper, key)
  key_prefix      TEXT NOT NULL,                  -- first 12 chars, for UI display
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at      TIMESTAMPTZ
);
CREATE INDEX api_keys_user_active ON auth.api_keys (user_id, active);

CREATE TABLE auth.sessions (
  id              TEXT PRIMARY KEY,                -- the session token itself, hashed
  user_id         TEXT NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expires_at      TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at    TIMESTAMPTZ
);
CREATE INDEX sessions_user_exp ON auth.sessions (user_id, expires_at);
```

Schema decisions:

- **API key storage**: only `HMAC-SHA-256(SESSION_PEPPER, raw_key)` is
  stored (the `key_hash` column). The raw key is shown to the user
  once at issue time (via email) and never persisted. A short
  `key_prefix` is stored so the portal UI can show "tc_abc123…" without
  storing the full key.
- **One active key per user**: enforced by query (status `active=true`
  + index). Rotation creates a new row and sets the old one to
  `revoked_at`.
- **Session TTL**: configurable via `SESSION_TTL_HOURS` (default `24`).
  Sessions are pruned by a background tick.
- **Schema namespace**: `auth.*` here, `media.*` for the video tables
  (see [transcode-pipeline.md](./transcode-pipeline.md)). Migrations
  run in order: `auth/` first, then `media/`.

## Frontends

Three Vite-built Lit sites, mirroring Blueclaw's layout:

| Site | Path | Purpose | Component prefix |
|---|---|---|---|
| Landing | `site/` | Marketing + waitlist signup form | `lmt-` (livepeer-modules-transcode) |
| Portal | `portal/` | Authenticated dashboard + account + video UIs | `portal-` |
| Admin | `admin/` | Waitlist approval + video ops | `admin-` |

All three follow
[frontend-dom-and-css-invariants.md](./frontend-dom-and-css-invariants.md):
light DOM only, semantic HTML, no inline CSS, styling only from
checked-in CSS files.

### Portal video UIs (extends Blueclaw's portal)

Blueclaw's portal carries: dashboard, account (view/copy API key,
rotate), playground, usage. This module's portal **adds**:

- Asset library: list / inspect / soft-delete VOD assets
- Live streams: list / inspect / end live sessions, copy RTMP push URL
- Upload widget: tus-driven VOD upload

It **omits**: playground (no inference here), usage (no billing in v0).

### Admin video ops (extends Blueclaw's admin)

Blueclaw's admin carries: stats, waitlist management, CSV export. This
module's admin **adds**:

- Resolver candidates view (what brokers the resolver returned)
- Route-health summary (per-broker cooldowns, recent outcomes,
  suppress / unsuppress controls)
- Asset and live-stream inspection (operator-side view of any user's
  content)

It **omits**: customer / topup management (no billing in v0).

## Email integration

Transactional email goes through Resend (`RESEND_API_KEY` env). Two
templates:

1. **Waitlist verification** — sent on signup. One link
   (`{{BASE_URL}}/api/v1/waitlist/verify?token=…`).
2. **API key delivery** — sent on admin approval when the operator
   toggles "send API key." Contains the raw API key (one-shot — the
   gateway never stores it).

If `RESEND_API_KEY` is unset, the gateway logs the email body instead
of sending. This matches Blueclaw's local-dev fallback.

## What's NOT in v0

- Self-service signup → instant approval (operator always approves)
- Stripe / paid plans / quotas (no billing — see
  [core-beliefs.md](./core-beliefs.md) §5)
- OAuth (Google / GitHub / etc.)
- Multi-key per user (one active key at a time)
- Per-key scopes or per-route ACLs
- Cross-product SSO (not relevant — there's only one product surface)

## Provenance

Shape reference: `~/git-repos/blue-claw-network/web-platform/`
(read-only). Specific files referenced for shape — never edited:

- `backend/migrations/` — `001_create_waitlist`, `002_add_status_and_api_keys`,
  `003_add_email_verification`, `004_user_sessions`, `006_allow_multiple_api_keys`
- `backend/src/routes/` — `health`, `waitlist`, `user`
- `backend/src/models/` — `waitlist`, `api_key`, `session`
- `backend/src/crypto.rs` — API key generation + hashing (HMAC-SHA-256
  with pepper)
- `backend/src/email.rs` — Resend integration
- `site/`, `portal/`, `admin/` — Lit web-component layouts and CSS

Each port commit lands under the auth exec-plan (queued; see
[`../exec-plans/active/0001-initial-port-roadmap.md`](../exec-plans/active/0001-initial-port-roadmap.md)
phase 1).
