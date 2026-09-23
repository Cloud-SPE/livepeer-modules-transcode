# 0021 — LOC Path A frontend alignment

## Objective and provenance

Implement the selected LOC Path A design faithfully across the transcode
portal and admin, and the OpenAI demo's signup composition for the public site.
The previous pass changed colors and shell shape but did not reproduce the
reference component or screen design. Evidence is in
[the investigation](../../references/2026-09-23-frontend-design-investigation.md).

LOC baseline: `6a6392a7d636f2ca694d728e9df26eb08c1e63bb`; design commits
`c9e0d2a`, `a9eff4e`, `a212cd3`, compactness correction `360481f`.
OpenAI baseline: `42680e51726110d293de6a0c316a1227b376ea91`, `web/site`.
Source repositories are read-only. Vite, plain JavaScript Lit, light DOM,
existing authentication and product API contracts remain the implementation
constraints. No backend feature is invented for visual similarity.

## Design decisions

Portal/admin take their actual CSS primitives and shell geometry from LOC:
zinc950 background, translucent surfaces, emerald customer and sky operator
accents, 44px compact header, 240px sidebar, 20px headings, 20px/24px content
padding, 20px card padding, 16px card spacing, uppercase form/table labels,
semantic tinted messages/pills, and outline SVG icons. Source CSS layers
remain intact. A shared local foundation can eliminate duplication, but must
not change those reference values. Compatibility selectors adapt existing
product markup rather than introduce a different component language.

Dark is the initial appearance regardless of OS setting. Explicit saved
light preference and a theme control remain as a transcode extension.
This supersedes the OS-derived initial theme in the frontend invariant.
Reference muted colors that fail the local AA accessibility floor are used
only decoratively; readable secondary text uses zinc400. Record this small,
intentional divergence rather than silently sacrifice legibility.

Mobile uses a fixed 260px sidebar drawer at <=760px, a backdrop, icon toggle,
Escape dismissal, focus restoration and keyboard containment while open.
Desktop sidebar remains normal navigation. Route changes close the drawer.

## Implementation and Beads dependency graph

Beads epic `lmt-cfq` owns live status; this document records rationale and
scope, not a second task tracker.

| Bead | Scope | Dependency |
| --- | --- | --- |
| lmt-cfq.1 | Plan, reference contract, acceptance matrix | None |
| lmt-cfq.2 | Layered CSS primitives, dark default, docs | .1 |
| lmt-cfq.3 | App shells, icons, drawer, login | .2 |
| lmt-cfq.4 | Dashboards and product screen adaptation | .3 |
| lmt-cfq.5 | Signup/verification composition and app links | .2 |
| lmt-cfq.6 | Builds, Docker rollout, browser verification | .4, .5 |

## Screen mapping

Public site: OpenAI's 760px main column, 32px hero, explanatory lead, real
transcode curl example, request-access section with 360px form, endpoint
list, Livepeer footer and Portal navigation. Verification uses the same
shell and preserved token handling. Deployment URLs use Vite configuration;
local development/Docker gets explicit cross-port links.

Login: LOC's 1080px page container, compact page header and wide card with
360px form. Portal still accepts emailed API keys; admin still accepts its
operator token. Errors/loading stay inside the same component hierarchy.

Portal shell: Dashboard, Assets, Upload video, Live streams and Account,
with corresponding outline icons and signed-in email. LOC-only Usage,
Catalog and billing destinations are not exposed without matching APIs.
Dashboard shows profile status, key prefix, membership and recent asset data;
asset list counts must not be represented as total counts when paginated.
Recent assets and next actions replace the old large quick-link tiles.

Product views: use consistent page headings, table containers, form width,
button hierarchy, status pills, inline messages, loading/empty/error states.
Preserve upload progress, key rotation confirmation, playback and paid-operation
status, live creation/end and session-scoped live listing.

Admin: Overview, Signups, Operations with icon navigation. Existing signup
stats become LOC label/value/subtext metric cards; daily data stays a table.
Signups retains filters, pagination, approval/rejection/export. Operations
retains safe diagnostic fields and polling. No secrets are added to summaries.

