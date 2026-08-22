---
plan: 0003
title: Engine port — types, interfaces, repo, service, dispatch + media.* migration
status: completed
phase: shipped
opened: 2026-05-18
closed: 2026-05-18
owner: harness
related:
  - "docs/exec-plans/completed/0002-auth-blueclaw-port.md (gateway scaffold already exists)"
  - "docs/design-docs/transcode-pipeline.md (VOD design + media.* schema)"
  - "docs/design-docs/live-pipeline.md (live tables shipped here, populated in 0006)"
  - "docs/design-docs/architecture-overview.md (layered model)"
  - "docs/design-docs/core-beliefs.md §5–§9 (scope cuts)"
  - "docs/exec-plans/completed/0001-initial-port-roadmap.md §3.2 (sequencing)"
---

# Plan 0003 — engine port (TS rewrite-with-rename from `video-gateway/src/engine/`)

## 1. Problem

After plan 0002, `transcode-gateway/` boots and serves the auth surface,
but nothing in the repo yet knows how to plan an ABR ladder, build an
HLS manifest, dispatch a transcode job, or talk to a broker.

The source `livepeer-network-modules/video-gateway/src/engine/` is the
TS engine that owns all of that: types (asset, job, rendition, live
stream, playback id, worker), interface boundaries
(storage / worker client / worker resolver / logger / event bus / stream
key hasher), repo contracts, ABR ladder config, the manifest +
playback-URL builders, and the `jobOrchestrator` that ties it all
together.

This plan ports that engine into `transcode-gateway/src/engine/` with
three deliberate edits:

1. **`projectId` → `apiKeyId`** at every type / repo / interface
   boundary (no multi-tenant projects per [core-beliefs §6](../../design-docs/core-beliefs.md)).
2. **Drop billing.** No `costQuoter.ts`, no `pricing.ts`, no `Wallet`
   interface, no `WalletReserveFailed` error code, no `CostQuote` or
   `UsageReport` types, no reservation handle dance in
   `jobOrchestrator.ts` (per [core-beliefs §5](../../design-docs/core-beliefs.md)).
3. **Drop webhooks.** No `webhookSigner.ts`, no `webhookSink.ts`, no
   `WebhookEvent` types, no `eventBus.ts` interface, no
   `eventBus.emit(…)` calls in `jobOrchestrator.ts` (per
   [core-beliefs §7](../../design-docs/core-beliefs.md)). Logger calls
   stay, so observability survives.

Adds:

- `media.*` Postgres schema migration (`0002_media_init.sql`) — the
  data model the engine repos sit on top of. Drops `media.projects`,
  `media.pricing`, `media.live_session_debits`, `media.webhook_*`, and
  `media.recordings` from the source schema (per scope cuts).
- Drizzle schema entries for `media.*` (so query code is typed).
- Stub `WorkerClient` + `WorkerResolver` implementations that throw
  `NotImplementedError`. These satisfy the engine boundary so the
  gateway still boots; real impls land in plan 0004 (wire layer).
- Concrete drizzle-backed repo implementations satisfying every
  interface in `engine/repo/`.

After this plan ships, the gateway still serves only auth routes (VOD
routes land in 0005, live in 0006). What's new is that the engine
module is compiled, typed, and ready for those routes to wire up.

## 2. Required invariants

Per [core-beliefs.md](../../design-docs/core-beliefs.md):

- **§4** Source repo is read-only. Cite the source file in every
  commit message that ports a piece (e.g.
  `Modeled on livepeer-network-modules/video-gateway/src/engine/service/manifestBuilder.ts`).
- **§5–§7** No billing, no projects, no webhooks. The engine code that
  ports here has those concerns stripped.
- **§10** Docker-first. Migrations run on container boot via the
  existing `runMigrations(pool, dir)` helper from plan 0002.
- **§14** Single root `docs/` — no per-component design docs added.
- **§15** Latest stable deps — no new deps beyond what plan 0002
  already added.

Plus from plan 0001's roadmap:

- **Single PR.** All ~25 ported files + 1 migration land in one
  coherent change. Smaller than plan 0002.
- **Every TS file ≤ 300 lines.** Source's `jobOrchestrator.ts` is 420
  lines; after stripping billing + webhook code it should drop under
  300. If it stays over, split into `orchestrator/{probe,encode,finalize}.ts`.

## 3. Execution

### 3.1 Migrations — `0002_media_init.sql`

