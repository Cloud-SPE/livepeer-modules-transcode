# Transcode pipeline (VOD)

How a VOD batch transcode job moves from "customer holds an MP4" to
"customer can play back HLS." Live is covered in
[live-pipeline.md](./live-pipeline.md).

## Surface

```
POST   /v1/uploads                   tus create
PATCH  /v1/uploads/:id               tus body
POST   /v1/vod/submit                begin transcode
GET    /v1/vod/:asset_id             poll asset + jobs
GET    /v1/videos/assets             list (scoped by api_key_id)
GET    /v1/videos/assets/:id         inspect
DELETE /v1/videos/assets/:id         soft-delete (sets deleted_at)
GET    /v1/playback/:id              resolve playback URL
```

All routes are gated by the customer API key (see
[auth-model.md](./auth-model.md)).

## State machine

```
media.assets.status:
  pending  → uploaded  → encoding  → ready
                                  ↘ failed
                                  (soft-deleted → deleted_at IS NOT NULL)

media.uploads.status:
  pending  → in_progress  → completed
                          ↘ expired

media.encoding_jobs.status:
  queued   → dispatched   → running   → completed
                                      ↘ failed
                                      ↘ retrying

media.renditions.status:
  pending  → completed
          ↘ failed
```

## Steps

### 1. Upload (tus)

- `POST /v1/uploads` writes `media.uploads` (pending) with the storage
  key prefix and an expiry, returns the tus URL.
- tus PATCH writes bytes to the configured S3-compat backend through
  `engine/interfaces/storageProvider.ts`. Bytes never touch the gateway
  process; the gateway just hands tus a presigned target.
- When tus signals upload-complete, the upload row flips to
  `completed`, and the linked `media.assets` row is created (status
  `uploaded`).

### 2. Plan

`engine/service/encodingPlanner.ts` reads the asset's probed properties
(via `ffprobe_json` populated during upload finalization) and emits a
list of target renditions. The planner consults
`engine/config/encodingLadder.ts` for the static ABR ladder.

There is **no per-customer tier** in v0 — every asset gets the same
ladder. (The source repo's `customer-tier` policy is deferred to
phase 2 alongside pricing.)

### 3. Dispatch

For each planned rendition:

1. Insert a `media.encoding_jobs` row (status `queued`).
2. Call `engine/service/jobOrchestrator.ts` to:
   - Resolve a broker candidate via
     `livepeer/routeSelector.ts` (resolver socket + per-broker route
     health).
   - Mint a payment header via `livepeer/payment.ts` →
     `livepeer/payerDaemonClient.ts`.
   - Dispatch through `engine/dispatch/` using the appropriate mode:
     - `http-reqresp@v0` for `transcode-runner` (single-rendition,
       request-response).
     - `http-stream@v0` for `abr-runner` (multi-rendition with progress
       stream).
3. Update job status (`dispatched` → `running`); record
   `media.renditions` rows.

### 4. Settlement

- On rendition completion, runner returns storage key(s) for the
  encoded output; gateway updates `media.renditions.storage_key` and
  flips status to `completed`.
- When **all** planned renditions complete, the gateway calls
  `engine/service/manifestBuilder.ts` to produce the HLS master
  playlist + media playlists, writes them to storage, and flips the
  asset to `ready`.

### 5. Playback

`GET /v1/playback/:id` resolves a playback row to either:

- a VOD asset → returns the HLS manifest URL minted by
  `engine/service/playbackUrlBuilder.ts`, optionally signed if the
  playback policy requires it; or
- a live stream → returns the LL-HLS strict-proxy URL at
  `/_hls/<sessionId>/…` (see [live-pipeline.md](./live-pipeline.md)).

## Data model

The relevant `media.*` tables (subset of the source schema; multi-tenant
`projects` is removed):