## Validation and rollout

Run all three Vite builds, existing portal tests and diff/invariant checks.
Use browser automation to verify real local signup/login pages and read-only
admin login/stats; use explicitly mocked browser API fixtures to cover all
portal/admin routes and success/empty/error states without sending email,
creating paid jobs or altering production. Fixture screenshots are labeled
as fixtures and do not establish backend integration correctness.

Capture and inspect reference and implementation screens at 1440px desktop
and 390px mobile. Check geometry, fonts, primary colors, active navigation,
form composition, no page overflow, drawer focus/Escape/backdrop/navigation,
light preference persistence, invalid login feedback and key confirmation.
Capture asset/live detail and operations with fixture accounting data.
Keep a repeatable browser harness and generated evidence outside tracked
source; document the command and actual results in this plan when finished.

Rebuild only local Docker UI services using the existing compose stack;
verify ports 3000/3001/3002 and gateway proxies. Do not restart production or
claim production deployment. Close child beads only on evidence, then close
the epic and move this plan to completed after all required checks pass.

## Risks and boundaries

Cross-app URLs differ between separate-port development and same-origin
production; configuration must support both. Global CSS can break product
controls, so fixture coverage includes every existing route. Mobile long IDs
and tables need horizontal containment. Existing source-only comparison is
insufficient: rendered review is a completion gate. Remaining unrelated v2
backend issues stay in their existing beads.

## Delivered and verified — 2026-09-23

Implemented the six scoped beads. Console foundation is adapted from LOC
`web/portal/portal.css`; console icons cite LOC `web/portal/lib/icons.js`.
Public CSS is adapted from OpenAI `web/site/index.css`. Existing product
routes, session/API-key separation and backend contracts remain in use.
All changes are local and uncommitted; no production deployment was made.

Validation results:

- Site, portal and admin Vite production builds passed.
- All five portal paid-operation presentation tests passed.
- Syntax, light-DOM and static-style checks passed for all 27 component
  modules. Dynamic upload percentage remains the documented CSS-variable
  exception. `git diff --check` passed.
- `e2e/ui-design-check.mjs` passed with 48 captured screens and zero page
  errors. Both 1440px desktop and 390px mobile headers measure 44px; all
  existing portal/admin routes have the correct active navigation item and
  no document horizontal overflow. Tables/code scroll within their containers.
- Drawer first/last focus containment, Escape focus restoration, backdrop
  dismissal, changed-route and current-route dismissal passed. Dark defaults
  were checked with a browser configured to prefer light. Saved light mode
  survived reload.
- Signup/verification success, missing token, invalid API-key feedback,
  dashboard/list error and empty states, and key-rotation confirmation were
  exercised without executing real product mutations.
- Real local admin login, stats and signout passed. Signup and product data
  use explicitly intercepted fixtures; this does not claim end-to-end paid
  transcoding or email delivery.
- Rebuilt/recreated only `site`, `portal`, `admin` in `transcode-local`.
  Ports 3000, 3002 and 3001 serve the new code; each UI's
  `/api/v1/health` proxy returned `{"status":"ok"}`.

Evidence lives in `/tmp/transcode-path-a/results.json` and adjacent PNGs.
Representative rendered screens inspected include signup desktop/mobile,
portal login, portal dashboard, account, upload, live list, asset detail,
key confirmation, error/success feedback, admin overview/signups/operations,
mobile drawers and optional light mode. Compared against the earlier
production LOC login and unchanged OpenAI signup screenshots, and freshly
rendered unchanged LOC portal desktop/mobile with fixture account responses
(`reference-loc-portal-1440.png`, `reference-loc-portal-390.png`,
`reference-loc-drawer-mobile.png`). Reference fixtures never contact LOC APIs.

Browser review caught and corrected a cascade conflict exposing mobile-only
buttons on desktop, a 52px instead of 44px header, focus restoration before
Lit removed `inert`, and compressed mobile table columns. The final harness
covers these behaviors. Readable muted text, the optional light theme,
explicit drawer close control and transcode-specific content are deliberate
extensions documented above, rather than claims of pixel-identical content.
