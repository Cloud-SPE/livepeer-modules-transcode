# Requirements

What `livepeer-modules-transcode` must do to ship v0. Each requirement
has a rationale; if a requirement turns out to conflict with another,
the design doc that resolves the conflict supersedes this list.

## Functional requirements

### F1. Waitlist signup

The module exposes a public unauthenticated endpoint to capture a
waitlist signup (`name`, `email`, optional metadata) and store it
pending admin action. A verification token is emailed to the address;
visiting the link marks the row email-verified.

**Why:** Self-service onboarding gate. Mirrors Blueclaw's flow.

### F2. Admin approval

The admin dashboard, gated by a static `ADMIN_TOKEN` bearer, lists
waitlist rows (paginated, searchable, filterable by status), and
exposes approve / reject / delete actions. Approval optionally emails
the API key to the user.

**Why:** Operator-curated onboarding for v0; replaces customer-portal's
self-serve checkout.

### F3. User portal login

The user portal accepts a long-lived API key, exchanges it for a
session token, and gates `/api/v1/user/*` routes (profile, rotate key,
logout) by that session token.

**Why:** Lets the user see and rotate their own API key without giving
them an admin surface.

### F4. VOD batch transcode

A customer with a valid API key can:

1. `POST /v1/uploads` (tus) — request a tus upload URL.
2. `PATCH /v1/uploads/:id` (tus body) — upload the source bytes.
3. `POST /v1/vod/submit` — request the gateway begin transcode of an
   uploaded asset, returning a job-tracking handle.
4. `GET /v1/vod/:asset_id` and `GET /v1/videos/assets/:id` — poll for
   asset and rendition state until `ready`.
5. `GET /v1/playback/:id` — get a playback URL for the HLS manifest.
6. `DELETE /v1/videos/assets/:id` — soft-delete (sets `deleted_at`,
   does not purge storage in v0).

The gateway plans an ABR rendition ladder, dispatches per-rendition
encoding jobs to the capability-broker via `http-reqresp@v0` /
`http-stream@v0`, and builds the HLS manifest when all renditions
complete.

**Why:** This is the core product surface.

### F5. Live RTMP ingest + LL-HLS playback

A customer with a valid API key can:

1. `POST /v1/live/streams` — allocate a stream key and receive an RTMP
   push URL (gateway-hosted listener) plus an LL-HLS playback URL.
2. Push RTMP to the URL; the gateway terminates RTMP in a pure-TS
   listener and opens a session against the resolved capability-broker.
3. `GET /_hls/*` — strict-proxy LL-HLS playlist + segment requests to
   the broker.
4. `POST /v1/live/streams/:id/end` — end the session (also driven by
   the gateway's stuck-session sweep when RTMP disconnects).

**Why:** Live is the second core product surface.

### F6. Workload runners (Go) perform the actual transcode

`transcode-runner` exposes `POST /v1/video/transcode` for VOD
single-rendition jobs. `abr-runner` exposes
`POST /v1/video/transcode/abr` for multi-rendition ABR jobs. Both share
`transcode-core` (FFmpeg, GPU detection, presets, HLS, progress,
thumbnails, filters). Both run behind the capability-broker, which
forwards paid HTTP from the gateway.

**Why:** Splits the customer-facing surface from the workload binary.
Runners are blind to customer identity (per source-repo invariant).

### F7. Operator admin surface for ops

The admin dashboard surfaces:

- Resolver candidate set (what brokers the resolver returned)
- Per-broker route-health summary (cooldowns, recent outcomes, suppress
  / unsuppress controls)
- Asset and live-stream lists with inspection
- Waitlist management (from F2)

No customer or billing inspection in v0 (out of scope per
[core-beliefs §5 / §6](./core-beliefs.md)).

## Non-functional requirements

### NF1. Resolver-only broker discovery

The gateway must boot without `LIVEPEER_BROKER_URL`. The only
configured broker socket is `LIVEPEER_RESOLVER_SOCKET` pointing at a
`service-registry-daemon` instance. See
[dependencies.md](./dependencies.md).

### NF2. Real Livepeer payment minting

The gateway calls a `payment-daemon` over its existing gRPC-on-UDS
interface to mint payment headers for paid broker requests. No dev-mode
no-op fallback.

### NF3. Docker-first build / run

Every component ships with a `Dockerfile` + `Makefile` + `compose.yaml`
(where multi-service). No host `node` / `go` / `ffmpeg` install
required.

### NF4. Strict TypeScript

The gateway and frontends pass `tsc --noEmit` (or equivalent) as the
lint gate. No `any` slipped past parse-don't-validate boundaries (see
the OpenAI harness pattern's "parse-don't-validate" guidance).

### NF5. Frontend invariants

All three frontends (site / portal / admin) are zero-build Lit web
components, light DOM only, semantic HTML, no inline CSS, styling only
from checked-in CSS files. See
[frontend-dom-and-css-invariants.md](./frontend-dom-and-css-invariants.md).

### NF6. Mainnet only

No Livepeer testnets. Smoke runs against Arbitrum One. Dust amounts on
mainnet are preferred over testnet mocks.

### NF7. No upstream-source modifications

The two source repos (`livepeer-network-modules`, `blue-claw-network`)
are read-only from this working tree. Code copies are deliberate,
commit-recorded decisions under a numbered exec-plan.

## Out of v0 scope (filed for phase 2)

- Pricing, cost quote, `/v1/vod/quote`, usage ledger, Stripe integration
- Multi-tenant `projects` model and `/v1/projects` routes
- Customer-facing webhooks (mgmt routes, signer, dispatcher, replay)
- Live → VOD recording handoff (`record_to_vod`, `media.recordings`)
- VOD hard-delete + S3 cleanup janitor
- Hardware-wallet keystore support (deferred per
  `livepeer-network-modules` plan 0019 Q1)

See [core-beliefs.md](./core-beliefs.md) for the full deferment
rationale.