```sql
CREATE SCHEMA media;

CREATE TABLE media.assets (
  id                TEXT PRIMARY KEY,
  api_key_id        TEXT NOT NULL,             -- replaces project_id
  status            TEXT NOT NULL,
  source_type       TEXT NOT NULL,
  selected_offering TEXT,
  source_url        TEXT,
  duration_sec      NUMERIC(12,3),
  width             INTEGER,
  height            INTEGER,
  frame_rate        NUMERIC(6,3),
  audio_codec       TEXT,
  video_codec       TEXT,
  encoding_tier     TEXT NOT NULL,
  ffprobe_json      JSONB,
  error_message     TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ready_at          TIMESTAMPTZ,
  deleted_at        TIMESTAMPTZ
);
CREATE INDEX assets_api_key_created ON media.assets (api_key_id, created_at);
CREATE INDEX assets_not_deleted     ON media.assets (deleted_at);

CREATE TABLE media.uploads (
  id            TEXT PRIMARY KEY,
  api_key_id    TEXT NOT NULL,
  asset_id      TEXT REFERENCES media.assets(id) ON DELETE CASCADE,
  status        TEXT NOT NULL,
  upload_url    TEXT NOT NULL,
  storage_key   TEXT NOT NULL,
  expires_at    TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at  TIMESTAMPTZ
);

CREATE TABLE media.renditions (
  id           TEXT PRIMARY KEY,
  asset_id     TEXT NOT NULL REFERENCES media.assets(id) ON DELETE CASCADE,
  resolution   TEXT NOT NULL,
  codec        TEXT NOT NULL,
  bitrate_kbps INTEGER NOT NULL,
  storage_key  TEXT,
  status       TEXT NOT NULL,
  duration_sec NUMERIC(12,3),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  CONSTRAINT renditions_asset_resolution_codec UNIQUE (asset_id, resolution, codec)
);

CREATE TABLE media.encoding_jobs (
  id             TEXT PRIMARY KEY,
  asset_id       TEXT NOT NULL REFERENCES media.assets(id) ON DELETE CASCADE,
  rendition_id   TEXT REFERENCES media.renditions(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL,
  status         TEXT NOT NULL,
  worker_url     TEXT,
  attempt_count  INTEGER NOT NULL DEFAULT 0,
  input_url      TEXT,
  output_prefix  TEXT,
  error_message  TEXT,
  started_at     TIMESTAMPTZ,
  completed_at   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX encoding_jobs_status_created ON media.encoding_jobs (status, created_at);
```

The `media.playback_ids` table (also from the source schema) holds the
playback-id → asset or live-stream mapping; see
[live-pipeline.md](./live-pipeline.md) for its constraint.

## What's NOT in v0

- `media.projects` (dropped — `api_key_id` replaces `project_id`)
- `media.pricing` (dropped — no pricing in v0)
- `media.live_session_debits` (dropped — no billing)
- `media.recordings` (dropped — no live→VOD)
- `media.webhook_endpoints` + `media.webhook_failures` (dropped — no webhooks)
- `engine/service/costQuoter.ts` (dropped)
- `engine/service/webhookSigner.ts` (dropped)
- `service/recordingHandoff.ts` (dropped)
- `service/usageLedger.ts` (dropped)
- `service/webhookDispatcher.ts` (dropped)

## Cross-cutting

- **Storage**: `engine/interfaces/storageProvider.ts` — concrete impl is
  S3-compat (AWS S3 / RustFS / R2). No local disk fallback.
- **Worker resolution**:
  `engine/interfaces/workerResolver.ts` + `livepeer/routeSelector.ts` —
  resolver-only (see [core-beliefs.md](./core-beliefs.md) §2).
- **Logger**: `engine/interfaces/logger.ts` — structured logs only;
  no `console.log`.

## Provenance

Ported (planned) from
`livepeer-network-modules/video-gateway/src/engine/` per
[`../exec-plans/active/0001-initial-port-roadmap.md`](../exec-plans/active/0001-initial-port-roadmap.md)
phase 4 (routes) and phase 2 (engine). Specific source files are cited
in commit messages when each port lands.
