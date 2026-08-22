---
plan: 0005
title: VOD routes — upload + submit + asset + playback (API-key auth, real S3 storage, end-to-end VOD pipeline)
status: completed
phase: shipped
opened: 2026-05-18
closed: 2026-05-18
owner: harness
related:
  - "docs/exec-plans/completed/0003-engine-port.md (engine + media.* schema already in)"
  - "docs/exec-plans/completed/0004-wire-layer-port.md (real workerClient + workerResolver behind env)"
  - "docs/design-docs/transcode-pipeline.md (VOD design)"
  - "docs/design-docs/auth-model.md (API key bearer)"
  - "docs/exec-plans/completed/0001-initial-port-roadmap.md §3.2 (sequencing)"
---

# Plan 0005 — VOD routes port

## 1. Problem

After plan 0004 the gateway has a fully-ported engine + a real wire
layer (when env vars are set). What it doesn't have is the
customer-facing VOD HTTP surface — there is no way for an API-key
holder to actually submit a transcode job.

The source `livepeer-network-modules/video-gateway/src/routes/{uploads,vod,playback}.ts`
ships the VOD route surface. They depend on a concrete S3
StorageProvider (`src/storage/s3.ts`), an API-key auth boundary
(currently handled by `customer-portal` middleware in source — we
need our own), and a route-hint builder
(`src/livepeer/selectionPolicy.ts::buildVodSelectionHints`) that
constrains broker selection to candidates that declare support for the
requested encoding tier + codecs.

This plan ports the VOD route surface, the S3 storage provider, the
VOD selection-policy hints, the ABR-ladder selector, and a new
API-key-bearer middleware. The submit handler calls
`jobOrchestrator.probeAndSchedule(...)` as fire-and-forget; the gateway
returns 202 immediately and the orchestrator runs in the background
(single-instance v0).

After this plan ships:

