# Frontend design investigation — 2026-09-23

## Evidence and scope

Compared source CSS, app shells, navigation, login, dashboard and signup
templates in transcode, LOC at `6a6392a7d636f2ca694d728e9df26eb08c1e63bb`,
and OpenAI modules at `42680e51726110d293de6a0c316a1227b376ea91`.
OpenAI's actual frontend reference is `web/`, not `gateway/`.

Also captured and inspected 1440x1000 headless Chrome screenshots of the
running local site (3000), local portal login (3002), production LOC portal
login (`https://loc.cloudspe.com/portal/`), and the OpenAI signup site served
unchanged from its local source. Screenshots are session artifacts under
`/tmp/transcode-design-audit/`: `transcode-site.png`, `transcode-portal.png`,
`loc-portal.png`, `openai-site.png`. No forms were submitted. Authenticated
screens and mobile navigation were compared in source, not visually verified.

## The named reference design

LOC's history explicitly names **Path A**:

- `c9e0d2a`: zinc + emerald/sky design system, Phase 21. Restates the
  livepeer-pymthouse palette in plain CSS variables for zero-build Lit.
- `a9eff4e`: portal sidebar shell and hero-metric dashboard, Phase 22.
- `a212cd3`: admin sidebar shell, operator overview and deposits, Phase 23.
- `360481f`: user feedback that the header was too chunky; reduces topbar
  padding to 6px 16px, minimum height to 44px, and h1 to 20px/600.
- `1515bc5`: fixes shell grid rows to `auto 1fr`.

Current contract: sibling LOC `docs/FRONTEND.md`, `web/portal/portal.css`,
`web/admin/admin.css`, `web/{portal,admin}/components/cc-app.js`,
`components/cc-sidebar.js`, and `lib/icons.js`.

OpenAI's older frontend uses horizontal tabs and a different dark palette.
It is a concrete signup/demo-flow reference, but does not implement LOC's
later Path A sidebar design. Mixing arbitrary values from both creates a
third design; that is what the transcode changes effectively did.

## Concrete mismatches

| Element | LOC Path A / OpenAI signup reference | Current transcode |
| --- | --- | --- |
| Default appearance | Fixed dark | OS preference can select light; screenshots show light |
| LOC surfaces | Zinc950 background; translucent zinc900 cards; border #27272a | Solid cards; border #303036 in dark |
| Muted text | #71717a, secondary #52525b | #a1a1aa in dark |
| App topbar | 44px minimum, 6px 16px padding, compact controls | 56px minimum, 10px 20px padding |
| Page heading | 20px, weight 600 | Shared h1 26px; inconsistent h2 page titles |
| Main padding | 20px 24px | 28px 32px |
| Cards | 20px padding, 16px bottom margin | 24px padding and margin |
| Sidebar | 240px; outline SVG icons; section labels; 8px 12px items | 240px but text-only, different padding and labels |
| Mobile navigation | 260px fixed overlay drawer, hamburger, backdrop | In-flow expanding section, text Menu button |
| Branding | Accent-colored text | Invented square marker and extra product labels |
| Login | 1080px page container, header links, broad card, 360px form | Full-width topbar, floating 440px card, extra footer |
| Form labels | 12px uppercase with tracking | Normal-case labels |
| Buttons | Explicit primary/ghost/danger variants, icon support | Generic primary styling, secondary approximations |
| Tables | 11px uppercase headers, 14px cells, 10px 8px padding | 12px normal-case headers, 13px cells, 12px padding |
| Status | Semantic colored backgrounds and text | Mostly neutral badge background |
| Signup | OpenAI: 760px main, 32px hero, API example, Portal link, 360px request form, endpoint list | Wider page, up to 48px hero, no API example or Portal link, large boxed sections |

The screenshots confirm materially different composition, not merely a
palette difference. Turning on dark mode alone cannot fix it.

## Screen and navigation mapping

LOC portal navigation is Dashboard, Usage, API keys, Catalog, Activity,
Telemetry under Account. LOC admin groups operational views under Operations,
including Overview, Users, Pending, Catalog, Audit, Deposits and others.
OpenAI portal uses horizontal Account, API keys, Health, Playground, Usage;
admin uses Waitlist, Users, Usage, Health, Registry.

Transcode should use LOC's navigation component structure, icon treatment,
active state and drawer behavior with its existing product destinations:
Dashboard, Assets, Upload video, Live streams, Account; and admin Overview,
Signups, Operations. LOC-only destinations require backend capabilities and
must not be copied as nonfunctional decoration.

Screen adaptation must include actual component markup:

- Signup: reproduce OpenAI's section order, compact width, API example and
  Portal entry point using valid transcode content and configured URLs.
- Portal/admin login: reproduce LOC's page/header/card/form composition;
  retain transcode API-key/admin-token authentication.
- Portal dashboard: replace the old welcome/account/quick-links composition
  with LOC's heading, status, metric and activity hierarchy using available
  transcode data. Do not invent credit or spend metrics.
- Admin overview: apply LOC's metric-card label/value/subtext hierarchy,
  status treatment and action placement to real signup/operations data.
- Asset/live lists and detail screens: adapt LOC table, toolbar, status,
  form, empty/error state and action patterns consistently.
- Account/key screens: adapt reference key display, actions and feedback.

## Implementation consequence

The previous pass was an approximation and is not design-complete. Replace
the invented shared styling with faithful LOC tokens, dimensions, component
markup and navigation behavior, plus the OpenAI signup composition. The
reference uses layered CSS and per-SPA styles; avoid retaining conflicting
global rules underneath copied components.

The existing local light/dark invariant conflicts with references that are
dark-only. Align the initial appearance to the reference dark design and
explicitly document any retained optional light theme as an extension.
Correct local frontend documentation that codified the approximation.

Rebuild and inspect desktop/mobile rendered views and interaction states
before calling the alignment complete. HTTP 200 and successful Vite builds
establish availability, not visual conformity. Implementation and remaining
verification are tracked by Beads `lmt-cfq`.
