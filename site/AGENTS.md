# AGENTS.md

This is `site/` — the public-facing marketing + waitlist signup
surface. Vite + Lit web components. Modeled on Blueclaw's
`web-platform/site/` (read-only shape reference).

Component-local agent map. Root [`../AGENTS.md`](../AGENTS.md) is the
cross-cutting map.

## Pages

- `index.html` — landing + waitlist signup form
- `verify.html` — email-verification landing page (linked from the
  verification email body)

Both share `index.css` and the components in `components/`.

## Operating principles

Inherited from the repo root + [frontend-dom-and-css-invariants.md](../docs/design-docs/frontend-dom-and-css-invariants.md):

- **Light DOM only.** Every `LitElement` overrides `createRenderRoot()`
  to return `this`.
- **Semantic HTML only.** `<form>`, `<button>`, `<nav>`. No
  `<div onclick=…>`.
- **No inline CSS.** Styling only from `index.css`.
- **Vite + Lit.** `pnpm dev` for HMR + API proxy; `pnpm build` for
  production. `lit` is a workspace dep.
- **Component prefix `lmt-`** (livepeer-modules-transcode).
- **No auth.** Public routes only. Talks to gateway via
  `/api/v1/waitlist*`.

## Doing work in this component

- `pnpm dev` — runs Vite on port 3000 with `/api/*` proxied to
  `GATEWAY_URL` (default `http://localhost:4000`).
- `pnpm build` — production bundle to `dist/`.
- Commit messages cite Blueclaw's components by file path, e.g.:
  `Modeled on blue-claw-network/web-platform/site/components/cc-signup-form.js`.

## What lives elsewhere

- `../portal/` — authenticated user portal (plan 0014)
- `../admin/` — admin dashboard (plan 0015)
- `../transcode-gateway/` — backend the site talks to