Mirrors `livepeer-network-modules/video-gateway/migrations/0000_video_init.sql`
with the following cuts: no `media.projects`, no
`media.recordings`, no `media.pricing` (plus pricing-related columns),
no `media.live_session_debits`, no `media.webhook_endpoints`, no
`media.webhook_failures`, no `recording_enabled` / `recording_asset_id`
fields on `media.live_streams`. Every `project_id` column is renamed
to `api_key_id` and references `auth.api_keys(id) ON DELETE RESTRICT`.

Schema overview (full SQL in §3.2 of the diff):

```sql
CREATE SCHEMA IF NOT EXISTS media;

CREATE TABLE media.assets (
  id                TEXT PRIMARY KEY,
  api_key_id        UUID NOT NULL REFERENCES auth.api_keys(id) ON DELETE RESTRICT,
  status            TEXT NOT NULL,                  -- preparing | queued | ready | errored | deleted
  source_type       TEXT NOT NULL,                  -- upload | live_recording | imported
  selected_offering TEXT,
  source_url        TEXT,
  duration_sec      NUMERIC(12,3),
  width             INTEGER,
  height            INTEGER,
  frame_rate        NUMERIC(6,3),
  audio_codec       TEXT,
  video_codec       TEXT,
  encoding_tier     TEXT NOT NULL DEFAULT 'standard',  -- baseline | standard | premium
  ffprobe_json      JSONB,
  error_message     TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ready_at          TIMESTAMPTZ,
  deleted_at        TIMESTAMPTZ
);
CREATE INDEX assets_api_key_created ON media.assets (api_key_id, created_at DESC);
CREATE INDEX assets_not_deleted     ON media.assets (deleted_at);

CREATE TABLE media.uploads (...);          -- api_key_id, asset_id FK, tus state
CREATE TABLE media.renditions (...);       -- asset_id FK, resolution + codec unique
CREATE TABLE media.encoding_jobs (...);    -- asset_id + rendition_id FKs, status, attempt_count
CREATE TABLE media.live_streams (...);     -- api_key_id, stream_key_hash, session_id, worker_*
CREATE TABLE media.playback_ids (...);     -- api_key_id, asset_id OR live_stream_id (XOR check)
```

`api_key_id` references `auth.api_keys(id) ON DELETE RESTRICT` (not
`CASCADE`) so deleting an active API key doesn't cascade-delete the
user's assets. Key rotation goes through `revoked_at`, not delete.

### 3.2 Engine types — `transcode-gateway/src/engine/types/`

Port verbatim except:

| Source file | Action | Notes |
|---|---|---|
| `caller.ts` | port w/ edits | Drop `CostQuote`, `UsageReport`, `ReservationHandle`. Keep `Caller`, `Capability`, `Codec`, `Resolution`, `RenditionSpec`, `EncodingTier`. |
| `asset.ts` | port w/ rename | `Asset.projectId` → `Asset.apiKeyId` |
| `upload.ts` | port w/ rename | `Upload.projectId` → `Upload.apiKeyId` |
| `liveStream.ts` | port w/ edits | `LiveStream.projectId` → `LiveStream.apiKeyId`. Drop `recordingEnabled`, `recordingAssetId`, `recording_processing`/`recording_ready` statuses. |
| `playbackId.ts` | port w/ rename | `PlaybackId.projectId` → `PlaybackId.apiKeyId` |
| `job.ts` | port verbatim | `EncodingJob` + `JobKind` + `JobStatus` |
| `worker.ts` | port verbatim | `SelectedWorkerRoute`, `WorkerInventoryEntry` |
| `error.ts` | port w/ edits | Drop `WalletReserveFailed` and `PaymentRequired` codes |
| `webhook.ts` | **drop** | No webhooks in v0 |
| `index.ts` | port w/ edits | Drop `export * from "./webhook.js"` |

### 3.3 Engine interfaces — `transcode-gateway/src/engine/interfaces/`

| Source file | Action |
|---|---|
| `workerClient.ts` | port verbatim |
| `workerResolver.ts` | port verbatim |
| `storageProvider.ts` | port verbatim (drop `"liveSegment"` / `"liveManifest"` kinds? — keep, harmless until 0006) |
| `logger.ts` | port verbatim |
| `streamKeyHasher.ts` | port verbatim (used by live in 0006) |
| `wallet.ts` | **drop** |
| `webhookSink.ts` | **drop** |
| `eventBus.ts` | **drop** |
| `rateLimiter.ts` | **drop** (auth layer has its own) |
| `authResolver.ts` | **drop** (auth layer has its own) |
| `index.ts` | port w/ edits | Drop dropped re-exports |

### 3.4 Engine repo contracts — `transcode-gateway/src/engine/repo/`

Interfaces port verbatim with the `projectId → apiKeyId` rename
applied to `ListAssetsOpts`:

| Source file | Action |
|---|---|
| `assetRepo.ts` | port w/ rename (`ListAssetsOpts.projectId` → `apiKeyId`) |
| `uploadRepo.ts` | port verbatim |
| `liveStreamRepo.ts` | port verbatim |
| `playbackIdRepo.ts` | port verbatim |
| `jobRepo.ts` | port verbatim (includes `RenditionRepo` interface alongside `EncodingJobRepo`, matching source) |
| `index.ts` | port verbatim |

### 3.5 Engine service — `transcode-gateway/src/engine/service/`

| Source file | Action |
|---|---|
| `encodingPlanner.ts` | port verbatim |
| `manifestBuilder.ts` | port verbatim |
| `playbackUrlBuilder.ts` | port verbatim |
| `jobOrchestrator.ts` | port w/ heavy edits (see below) |
| `costQuoter.ts` | **drop** |
| `webhookSigner.ts` | **drop** |
| `index.ts` | port w/ edits |

**`jobOrchestrator.ts` edits** (the heaviest rewrite; expected to land
well under 300 lines after the cuts):

- Drop `Wallet` from `OrchestratorDeps`; drop `wallet.reserve(…)`,
  `wallet.commit(…)`, `wallet.refund(…)` calls; drop the
  `RESERVATION_HANDLES` map; drop `safeRefund(…)`.
- Drop `EventBus` from `OrchestratorDeps`; drop `eventBus.emit(…)`
  calls. The logger calls remain for visibility.
- Drop `pricing: PricingConfig` from `OrchestratorDeps`; drop
  `estimateCost(…)` and `reportUsage(…)` imports.
- Drop `WalletReserveFailed` error path.
- Replace `Math.random()`-based `makeId()` with
  `crypto.randomBytes(8).toString("hex")`.
- Rename `callerId` (was customer-portal customer id) to
  `apiKeyId` throughout.
- Keep the rest: probe → expand tier → insert rendition rows + jobs →
  concurrent encode workers (cap 4) → finalize (build manifest, write
  to storage, mark asset ready).

If the resulting file still exceeds 300 lines, split into:
- `orchestrator/index.ts` — `probeAndSchedule` (public entry)
- `orchestrator/probe.ts` — probe phase
- `orchestrator/encode.ts` — encode phase (`runEncodePhase`, `runOneJob`)
- `orchestrator/finalize.ts` — finalize phase

### 3.6 Engine config — `transcode-gateway/src/engine/config/`

| Source file | Action |
|---|---|
| `encodingLadder.ts` | port verbatim |
| `pricing.ts` | **drop** |

### 3.7 Engine dispatch — `transcode-gateway/src/engine/dispatch/`

Source has `dispatch/types.ts` (`DispatchCommon` type, references
dropped interfaces) and `dispatch/index.ts` (re-exports).

**Drop entirely for v0.** `DispatchCommon` referenced wallet,
webhookSink, eventBus, rateLimiter, pricing — all gone. The routes
in plan 0005 will compose `OrchestratorDeps` directly, no central
`DispatchCommon`.

### 3.8 Drizzle schema extension — `transcode-gateway/src/db/schema.ts`

Append `media.*` tables to the existing `auth.*` declarations. Same
file. Adds `assets`, `uploads`, `renditions`, `encodingJobs`,
`liveStreams`, `playbackIds`. Pure type derivation; no migration
logic (raw SQL still owns the schema).

### 3.9 Concrete repo implementations — `transcode-gateway/src/repo/`

Drizzle-backed concrete implementations of the engine repo
interfaces. New files (not ported from source — source uses
project-coupled repos):

- `src/repo/assets.ts` — `createAssetRepo(pool) → AssetRepo`
- `src/repo/uploads.ts` — `createUploadRepo(pool) → UploadRepo`
- `src/repo/encodingJobs.ts` — `createEncodingJobRepo(pool) → EncodingJobRepo`
- `src/repo/renditions.ts` — `createRenditionRepo(pool) → RenditionRepo`
- `src/repo/liveStreams.ts` — `createLiveStreamRepo(pool) → LiveStreamRepo`
- `src/repo/playbackIds.ts` — `createPlaybackIdRepo(pool) → PlaybackIdRepo`

Each is a factory returning an object that satisfies the engine
interface. Implementation uses drizzle for typed queries against
`media.*`. Each file ≤ 200 lines.

### 3.10 Stub worker client + resolver — `transcode-gateway/src/livepeer/`

New directory created here (more lands in 0004). For 0003:

