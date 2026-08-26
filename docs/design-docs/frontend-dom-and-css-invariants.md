# Frontend DOM and CSS invariants

Repo-wide implementation contract for all three frontends (`site/`,
`portal/`, `admin/`). These rules are enforceable mechanically; treat
any violation as a bug. They are inherited from
`livepeer-network-modules`'s equivalent doc (where the rationale was
litigated in plan 0023) and apply unchanged here.

## 1. Light DOM only

No shadow DOM. Use Lit's `createRenderRoot()` to return `this` so all
rendered nodes attach to the host element's light DOM.

**Why:** Shadow DOM hides nodes from page-level CSS, DOM-scraping
tools, screen readers in some modes, and from the OpenAI harness's
agent observability stack. Keeping everything in the light DOM means
agent UI-validation tools (snapshots, accessibility trees,
auto-driven smoke runs) can see the same tree the user sees.

**How:** Every component overrides `createRenderRoot()`:

```ts
import { LitElement, html } from "lit";

export class FooBar extends LitElement {
  createRenderRoot() { return this; }
  render() { return html`<section>…</section>`; }
}
customElements.define("foo-bar", FooBar);
```

## 2. Semantic HTML only

Use `<header>`, `<nav>`, `<main>`, `<section>`, `<article>`, `<aside>`,
`<footer>`, `<button>`, `<form>`, `<dialog>`, `<table>`, `<details>`,
etc. Reserve `<div>` and `<span>` for genuinely non-semantic grouping.

Buttons must be `<button>` (or `<a>` for navigation), never `<div>`
with click handlers. Forms must be `<form>` with named inputs.

**Why:** Agents that drive the UI rely on the accessibility tree. A
`<div onclick=…>` is invisible to that tree.

## 3. No inline CSS

No `style="…"` attributes on any element. No `<style>` tags inline
within components or HTML. CSS lives in checked-in `.css` files only.

**Why:** Inline styles defeat global theming, can't be lint-checked
for consistency, and accumulate as the codebase grows. The agent
review tools that scan checked-in CSS can't see styles that exist only
at render time.

**One narrow exception:** dynamically-computed numeric values (e.g.
`style="--progress: ${pct}%"` for a CSS custom property) are OK when
the property is consumed by a checked-in CSS rule. The actual visual
styling still lives in the `.css` file; the inline attribute only
carries the value.

## 4. Styling only from checked-in CSS files

Each frontend has a single top-level CSS file:

- `site/site.css` (or equivalent)
- `portal/portal.css`
- `admin/admin.css`

Component-scoped styles are not allowed (they would imply shadow DOM
or styled-components patterns). All styles cascade from the top-level
sheet using class names and semantic-element selectors.

Class naming: kebab-case, component-scoped by prefix
(`portal-`, `admin-`, `lmt-`). Example: `.portal-key-display`,
`.admin-waitlist-row`.

## 5. Vite builds plain Lit modules

All three sites use Vite for development and production bundling. Components
remain plain JavaScript ES modules with Lit as the only UI runtime. Each
package must pass `pnpm build`; frontend logic with lifecycle consequences
also carries Node-native unit tests where it can be kept DOM-independent.

## 6. Accessibility floor

- Every interactive element reachable by keyboard (Tab, Enter, Space,
  Esc for dialogs)
- Every form input has an associated `<label>` (either wrapping or via
  `for=`)
- Color contrast ≥ WCAG AA
- Focus indicators visible (no `outline: none` without a replacement)
- `aria-*` only where the semantic HTML alone is insufficient

## 7. Light / dark theme

CSS custom properties drive theming. Both themes are checked in.
Theme preference is persisted to `localStorage` and respects
`prefers-color-scheme` on first visit. This is consistent with
Blueclaw's frontend pattern.

## Enforcement

These rules are enforceable with a simple linter (regex + AST checks)
that runs in CI:

- Grep for `style="` in `.ts` / `.html` files → fail
- Grep for `<div` with `@click` or `onclick` → fail
- AST-check each `LitElement` subclass for an overridden
  `createRenderRoot()` → fail if missing
- Grep for `attachShadow` → fail

A `scripts/check-frontend-invariants.mjs` lint will be added under the
frontend port exec-plan (queued; see
[`../exec-plans/completed/0001-initial-port-roadmap.md`](../exec-plans/completed/0001-initial-port-roadmap.md)
phases 11–13).
