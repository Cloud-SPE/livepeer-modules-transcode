# Live output-health corrected contract baseline — 2026-09-09

This reference supersedes
`2026-09-09-live-output-health-contract-baseline.md` for the immutable
Livepeer Modules revision to deploy. The earlier reference remains unchanged
as point-in-time provenance.

## Approved upstream boundary

- `livepeer-network-modules` revision:
  `d2f36cb984a0880cf82b768cb0f1e2900f491293`
- Output-health implementation revision: `cc537ca`
- Canonical metadata correction revision: `4f371b9`
- `paid-session/v1`: `1.2.0-draft` (advertised by runners as `1.2.0`)
- `rtmp-hls/v1`: `1.1.0-draft` (advertised by runners as `1.1.0`)

The corrected revision contains the same broker output-health behavior
verified in the superseded baseline and corrects the canonical
`protocols/paid-session.md` frontmatter to match its `1.2.0-draft`
changelog. Deploy this revision or a later compatible immutable revision.