- A customer with an issued API key (from plan 0002's admin approve flow)
  can: ask for a presigned upload URL → PUT bytes directly to S3 →
  notify completion → submit transcode → poll → fetch playback URL.
- With real wire env vars set (`LIVEPEER_RESOLVER_SOCKET`,
  `LIVEPEER_PAYER_SOCKET`, `LIVEPEER_NODE_ID`), the gateway resolves a
  broker, mints payment, dispatches per-rendition encode jobs, finalizes
  the HLS manifest, and flips the asset to `ready`.
- Without those env vars, the stubs from plan 0003 fire and the asset
  is flipped to `errored` with code `NoWorkersAvailable` — useful for
  exercising the route layer without a live broker.

## 2. Required invariants

Per [core-beliefs.md](../../design-docs/core-beliefs.md):

- **§4 Read-only source repos.** Cite source paths verbatim per commit.
- **§5 No pricing.** No `/v1/vod/quote`, no `usageLedger`, no charge
  serialization, no `estimatedCost`. The source's `vod.ts` is rich with
  billing wiring; strip all of it.
- **§6 No projects.** Every column / interface field that referenced
  `project_id` is replaced with `api_key_id`. Source routes return
  `project_id` in responses; we return `api_key_id` instead.
- **§7 No webhooks.** Drop `usageLedger.refundVodUsage(...)` calls on
  failure (no ledger → no refund) and any webhook emit code (none in
  these three routes, but adjacent).
- **§14 Single root docs.**

## 3. Execution

### 3.1 New deps

| Dep | Purpose |
|---|---|
| `@aws-sdk/client-s3` (latest) | S3-compat client for presigned PUT/GET + putObject/delete/copyObject |
| `@aws-sdk/s3-request-presigner` (latest) | `getSignedUrl(client, cmd)` helper |

### 3.2 S3 storage provider (`src/storage/s3.ts` + `src/storage/index.ts`)

Port verbatim from source:

| Source | Action |
|---|---|
| `video-gateway/src/storage/s3.ts` | port verbatim — `createS3StorageProvider`, `loadS3ConfigFromEnv`, `pathFor`, `S3StorageConfig` |
| `video-gateway/src/storage/index.ts` | port verbatim (6 lines of re-exports) |

`StorageProvider` interface lives in `engine/interfaces/storageProvider.ts`
(landed plan 0003); the S3 file implements it.

### 3.3 ABR + selection policy

| Source | Action |
|---|---|
| `video-gateway/src/service/abrSelector.ts` | port verbatim — 25 lines; `selectAbrLadder` + `CustomerTier` (tier-to-encoding-tier map). For v0 every API key is "prepaid" tier → "standard" encoding ladder. Tier-customization deferred to phase 2. |
| `video-gateway/src/livepeer/selectionPolicy.ts` | port w/ edits — drop the live half (`buildLiveSelectionHints`, `LiveSelectionProfile`, `candidateSupportsLive`, `record_to_vod` filter); keep VOD half (`buildVodSelectionHints`, `VodSelectionProfile`, `candidateSupportsVod`, `candidateSupportsEncodingTier`) and all the JSON-traversal helpers they share. Live half lands in plan 0006. |

### 3.4 API-key-bearer middleware (`src/middleware/userApiKeyAuth.ts`)

New file (not in source — source delegates to customer-portal
middleware). Mirrors `userAuth.ts` (session-bearer) but uses the API
key directly:

- Extract `Bearer <token>` via `extractBearer`
- If token doesn't start with `tc_` → 401
- Call `lookupActiveByCandidates(pool, token, pepper)` from `auth/apiKeys.ts`
- If null → 401
- If found, look up user/account-status via `profileByApiKeyId`; reject
  if not `approved`
- Attach `req.apiKey = { id: apiKeyId, userId }` to the request

`declare module "fastify"` extension adds an `apiKey?` field on
`FastifyRequest`, parallel to the existing `session?` field.

### 3.5 Upload routes (`src/routes/vod/uploads.ts`)

The source's `uploads.ts` is a tus shell that delegates upload-storage
to caller-supplied callbacks. We choose a simpler v0: **presigned S3
PUT URL**, no tus. Two routes:

| Method | Path | Behavior |
|---|---|---|
| `POST` | `/v1/uploads` | Body: `{ filename, content_type }`. Creates `media.assets` row (status `preparing`, source_type `upload`) + `media.uploads` row (status `waiting`). Returns `{ upload_url, asset_id, upload_id, expires_at, storage_key }`. The `upload_url` is a presigned S3 PUT URL (1h TTL). |
| `POST` | `/v1/uploads/:id/complete` | Body: `{}`. Looks up `media.uploads` by id, flips status to `completed`, sets `completed_at`. Returns `{ asset_id, upload_id, status }`. (Tus PATCH handler dropped — clients upload directly to S3.) |

Both gated by API key.

Per-API-key scoping: the upload + asset both carry `api_key_id =
req.apiKey.id`. Any subsequent route that operates on the asset/upload
must verify `api_key_id` matches the requesting key.

### 3.6 VOD routes (`src/routes/vod/vod.ts`)

Port the source's `routes/vod.ts` with **heavy** cuts (source is 330
lines; ours should land near 200).

| Source route | Action |
|---|---|
| `POST /v1/vod/quote` | **drop** (no pricing) |
| `POST /v1/vod/submit` | port w/ cuts: drop `usageLedger.reserveVodEstimate`, drop `charge` serialization, call `probeAndSchedule(...)` fire-and-forget instead of `deps.execution.submitAsset(...)`. Return `{ asset_id, api_key_id, status: 'queued', selected_offering, selected_broker_url, encoding_tier }` (drop `execution_id`, `billing`). |
| `GET /v1/vod/:asset_id` | port w/ cuts: drop `charge` serialization; verify `asset.apiKeyId === req.apiKey.id` (404 if not, to avoid existence-leak). Returns asset + renditions + jobs + playback_id. |
| `GET /v1/videos/assets` | port w/ cuts: filter by `api_key_id` (use `assetRepo.list({ apiKeyId, limit, cursor })` from engine repo). Drop `project_id` in response; emit `api_key_id`. |
| `GET /v1/videos/assets/:id` | port w/ cuts: same as GET /v1/vod/:asset_id (essentially a richer alias). API-key-scope check. |
| `DELETE /v1/videos/assets/:id` | port verbatim; API-key-scope check; sets `deleted_at`. |

Submit flow:

1. Parse body via Zod (`{ asset_id, encoding_tier?: "standard" }`).
   Default tier is `"standard"` per
   [auth-model.md](../../design-docs/auth-model.md) (NOT source's
   `"baseline"`).
