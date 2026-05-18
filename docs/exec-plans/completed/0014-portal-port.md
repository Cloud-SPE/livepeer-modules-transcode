---
plan: 0014
title: portal/ — Vite + Lit user portal (account + asset library + live streams + upload)
status: completed
phase: shipped
opened: 2026-05-18
closed: 2026-05-18
owner: harness
related:
  - "docs/exec-plans/completed/0013-site-port.md (Vite + Lit pattern)"
  - "docs/design-docs/auth-model.md (session-bearer flow + portal video UIs)"
  - "docs/design-docs/transcode-pipeline.md (VOD)"
  - "docs/design-docs/live-pipeline.md (live)"
---

# Plan 0014 — portal/ port

## 1. Problem

After plan 0002 + 0005 + 0006 the gateway has a session-bearer-gated
user surface (`/api/v1/user/*`) and an API-key-bearer-gated product
surface (`/v1/uploads`, `/v1/vod/*`, `/v1/videos/assets`, `/v1/live/streams`).
There is no UI for any of it.

This plan lands `portal/` — the authenticated user surface, modeled
on Blue Claw Network's `web-platform/portal/` (read-only shape
reference) extended with video product UIs (asset library, live
streams, upload widget). Drops Blueclaw's playground (no inference)
and usage (no billing).

## 2. Required invariants

Per [frontend-dom-and-css-invariants.md](../../design-docs/frontend-dom-and-css-invariants.md):
light DOM only, semantic HTML, no inline CSS, Vite + Lit.

