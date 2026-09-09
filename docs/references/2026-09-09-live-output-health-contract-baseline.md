# Live output-health contract baseline — 2026-09-09

Point-in-time provenance for the live-runner silent zero-output remediation.
This reference records the Livepeer Modules team's handoff and the read-only
upstream revision verified by this repository; supersede it rather than
editing it after this date.

## Approved upstream boundary

- `livepeer-network-modules` revision:
  `27c498c2fd8a39430018616b1b7d097c0ee4d8d7`
- Implementation revision identified by the Modules team: `cc537ca`
- `paid-session/v1`: `1.2.0-draft` (advertised by runners as `1.2.0`)
- `rtmp-hls/v1`: `1.1.0-draft` (advertised by runners as `1.1.0`)

At the pinned revision the broker accepts, durably persists, and exposes
`details.output_state`, `details.output_state_since`, and
`details.last_failure_code`; accepts the `session.ladder.restart` and
`session.output.stalled` descriptor events; preserves terminal
`output_failed`; mirrors output health through the control WebSocket; and
fails a continuously stalled session closed after 60 seconds.

Old runners are represented as `output_state: unknown`. New runners remain
wire-compatible with older brokers, but those brokers neither persist nor
enforce output health. Deployment therefore orders the updated broker before
the runner and gateway.

## Verification note

The sibling read-only checkout matched the pinned revision, and its
`sessionengine`, `sessionstore`, and `server` tests passed. The canonical
`protocols/paid-session.md` changelog contains `1.2.0-draft`, but its YAML
frontmatter still says `1.1.0-draft`; correction is tracked separately as
Bead `lmt-65a.1.21` and does not redefine the approved wire behavior above.
