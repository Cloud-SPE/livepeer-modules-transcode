# AGENTS.md

This is `admin/` — the operator dashboard for Livepeer Transcode.
Vite + Lit. Modeled on Blueclaw's `web-platform/admin/`.

Component-local agent map. Root [`../AGENTS.md`](../AGENTS.md) is the
cross-cutting map.

## Routes (HashRouter)

`#catalog` displays LOC capabilities and wholesale prices via the authenticated
gateway catalog endpoint; credentials never enter the browser.

```
#dashboard   admin-dashboard   (GET /api/v1/admin/stats)
#signups     admin-signups     (GET /api/v1/admin/waitlist + approve/reject/delete + CSV)
#operations  admin-operations  (GET /api/v1/admin/operations; safe v2 diagnostics)
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

- `admin-chart.js` (78 LOC) — chart-lib weight; plain numbers and lists
  are sufficient.
- `admin-usage.js` (380 LOC) — the v2 operations view presents verified
  protocol accounting without importing a separate product-billing UI.

## What lives elsewhere

- `../site/`   — public marketing
- `../portal/` — user portal
- `../transcode-gateway/` — backend

The operations view polls durable paid-job and paid-session state. It exposes
only safe correlation IDs and accounting/lifecycle status; resolver controls,
credentials, payment envelopes, grants, and private runner ingest remain out
of the browser.
