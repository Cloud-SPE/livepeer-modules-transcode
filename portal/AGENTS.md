# AGENTS.md

This is `portal/` — the authenticated user surface for Livepeer
Transcode. Vite + Lit web components. Modeled on Blueclaw's
`web-platform/portal/` extended with VOD + live UIs.

Component-local agent map. Root [`../AGENTS.md`](../AGENTS.md) is the
cross-cutting map.

## Routes (HashRouter)

```
#dashboard        portal-dashboard
#account          portal-account     (rotate key)
#assets           portal-assets      (VOD list)
#assets/:id       portal-asset-detail
#upload           portal-upload      (presigned S3 PUT widget)
#live             portal-live-streams (create + manage)
#live/:id         portal-live-detail
(unauth)          portal-login       (API key input)
```

## Two-auth model

- Session token (Authorization: Bearer sess_…) gates `/api/v1/user/*`.
- API key (Authorization: Bearer tc_…) gates `/v1/*` product surface.

Both are held in `sessionStorage` (per-tab; cleared on logout). The
raw API key is cached because product routes need it; rotation
updates both.

`lib/api.js` exposes `userRequest()` + `productRequest()` —
each picks the right bearer.

## Operating principles

Inherited from the repo root + [frontend-dom-and-css-invariants.md](../docs/design-docs/frontend-dom-and-css-invariants.md):

- Light DOM only.
- Semantic HTML only.
- No inline CSS.
- Vite + Lit (workspace deps).
- Component prefix `portal-` (Blueclaw-aligned); shared utilities
  reuse `lmt-` prefix.

## Doing work

- `pnpm dev` — Vite on port 3002; `/api` + `/v1` proxied to
  `GATEWAY_URL` (default `http://localhost:4000`).
- `pnpm build` — production bundle to `dist/`.
- Commit messages cite Blueclaw source paths, e.g.:
  `Modeled on blue-claw-network/web-platform/portal/components/portal-login.js`.

## What lives elsewhere

- `../site/` — public marketing + signup
- `../admin/` — admin dashboard (plan 0015)
- `../transcode-gateway/` — backend

## Skipped from Blueclaw

- `portal-playground.js` (1626 LOC chat playground) — no inference here.
- `portal-usage.js` (176 LOC historical aggregate usage view) — durable
  per-operation v2 usage is shown on asset and live detail instead.
- `lib/history-db.js` — Dexie-backed playground history; not used.