- `src/livepeer/stubWorkerClient.ts` — implements `WorkerClient` by
  throwing `VideoCoreError("NotImplemented", "worker client not yet
  wired — see plan 0004")` on every call.
- `src/livepeer/stubWorkerResolver.ts` — implements `WorkerResolver`
  by returning `null` (which the engine handles gracefully as "no
  workers available").
- `src/livepeer/index.ts` — re-exports.

These let the gateway boot with the engine module loaded. Plan 0004
replaces them with real implementations.

### 3.11 No new routes

Plan 0003 ships engine code only. The auth routes from plan 0002
continue to work; no VOD or live routes land yet. The gateway boots
and runs both auth + media migrations; the new media tables are
empty.

### 3.12 Unit tests — `transcode-gateway/test/`

This component didn't ship tests in plan 0002 (acceptance was an
end-to-end smoke). Plan 0003 ships first-round unit tests for the
pure functions, since they're easy to test in isolation:

- `test/engine/encodingPlanner.test.ts` — `planJobs` produces the
  expected job set for each tier
- `test/engine/manifestBuilder.test.ts` — `buildMasterManifest`
  produces valid HLS master playlist (smoke-check the directives)
- `test/engine/playbackUrlBuilder.test.ts` — public vs signed URL
  shape

Test runner: `node --test ./dist-test/test/**/*.test.js` via the
`pnpm test` script already in `package.json`.

## 4. Acceptance

Plan is **complete** when:

1. `pnpm install` (root) resolves cleanly.
2. `pnpm -F @livepeer-modules-transcode/transcode-gateway lint` passes.
3. `pnpm -F @livepeer-modules-transcode/transcode-gateway test` passes
   (unit tests above).
4. Booting the gateway against an empty Postgres runs **both**
   migrations (`0001_auth_init.sql` + `0002_media_init.sql`) cleanly.
5. The `auth.*` + `media.*` tables exist; `psql … -c "\dt auth.* media.*"`
   shows the expected 4 + 6 tables.
6. The auth smoke from plan 0002 still passes end-to-end (no
   regression).
7. Every TS file ≤ 300 lines.
8. `PLANS.md` roadmap row for phase 2 (engine) flips to ✅.
9. This plan moves to `docs/exec-plans/completed/`.

## 5. Out of scope

- VOD routes (`/v1/uploads`, `/v1/vod/*`, `/v1/playback/:id`) — plan 0005.
- Live routes + RTMP listener — plan 0006.
- Real `WorkerClient` + `WorkerResolver` (talking to broker over
  resolver socket + payment-daemon) — plan 0004.
- S3-compat `StorageProvider` implementation — plan 0005 (lands when
  VOD upload route needs it; not until then). The interface is
  declared here; concrete impl is deferred.
- ABR ladder customization per-customer — deferred to phase 2.
- Recording handoff, webhooks, billing — explicitly out of v0.

## 6. Decision log

| Date | Decision | Why |
|---|---|---|
| 2026-05-18 | Drop `EventBus` entirely (not "noop sink") | No webhooks → no event consumers in v0; logger gives us visibility |
| 2026-05-18 | Drop `dispatch/types.ts` (`DispatchCommon`) | It referenced wallet/webhookSink/eventBus/pricing — all gone. Routes in 0005 compose `OrchestratorDeps` directly |
| 2026-05-18 | Drop `rateLimiter.ts` + `authResolver.ts` interfaces from engine | We have our own in `src/auth/` (plan 0002); engine doesn't need to abstract over them |
| 2026-05-18 | Keep `streamKeyHasher.ts` interface even though no usage in 0003 | Used by live RTMP in 0006; the interface is tiny (4 lines) and avoids a cross-plan churn |
| 2026-05-18 | `media.assets.api_key_id` references `auth.api_keys(id) ON DELETE RESTRICT` (not CASCADE) | Key rotation flips `revoked_at`, never deletes; cascading delete would erase user content on rotation |
| 2026-05-18 | Stub `WorkerClient`/`Resolver` rather than skip wire entirely | Lets gateway boot with engine loaded; routes in 0005 can build against the interface without waiting for 0004 |
| 2026-05-18 | Land `media.live_streams` + `media.playback_ids` schema in 0003 even though live routes are 0006 | Schema lives with the engine repos that touch it; deferring would force a second migration for one component |
| 2026-05-18 | Single PR (engine + migration + stubs + unit tests) | Per [core-beliefs §13](../../design-docs/core-beliefs.md) throughput-friendly; coherent unit |
| 2026-05-18 | First-round unit tests added (planner, manifest builder, playback URL) | Pure functions; cheap to test; sets the testing pattern for future ports |
