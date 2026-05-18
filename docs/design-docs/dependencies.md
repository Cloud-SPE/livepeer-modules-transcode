# Dependencies

What this module requires at the boundary, and what it deliberately
**doesn't** import. Peer services live elsewhere — they are not in this
repo and must already be running for `transcode-gateway` to boot.

## External peer services (required)

### `capability-broker`

Where transcode jobs actually run. The gateway dispatches paid HTTP
request-response and HTTP streaming requests to it using the
`http-reqresp@v0` and `http-stream@v0` mode adapters. The broker also
owns the broker-side live RTMP / FFmpeg / LL-HLS pipeline that
terminates the live session and produces playback bytes.

- **Location:** runs on each Livepeer worker-orch host.
- **Interface:** HTTP. Resolved via service-registry-daemon (see
  below); never via a static URL env from this module.
- **Source:** `livepeer-network-modules/capability-broker/`. Not in
  scope for this module.

### `service-registry-daemon`

Resolves on-chain orch identities to a set of brokers that pass
signed-manifest and live-health checks. The gateway connects to it via
`LIVEPEER_RESOLVER_SOCKET` (UDS or TCP) and receives the
resolver-vetted set on each broker-selection call.

- **Location:** runs alongside the gateway (typically on the same
  host).
- **Interface:** socket-based RPC.
- **Source:** `livepeer-network-modules/service-registry-daemon/`. Not
  in scope for this module.
- **Why resolver-only:** see [core-beliefs.md](./core-beliefs.md) §2.

### `payment-daemon` (sender mode)

Mints Livepeer payment headers for each paid broker call. The gateway
talks to it over its existing gRPC-on-UDS interface
(`PayerDaemon.CreatePayment(…)`).

- **Location:** runs alongside the gateway.
- **Interface:** gRPC over UDS.
- **Source:** `livepeer-network-modules/payment-daemon/`. Not in
  scope for this module.

### Postgres 16

Single database, two schemas:

- `auth.*` — waitlist, users, api_keys, sessions
- `media.*` — assets, uploads, renditions, encoding_jobs, live_streams,
  playback_ids

Migrations run in order on boot: `auth/migrations/` first, then
`media/migrations/`. Connection via `DATABASE_URL` env.

### S3-compatible object store

VOD source uploads + rendition outputs + HLS playlists. Concrete impls
tested: AWS S3, RustFS, Cloudflare R2. Credentials via standard AWS
SDK env vars; bucket via `S3_BUCKET`.

The gateway never streams object bytes through its own process —
uploads use tus + presigned URLs; downloads are referenced by URL only.

### Resend (optional, env-gated)

Transactional email for waitlist verification and API-key delivery. If
`RESEND_API_KEY` is unset, the gateway logs the email body instead of
sending (matches Blueclaw's local-dev fallback).

- **Interface:** HTTPS REST API.
- **Source:** [resend.com](https://resend.com/).

## Workspace deps from `livepeer-network-modules` — explicitly NOT used

| Source workspace dep | Status here | What we do instead |
|---|---|---|
| `@livepeer-network-modules/customer-portal` | **not imported** | Auth is built fresh from the Blueclaw shape (see [auth-model.md](./auth-model.md)) |
| `@livepeer-network-modules/customer-portal-shared` | **not imported** | Frontend code is built fresh per the Blueclaw layout |
| `@livepeer-network-modules/gateway-route-health` | **not imported** | The two helpers (`summarizeRouteHealth`, `renderRouteHealthMetrics`) and the tracker are **inlined** into `transcode-gateway/src/livepeer/` |

The customer-portal workspace dep brings customer identity, prepaid
quota wallet, Stripe checkout, admin engine, idempotency middleware,
and a shared portal SPA shell. None of that fits the v0 scope (see
[core-beliefs.md](./core-beliefs.md) §5, §6, §7). Re-introducing any
piece of it is a deliberate phase-2 decision.

## TS dependencies (`transcode-gateway/`)

Mirrors the source `video-gateway` package, minus the workspace deps
above:

- `fastify` — HTTP framework
- `@fastify/static` — static file serving (for the Lit frontends)
- `pg`, `drizzle-orm` — Postgres + typed query layer
- `ioredis` — distributed locks for the live-session sweep
- `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner` — S3-compat
- `@grpc/grpc-js`, `@grpc/proto-loader` — payment-daemon UDS client
- `node-media-server` (or replacement) — pure-TS RTMP listener
- `rxjs` — internal stream composition
- `js-yaml` — config parsing
- `zod` — parse-don't-validate at boundaries
- `lit` — web components (frontend bundles)
- `resend` — transactional email

Pinning policy: latest stable, per [core-beliefs.md](./core-beliefs.md)
§15.

## Go dependencies (`transcode-core/` + runners)

Mirrors the source `video-runners`:

- Go ≥ 1.25.7 (auto-toolchain from `go.mod`)
- FFmpeg + libavformat / libavcodec / libavutil / libswscale
- x264, SVT-AV1, libopus, libvpx, libzimg — built from source in
  `codecs-builder/`
- NVIDIA NVENC / Intel QSV / AMD VAAPI — operator-supplied GPU
  passthrough

The shared `transcode-core` is consumed by both runners via a local
`replace` directive in each runner's `go.mod`.

## Frontend dependencies (`site/`, `portal/`, `admin/`)

Zero-build, mirroring Blueclaw's pattern:

- `lit@3` via [esm.sh](https://esm.sh) importmap
- A small Node dev server per site (proxies `/api/*` to the gateway)
- No Vite / Webpack / build step in v0

Per [frontend-dom-and-css-invariants.md](./frontend-dom-and-css-invariants.md):
light DOM only, semantic HTML, no inline CSS, styling only from
checked-in CSS files.

## Toolchain pinning (root)

| File              | Pins | Read by |
|---|---|---|
| `.tool-versions`  | Node `24`, Go `1.25.7` | asdf / mise / rtx |
| `.nvmrc`          | Node `24` | fnm, nvm |
| `package.json`    | `pnpm@9.0.0` + sha512 | Corepack |
| `.npmrc`          | `engine-strict=true` | pnpm |

## What this module's runtime does NOT need

- No `customer-portal` SaaS shell
- No Stripe SDK / webhook handlers
- No webhook delivery infrastructure
- No live → VOD recording handoff
- No static broker URL fallback
- No Livepeer testnet RPCs (mainnet only — see
  [core-beliefs.md](./core-beliefs.md) §3)