2. Fetch asset; 404 if missing or deleted; 404 if `apiKeyId` mismatch.
3. Build selection hints via `buildVodSelectionHints({ encodingTier })`.
4. Call `routeSelector.select({ capability: "video:transcode.abr",
   offering: ..., preferredExtra: hints.preferredExtra,
   supportFilter: hints.supportFilter })`. (The selector needs to be
   bound; with stubs it's empty → 503 `no_video_transcode_route`.)
5. Update asset to `queued` with `encoding_tier`, `selected_offering`.
6. **Fire-and-forget** `probeAndSchedule({ asset, ...orchestratorDeps })`.
   Catch + log errors; never await.
7. Return 202.

**Note:** Step 4 + 6 paths route through the engine's
`workerResolver` + `workerClient`. With env vars unset, those are
stubs: `workerResolver.selectWorker(...) → null` causes step 6's
orchestrator to flip asset to `errored` immediately. That's a known v0
behavior (real flow needs real broker / payer).

The submit route uses the engine's `WorkerResolver` (a thin
abstraction over `routeSelector`) rather than reaching directly into
the routeSelector. That keeps the route layer agnostic of resolver
internals.

### 3.7 Playback route (`src/routes/vod/playback.ts`)

Split source's `playback.ts`: VOD half here, live `/_hls/*` proxy
deferred to plan 0006.

| Method | Path | Behavior |
|---|---|---|
| `GET` | `/v1/playback/:id` | Look up `media.playback_ids` by id. If asset-linked: build signed HLS URL via `storage.getSignedDownloadUrl({ storageKey: master.m3u8, expiresInSec: 3600 })`. Return `{ playback_id, asset_id, hls_url }`. If live-linked: respond 501 `live_playback_not_yet_implemented` (plan 0006). 404 if missing. |

This route is **not** API-key-gated in v0 — playback IDs are bearer
tokens themselves; if the playback policy is `signed`, a token query
param is required (deferred to phase 2). Public IDs are URL-shareable
links.

### 3.8 Playback ID creation

Source creates `media.playback_ids` during asset/live-stream setup.
For v0 VOD: when an asset transitions to `ready` (orchestrator's
finalize step), create a `media.playback_ids` row if one doesn't
exist. Simpler hook than weaving it into multiple places.

Since `jobOrchestrator.runFinalize` doesn't currently know about
playback IDs, add an optional `onAssetReady?: (assetId) => Promise<void>`
callback to `OrchestratorDeps`. The route layer wires it to a function
that inserts a `media.playback_ids` row (policy `public`,
`token_required: false`) with a fresh id.

### 3.9 Config additions (`src/config.ts`)

| Env | Required for VOD? | Default | Purpose |
|---|---|---|---|
| `S3_REGION` | yes (when VOD enabled) | — | S3 region |
| `S3_BUCKET` | yes (when VOD enabled) | — | S3 bucket |
| `S3_ACCESS_KEY_ID` | yes | — | S3 access key |
| `S3_SECRET_ACCESS_KEY` | yes | — | S3 secret |
| `S3_ENDPOINT` | no | (none) | Custom S3-compat endpoint (RustFS / R2 / MinIO) |
| `S3_FORCE_PATH_STYLE` | no | `true` | Path-style addressing (needed by RustFS / MinIO) |
| `LIVEPEER_VOD_OFFERING_DEFAULT` | no | `default` | Offering id used when caller doesn't supply one |

All S3 vars are optional at the Zod layer; the gateway boots without
them but the VOD routes return 503 `s3_not_configured` until they're
set.

### 3.10 Boot wiring (`src/index.ts`)

Add to the existing wire-layer wiring:

- If S3 env vars set, construct `storage = createS3StorageProvider(loadS3ConfigFromEnv())`.
  Else, leave `storage = null` and have routes 503.
- Construct `assetRepo`, `uploadRepo`, `renditionRepo`, `jobRepoEngine`,
  `playbackIdRepoEngine` from the concrete pg-backed factories already
  landed in plan 0003.
- Register the VOD routes via `registerVod(app, { ... })`.
- The orchestrator deps for the fire-and-forget submit are composed at
  request time.

### 3.11 Server wiring (`src/server.ts`)

Add to existing route registration:

- `registerVodUploads(app, { ... })` — new
- `registerVodRoutes(app, { ... })` — new
- `registerVodPlayback(app, { ... })` — new

Deps grow; `ServerDeps` adds `storage` + the four media repos +
`workerResolver` + `workerClient` + the encoding ladder.

### 3.12 Unit tests

- `test/middleware/userApiKeyAuth.test.ts` — extract + validate +
  attach `req.apiKey`; reject non-`tc_` tokens; reject unknown keys;
  reject not-approved users. Uses a real Postgres pool (matches existing
  auth tests).
