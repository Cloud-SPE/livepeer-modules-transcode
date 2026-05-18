---
plan: 0013
title: site/ — Vite + Lit waitlist signup (public-facing marketing + signup form)
status: completed
phase: shipped
opened: 2026-05-18
closed: 2026-05-18
owner: harness
related:
  - "docs/design-docs/auth-model.md (waitlist flow)"
  - "docs/design-docs/frontend-dom-and-css-invariants.md (Vite + Lit + light DOM rules)"
  - "docs/exec-plans/completed/0002-auth-blueclaw-port.md (the auth surface this consumes)"
---

# Plan 0013 — site/ port

## 1. Problem

After plan 0002 the gateway accepts waitlist signups at
`POST /api/v1/waitlist` and email-verifies via
`GET /api/v1/waitlist/verify?token=…`. There is no customer-facing
way to hit those routes without curl.

This plan lands `site/` — the public marketing surface + waitlist
signup form, modeled on Blue Claw Network's `web-platform/site/`
(read-only shape reference, no code copy verbatim).

## 2. Required invariants

Per [frontend-dom-and-css-invariants.md](../../design-docs/frontend-dom-and-css-invariants.md):

- **Light DOM only.** Every `LitElement` overrides `createRenderRoot()`
  to return `this`.
- **Semantic HTML only.** `<header>`, `<nav>`, `<main>`, `<button>`,
  `<form>`, etc. No `<div onclick=…>`.
- **No inline CSS.** Styling only from checked-in `.css` files.
- **Vite + Lit.** `pnpm dev` for HMR; `pnpm build` for production
  bundle. `lit` is a workspace dep.

Per [auth-model.md](../../design-docs/auth-model.md):

- Component prefix: `lmt-` (livepeer-modules-transcode).
- Public routes only (no auth on the site itself).
- Talks to gateway at the same origin via `/api/v1/waitlist*` (Vite
  dev-server proxies `/api/*` to the gateway).

## 3. Execution

### 3.1 Files

```
site/
├── AGENTS.md                    # component-local (~30 lines)
├── README.md
├── package.json                 # lit + vite
├── vite.config.js               # dev-server proxy /api -> gateway
├── index.html                   # landing page + signup form
├── verify.html                  # email-verification landing page
├── index.css                    # full stylesheet (light + dark themes)
├── components/
│   ├── index.js                 # entry; imports + registers all components
│   ├── lmt-signup-form.js       # waitlist signup form
│   ├── lmt-email-verify.js      # verification result UI
│   ├── lmt-theme-toggle.js      # light/dark toggle (persists to localStorage)
│   └── lmt-toast.js             # transient notification component
├── lib/
│   └── api.js                   # tiny fetch wrapper (no auth needed here)
└── public/
    └── favicon.svg              # placeholder
```

~10 files, ~600 LOC. Substantially smaller than Blueclaw's site
(which has hero animation, FAQ, testimonials, feature comparison —
marketing fluff we skip for v0).

### 3.2 vite.config.js

```js
import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: process.env.GATEWAY_URL || 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
  build: {
    target: 'es2022',
    rollupOptions: {
      input: { index: 'index.html', verify: 'verify.html' },
    },
  },
});
```

