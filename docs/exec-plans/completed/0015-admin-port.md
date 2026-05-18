---
plan: 0015
title: admin/ — Vite + Lit admin dashboard (waitlist approval + stats)
status: completed
phase: shipped
opened: 2026-05-18
closed: 2026-05-18
owner: harness
related:
  - "docs/exec-plans/completed/0013-site-port.md (Vite + Lit pattern)"
  - "docs/exec-plans/completed/0014-portal-port.md (sibling)"
  - "docs/design-docs/auth-model.md (admin bearer flow)"
---

# Plan 0015 — admin/ port

## 1. Problem

After plan 0002 the gateway has admin routes (`/api/v1/admin/*`)
behind a static `ADMIN_TOKEN` bearer. No UI for ops to drive them.

This plan lands `admin/` — the operator dashboard for waitlist
approval + stats. Modeled on Blueclaw's `web-platform/admin/`.

Video-ops routes from plan 0006 (`/admin/video/resolver-candidates`,
`/admin/video/route-health/metrics`, `/admin/video/route-controls/*`)
don't exist yet on the gateway — those were called out as out-of-scope
for plan 0006. This plan ships the waitlist-management half of the
admin UI; the video-ops half is a future plan once the gateway routes
land.

## 2. Required invariants

Per [frontend-dom-and-css-invariants.md](../../design-docs/frontend-dom-and-css-invariants.md):
light DOM, semantic HTML, no inline CSS, Vite + Lit.

Per [auth-model.md](../../design-docs/auth-model.md):
- Component prefix: `admin-` (Blueclaw-aligned)
- `ADMIN_TOKEN` bearer (static; pasted on login, cached in
  sessionStorage). NOT a user session — admin login is just "paste
  the env-configured admin token."

## 3. Execution

### 3.1 Files

```
admin/
├── AGENTS.md
├── README.md
├── package.json
├── vite.config.js
├── admin.css
├── index.html
├── lib/
│   ├── api.js                      # admin-token-bearer wrapper
│   ├── router.js                   # tiny HashRouter (same as portal)
│   └── session.js                  # sessionStorage admin-token storage
├── components/
│   ├── index.js
│   ├── admin-app.js                # shell + nav
│   ├── admin-login.js              # admin token input
│   ├── admin-dashboard.js          # stats summary
│   ├── admin-signups.js            # waitlist list + approve/reject/delete
│   ├── admin-pagination.js         # paginated list helper (shared)
│   ├── lmt-theme-toggle.js         # shared
│   └── lmt-toast.js                # shared
└── public/favicon.svg
```

~14 files, ~1000 LOC. Drops Blueclaw's `admin-chart.js` (chart needs
chart-lib dep; v0 uses plain numbers/tables instead) and
`admin-usage.js` (no billing).

### 3.2 Routes (HashRouter)

```
#dashboard     → admin-dashboard      (GET /api/v1/admin/stats)
#signups       → admin-signups        (GET /api/v1/admin/waitlist + approve/reject/delete)
(unauth)       → admin-login
```

### 3.3 admin-signups.js capabilities

- Paginated list (page / per_page / sort / order / search / status / verified)
- Approve (single or batch); shows the returned `keys[].key` once after
  approval (operator copies & shares out-of-band if the auto-email
  fails). Includes a `send_emails` toggle.
- Reject (single or batch)
- Delete (per-row, with confirm)
- CSV export (link to `/api/v1/admin/waitlist/export`)

### 3.4 admin-dashboard.js

Calls `GET /api/v1/admin/stats` and shows
{ total_signups, today, this_week, this_month, daily_counts[] }
as a plain numbers grid + a 30-day list. No chart for v0.

### 3.5 Auth strategy

Login screen accepts the `ADMIN_TOKEN` value (operator pastes from
env). On success the token is cached in `sessionStorage` and used as
`Authorization: Bearer <token>` for every admin request. 401
clears the cache + dispatches `lmt-unauthorized` so the app flips
back to login.

## 4. Acceptance

1. `pnpm install` resolves with `admin/` in the workspace.
2. `pnpm -F @livepeer-modules-transcode/admin build` succeeds.
3. Visual smoke (manual): login → dashboard → signups → approve → key
   shown once → reject → delete works in a browser.
4. Every JS file ≤ 300 lines.
5. PLANS.md roadmap row 13 flips to ✅.
6. Plan moves to `completed/`.

## 5. Out of scope

- Video ops UI (resolver candidates, route health, route controls) —
  the gateway routes don't exist yet; separate plan.
- Asset / live-stream inspection across all customers — gateway has
  no cross-customer admin route; per-customer is the v0 model.
- Customer / topup management — no billing in v0.
- Chart visualization — plain numbers for v0.
- Bulk CSV import — no.

## 6. Decision log

| Date | Decision | Why |
|---|---|---|
| 2026-05-18 | Mirror plan 0013/0014 Vite + Lit pattern | Consistency cheaper than divergence |
| 2026-05-18 | Component prefix `admin-` (Blueclaw-aligned) | Distinguishes from `lmt-` (shared) and `portal-` |
| 2026-05-18 | Skip admin-chart.js | Chart-lib dep adds weight; plain numbers / list suffice for v0 |
| 2026-05-18 | Skip admin-usage.js | No billing in v0 |
| 2026-05-18 | Video ops UI deferred | Gateway routes (`/admin/video/*`) don't exist yet; would block this plan unnecessarily |
| 2026-05-18 | Cache ADMIN_TOKEN in sessionStorage (not localStorage) | Per-tab; operator re-pastes after closing the browser. Slightly less secure for shared machines |
| 2026-05-18 | Single PR | Throughput-friendly |