- `test/livepeer/selectionPolicy.test.ts` — `buildVodSelectionHints`
  returns hints whose `preferredExtra` mentions `video.mode = "vod"`,
  `encoding_tier`, expected codecs; `supportFilter` returns true for a
  candidate with declared support, false for one that explicitly
  excludes the requested codec.

End-to-end smoke against a real broker is **out of scope** for this
plan (no broker is configured in CI). The stubs from plan 0003 make
submit return 503 `no_video_transcode_route`, which the smoke
exercises as the expected behavior.

## 4. Acceptance

Plan is **complete** when:

1. `pnpm install` resolves new S3 SDK deps.
2. `pnpm -F @livepeer-modules-transcode/transcode-gateway lint` passes.
3. `pnpm -F @livepeer-modules-transcode/transcode-gateway test` passes
   (existing 20 + ~6 new ones).
4. With **no new env vars**, gateway still boots; auth smoke
   regression passes; VOD routes return 503 `s3_not_configured`.
5. With S3 env vars set and **no broker** env: VOD smoke exercises
   `POST /v1/uploads → upload_url returned → POST /v1/uploads/:id/complete →
   POST /v1/vod/submit → 503 no_video_transcode_route` (because stub
   resolver returns empty).
6. With S3 env vars set + a fake-resolver-socket (returning fixture
   candidates): submit returns 202; the orchestrator promptly flips
   asset to `errored` because stubWorkerClient throws on dispatch.
   (Optional — exercised in a follow-up integration plan; not blocking.)
7. Every TS file ≤ 300 lines. `vod.ts` ports at 330 source lines; after
   cuts should fit. If not, split into `vod/submit.ts` + `vod/inspect.ts`.
8. `PLANS.md` roadmap row for phase 4 (VOD routes) flips to ✅.
9. This plan moves to `docs/exec-plans/completed/`.

## 5. Out of scope

- Live RTMP routes (`/v1/live/streams`, `/_hls/*`) — plan 0006.
- Tus protocol upload — deferred (presigned S3 PUT in v0 is sufficient).
- VOD hard-delete + S3 cleanup janitor — phase 2.
- Customer-tier ABR ladder selection (per-customer policy) — phase 2
  (every key uses the "standard" tier in v0).
- Signed playback URLs with HMAC tokens — phase 2.
- Recording handoff (live → VOD) — phase 2 (per core-beliefs §8).
- `abrExecution.ts` port — skipped; call `probeAndSchedule` directly.

## 6. Decision log

| Date | Decision | Why |
|---|---|---|
| 2026-05-18 | Presigned S3 PUT URL instead of tus | tus shell in source delegates real impl to caller; we have no caller. Presigned PUT is one round-trip simpler and fully supported by every S3-compat store |
| 2026-05-18 | Skip `abrExecution.ts` (638 lines) | It wraps `probeAndSchedule` with bookkeeping that's mostly billing/live-related. Calling `probeAndSchedule` fire-and-forget directly from the route is cleaner |
| 2026-05-18 | Default encoding tier is `"standard"` (not source's `"baseline"`) | Per [auth-model.md](../../design-docs/auth-model.md); standard tier gives the customer h264 + hevc |
| 2026-05-18 | Asset row created at `POST /v1/uploads`, not at `POST /v1/vod/submit` | Lets the asset_id be returned with the upload URL, simplifying the client. Matches source's upload→asset linkage |
| 2026-05-18 | Submit calls `probeAndSchedule` fire-and-forget | Long-running orchestration; HTTP handler returns 202 immediately. Single-instance v0; queueing deferred |
| 2026-05-18 | Playback IDs created in orchestrator's finalize step via `onAssetReady` callback | Cleaner than scattering insert across route handlers; orchestrator is the single source of truth for "asset is ready" |
| 2026-05-18 | Playback route is NOT API-key-gated | Playback IDs are themselves opaque IDs; URL-shareable. Per-asset gating is a phase-2 signed-URL concern |
| 2026-05-18 | Per-API-key scope check at every asset/upload read | Prevents enumeration of other users' assets via guessed IDs. 404 (not 403) on mismatch to avoid existence leak |
| 2026-05-18 | Single PR (storage + selection-policy + abrSelector + middleware + 3 route groups + unit tests + wiring) | Per [core-beliefs §13](../../design-docs/core-beliefs.md) throughput-friendly; coherent unit |