### 3.3 index.html shape

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Livepeer Transcode — Sign up</title>
  <link rel="stylesheet" href="/index.css">
  <script>
    // Theme before paint to avoid FOUC
    (function() {
      var s = localStorage.getItem('lmt-theme');
      document.documentElement.setAttribute('data-theme',
        s || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
    })();
  </script>
  <script type="module" src="/components/index.js"></script>
</head>
<body>
  <header>
    <h1>Livepeer Transcode</h1>
    <lmt-theme-toggle></lmt-theme-toggle>
  </header>
  <main>
    <section>
      <h2>VOD + live RTMP transcode, no rate limits.</h2>
      <p>Sign up for the waitlist; we'll email you an API key when
        approved.</p>
      <lmt-signup-form></lmt-signup-form>
    </section>
  </main>
  <lmt-toast></lmt-toast>
</body>
</html>
```

`verify.html` mirrors structure but contains `<lmt-email-verify>`
instead of the signup form.

### 3.4 components/lmt-signup-form.js

POSTs `{ name, email }` to `/api/v1/waitlist` via `lib/api.js`.
Displays the universal "we've sent a verification link if your email
isn't already registered" message regardless of success/dup.
Disabled state while in-flight. Plain `<form>` with two
`<label>`-wrapped `<input>`s + `<button type="submit">`. No
frameworks beyond Lit.

### 3.5 components/lmt-email-verify.js

Runs on `verify.html`. Reads `?token=` from the URL on
`connectedCallback`, GETs `/api/v1/waitlist/verify?token=...`,
renders either "Email verified — we'll email you an API key when
approved" or "Invalid / expired link" based on response.

### 3.6 lib/api.js

```js
const API_BASE = import.meta.env.VITE_API_BASE || '';

export async function submitWaitlist(input) {
  const res = await fetch(`${API_BASE}/api/v1/waitlist`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return res.json();
}

export async function verifyEmail(token) {
  const res = await fetch(`${API_BASE}/api/v1/waitlist/verify?token=${encodeURIComponent(token)}`);
  return res.json();
}
```

### 3.7 index.css

CSS custom properties drive theming. Two themes selected via
`html[data-theme="light"|"dark"]`. Semantic-element + class-based
selectors only (no IDs, no `!important` past resets). Light DOM means
all selectors cascade naturally.

### 3.8 package.json

```json
{
  "name": "@livepeer-modules-transcode/site",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": { "lit": "^3.3.2" },
  "devDependencies": { "vite": "^8.0.10" }
}
```

### 3.9 Add to root `pnpm-workspace.yaml`

Append `"site"` to `packages:`.

## 4. Acceptance

1. `pnpm install` resolves cleanly with `site/` in the workspace.
2. `pnpm -F @livepeer-modules-transcode/site build` succeeds; `dist/`
   contains hashed `index.html` + bundled JS + CSS.
3. `pnpm -F @livepeer-modules-transcode/site dev` serves on port 3000
   with `/api/*` proxied to the gateway (visual smoke; not automated).
4. Every JS file ≤ 300 lines.
5. PLANS.md roadmap row 11 flips to ✅.
6. Plan moves to `completed/`.

## 5. Out of scope

- Marketing copy / hero animation / testimonials / FAQ / feature
  comparison — placeholder copy only for v0.
- Privacy / TOS pages — placeholder if needed; legal copy is the
  operator's concern.
- Analytics — none in v0.
- Production deployment / Cloudflare Pages config — phase 2.
- A11y audit beyond core-beliefs §6 floor — phase 2.

## 6. Decision log

| Date | Decision | Why |
|---|---|---|
| 2026-05-18 | Vite (NOT zero-build) | User-directed; aligns with Blueclaw's actual setup (their package.json uses Vite). `frontend-dom-and-css-invariants.md §5` updated in the same PR to match |
| 2026-05-18 | Brand-neutral copy mentioning "Livepeer Transcode" | Matches plan 0002's email-template decision |
| 2026-05-18 | Component prefix `lmt-` (livepeer-modules-transcode) | Per auth-model.md. Distinguishes from Blueclaw's `cc-` |
| 2026-05-18 | Skip Blueclaw's marketing components | Marketing fluff; v0 focuses on the signup flow |
| 2026-05-18 | Multi-page (index.html + verify.html), no HashRouter | Two pages, two HTML entry points via Vite's `rollupOptions.input`. Simpler than a single-page SPA with hash routing |
| 2026-05-18 | Single PR per frontend (0013 / 0014 / 0015 separately) | Per [core-beliefs §13](../../design-docs/core-beliefs.md). Per-frontend provenance |