Per [auth-model.md](../../design-docs/auth-model.md):
- Component prefix: `portal-` (matches Blueclaw's prefix)
- Session-bearer auth for portal-specific routes (profile, rotate-key,
  logout). API-key-bearer auth for product routes (assets, uploads,
  live streams). The portal holds the session token in
  `sessionStorage` (NOT localStorage — short-lived, per-tab).
- The portal also holds the user's most recent API key returned by
  the rotate-key flow in `sessionStorage` so the asset/live UI can
  use it for product-API calls. (Note: this couples portal UX to the
  rotate flow — see decision log §6.)

## 3. Execution

### 3.1 Files

```
portal/
├── AGENTS.md                       # component-local
├── README.md
├── package.json                    # lit + vite
├── vite.config.js                  # /api proxy → gateway, /v1 proxy → gateway
├── portal.css                      # full stylesheet
├── index.html
├── lib/
│   ├── api.js                      # session-bearer wrapper + API-key-bearer wrapper
│   ├── router.js                   # tiny HashRouter
│   └── session.js                  # sessionStorage helpers
├── components/
│   ├── index.js                    # entry
│   ├── portal-app.js               # shell + nav + view switching
│   ├── portal-login.js             # API-key input → POST /api/v1/user/login
│   ├── portal-dashboard.js         # profile summary + quick links
│   ├── portal-account.js           # rotate-key + key display
│   ├── portal-key-display.js       # show + copy current API key
│   ├── portal-assets.js            # NEW: VOD asset library
│   ├── portal-asset-detail.js      # NEW: per-asset view (renditions, jobs, playback)
│   ├── portal-upload.js            # NEW: presigned-S3-PUT upload widget
│   ├── portal-live-streams.js      # NEW: list + create live stream
│   ├── portal-live-detail.js       # NEW: per-stream view (rtmp_push_url, hls)
│   ├── lmt-theme-toggle.js         # shared (mirrors site/)
│   └── lmt-toast.js                # shared (mirrors site/)
└── public/
    └── favicon.svg
```

~17 files, ~1500 LOC after dropping Blueclaw's playground (1626 LOC)
and usage (176 LOC).

### 3.2 Routes (HashRouter)

```
#dashboard    → <portal-dashboard>
#account      → <portal-account>
#assets       → <portal-assets>
#assets/:id   → <portal-asset-detail>
#upload       → <portal-upload>
#live         → <portal-live-streams>
#live/:id     → <portal-live-detail>
(unauth)      → <portal-login>
```

### 3.3 Auth strategy

The portal authenticates via session token (from `POST
/api/v1/user/login` with API key → returns session_token). Session
token gates `/api/v1/user/*` routes.

The asset / live / upload routes are **API-key**-bearer-gated, not
session-bearer-gated. So the portal needs the user's raw API key for
those calls. Approach:

- On login: the response carries `user.key_prefix` (masked) but NOT
  the raw key. The raw key was only shown once at admin-approval
  time (emailed). Customers paste the raw key during login → portal
  stores it in `sessionStorage` (`lmt-api-key`) for subsequent
  product calls.
- On rotate-key: response includes a new raw key + new session token;
  portal swaps both in `sessionStorage`.

`lib/api.js` exports two helpers: `userRequest(...)` (Authorization:
session) and `productRequest(...)` (Authorization: api-key).

### 3.4 Routes added in v0 (gateway-side, already shipped)

| Path | Gated by | Plan |
|---|---|---|
| `POST /api/v1/user/login` | (public, rate-limited) | 0002 |
| `GET /api/v1/user/profile` | session | 0002 |
| `POST /api/v1/user/rotate-key` | session | 0002 |
| `POST /api/v1/user/logout` | session | 0002 |
| `POST /v1/uploads` | api-key | 0005 |
| `POST /v1/uploads/:id/complete` | api-key | 0005 |
| `POST /v1/vod/submit` | api-key | 0005 |
| `GET /v1/videos/assets` | api-key | 0005 |
| `GET /v1/videos/assets/:id` | api-key | 0005 |
| `DELETE /v1/videos/assets/:id` | api-key | 0005 |
| `GET /v1/playback/:id` | (public bearer-in-URL) | 0005 / 0006 |
| `POST /v1/live/streams` | api-key | 0006 |
| `GET /v1/live/streams/:id` | api-key | 0006 |
| `POST /v1/live/streams/:id/end` | api-key | 0006 |

The portal hits all of these.

### 3.5 Upload UX

`<portal-upload>`:
1. Asks for filename + content-type.
2. `POST /v1/uploads` → receives `{ upload_url, asset_id, upload_id, storage_key, expires_at }`.
3. Uses `fetch(upload_url, { method: 'PUT', body: file })` to upload bytes to S3 directly.
4. `POST /v1/uploads/:id/complete` to notify.
5. Optionally `POST /v1/vod/submit` with `{ asset_id, encoding_tier:'standard' }` to start transcode.

Progress: `XMLHttpRequest` for `upload.onprogress`. (`fetch()` doesn't
expose upload progress in browsers as of writing.)

### 3.6 Live stream UX

`<portal-live-streams>`:
- POST /v1/live/streams creates a stream. Show:
  - `rtmp_push_url` (with `kind: "broker_direct"` or `"gateway_relay"`
    badge — see plan 0007)
  - `stream_key`
  - `hls_playback_url` (when active)
- List + end-stream button per row.

### 3.7 Skipped Blueclaw components

- `portal-playground.js` (1626 LOC) — chat playground for inference.
  Not applicable.
- `portal-usage.js` (176 LOC) — usage stats from billing data. No
  billing in v0.
- `lib/history-db.js` — Dexie-backed history for the playground.
  Not needed.

## 4. Acceptance

1. `pnpm install` resolves with `portal/` in the workspace.
2. `pnpm -F @livepeer-modules-transcode/portal build` succeeds; `dist/`
   produced.
3. `pnpm dev` serves on port 3002 with `/api/*` + `/v1/*` proxied to
   gateway.
4. Visual smoke (manual): login → dashboard → assets → upload →
   live → rotate-key → logout flow works in a browser. Not automated
   for v0.
5. Every JS file ≤ 300 lines.
6. PLANS.md roadmap row 12 flips to ✅.
7. Plan moves to `completed/`.

## 5. Out of scope

- Playground (no inference) — dropped.
- Usage statistics (no billing) — dropped.
- HLS player embedded in the portal — clients use their own player
  on the returned URL. Phase 2 if needed.
- Multi-account / org switching — single API key per user in v0.
- Webhook config UI — no webhooks in v0.

## 6. Decision log

| Date | Decision | Why |
|---|---|---|
| 2026-05-18 | Reuse plan 0013's Vite + Lit pattern verbatim | Three frontends share the stack; consistency cheaper than divergence |
| 2026-05-18 | Component prefix `portal-` (matches Blueclaw) | Distinguishes from `lmt-` shared components and from `admin-` (plan 0015) |
| 2026-05-18 | Reuse `lmt-theme-toggle` + `lmt-toast` from site/ | Both are generic, light-DOM, no state. Pure copy; cite plan 0013 in commit |
| 2026-05-18 | Hold raw API key in sessionStorage after login | Necessary because product routes use API-key bearer (not session bearer). User pastes key during login; portal caches it per-tab |
| 2026-05-18 | XMLHttpRequest (not fetch) for upload progress | fetch() doesn't yet expose upload progress in browsers |
| 2026-05-18 | HashRouter (matches Blueclaw) | Two-line tiny router; no server-side routing config needed; works on any static host |
| 2026-05-18 | Skip playground + usage | Out of v0 scope (no inference, no billing); ~1800 LOC dropped |
| 2026-05-18 | Single PR | Throughput-friendly |
