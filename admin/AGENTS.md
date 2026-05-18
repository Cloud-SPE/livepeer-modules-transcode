# AGENTS.md

This is `admin/` — the operator dashboard for Livepeer Transcode.
Vite + Lit. Modeled on Blueclaw's `web-platform/admin/`.

Component-local agent map. Root [`../AGENTS.md`](../AGENTS.md) is the
cross-cutting map.

## Routes (HashRouter)

```
#dashboard   admin-dashboard   (GET /api/v1/admin/stats)
#signups     admin-signups     (GET /api/v1/admin/waitlist + approve/reject/delete + CSV)
(unauth)     admin-login       (paste ADMIN_TOKEN)
```

## Auth

Static `ADMIN_TOKEN` (from the gateway's env). Cached in
`sessionStorage`; cleared on 401 or sign-out. Verified at login time
against the cheapest admin route (`/api/v1/admin/waitlist/count`).

## Operating principles

Inherited from the repo root + [frontend-dom-and-css-invariants.md](../docs/design-docs/frontend-dom-and-css-invariants.md):

- Light DOM only.
- Semantic HTML only.
- No inline CSS.
- Vite + Lit (workspace deps).
- Component prefix `admin-`; shared utilities use `lmt-`.

## Doing work

- `pnpm dev` — Vite on port 3001; `/api/*` proxied to `GATEWAY_URL`.
- `pnpm build` — production bundle to `dist/`.

## Skipped from Blueclaw

- `admin-chart.js` (78 LOC) — chart-lib weight; plain numbers / list
  suffice for v0.
- `admin-usage.js` (380 LOC) — billing-driven usage stats; no billing
  in v0.

## What lives elsewhere

- `../site/`   — public marketing
- `../portal/` — user portal
- `../transcode-gateway/` — backend

## Future (gateway-side routes not yet implemented)

The admin UI does NOT include video-ops views (resolver candidates,
route-health metrics, route-controls). Those gateway routes don't
exist yet; plan TBD will add them and a paired admin-video.* set of
components.
