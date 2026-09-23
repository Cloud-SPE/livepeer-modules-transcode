# Local onboarding and LOC catalog verification — 2026-09-23

## Findings

The affected local signup was created at 12:16:20 UTC. The demo LOC/email
configuration file was created/updated at 12:18:44 UTC. The signup remained
pending and unverified. Duplicate signup uses ON CONFLICT DO NOTHING and
sends no replacement verification email. Approval explicitly rejects an
unverified signup, but the prior admin UI discarded `skipped` and
`email_errors`, showing only the approved count. Even successful approval
could hide the one-time API key when the pending filter removed its row.

The configured email service at `https://nusend.smtpulse.com` accepted an
authenticated read of `/emails` (200). Its latest 20 records included a prior
OpenAI signup email to the affected recipient but no transcode signup email.
That establishes credential acceptance, not inbox delivery. No actual email
was sent during this investigation: an explicit resend authorization request
was pending at this point. The user can initiate a resend through the admin UI.

## Changes

Admin now displays approval skips and provider failures, retains skipped
selection, offers a rate-limited authenticated verification resend, and holds
new keys in a separate one-time result panel independent of the list filter.
Verification emails open `SITE_URL/verify.html`; provider failure rolls back
token replacement, preserving the prior link. Logs capture the provider receipt
ID and call successful submission `email.accepted`, not proof of delivery.
Dry-run submissions are no longer counted as sent emails.

Portal and admin now include Capabilities & prices. Authenticated gateway
catalog endpoints fetch LOC `/v1/capabilities`, explicitly project safe fields,
retain integer price strings and denominators, mark configured ABR/live
offerings, and distinguish catalog-only offerings. The initial view filters
video capabilities; all network capabilities and search are available.
Pricing is labeled network wholesale, not customer retail or a reserved quote.

## Live checks

The rebuilt gateway's admin catalog endpoint returned 200 with eight network
capabilities, including three video capabilities:

| Capability | Offering | Price in wei | Work-unit denominator |
| --- | --- | --- | --- |
| video:transcode.abr | abr-default | 1629000000000 | 1000 video-frame-megapixel |
| video:transcode.live | gateway-ingest | 1000000000000 | 1 output_seconds |
| video:transcode.vod | vod-default | 1629000000000 | 1000 video-frame-megapixel |

These are point-in-time observations. The UI reads current LOC data.

Diagnostic probes using a nonstandard SDK identifier timed out. Subsequent
checks using the gateway's actual loaded configuration successfully selected
both ABR (paid-job/v1, 1119ms) and live (paid-session/v1, 573ms). Follow-up
HTTP discovery requests returned 200 in 431ms and 372ms. This verifies
configured authentication/discovery, not a funded transcode job.

## Validation

153 gateway tests pass, including catalog auth/projection/precision/error
handling and resend authorization, rate limiting and rollback tests. Admin
and portal Vite builds pass. The expanded design browser harness passes 56
screens with zero page errors. The separate mocked onboarding harness passes
unverified rejection, resend acceptance, email-provider failure feedback,
and key retention after the pending row disappears. All mutation requests in
that browser regression are intercepted, so no email or real key is issued.

Actual local admin login and the real LOC-backed catalog were checked in the
browser at desktop and mobile sizes; filters showed three video and eight
all-network capabilities. Screenshots inspected under `/tmp/transcode-path-a`:
`real-loc-catalog-desktop.png`, `real-loc-catalog-mobile.png`,
`fixture-approval-unverified.png`, `fixture-approval-key-survives-filter.png`.
Gateway and UI Docker services were rebuilt/recreated; changes are uncommitted.

Beads: `lmt-316` (onboarding repair), `lmt-clu` (catalog). Recipient delivery
still requires an authorized real resend and recipient confirmation.
