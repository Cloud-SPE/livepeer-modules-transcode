-- 0002_media_init.sql
-- Media schema (VOD + live) for livepeer-modules-transcode.
--
-- Shape modeled on
-- livepeer-network-modules/video-gateway/migrations/0000_video_init.sql
-- with these cuts (per docs/design-docs/core-beliefs.md §5–§8):
--   * No media.projects        — assets scope by api_key_id
--   * No media.pricing         — no pricing in v0
--   * No media.live_session_debits — no billing
--   * No media.recordings      — no live→VOD handoff in v0
--   * No media.webhook_*       — no webhooks in v0
--   * No recording_enabled / recording_asset_id on live_streams
-- And these column renames:
--   * project_id  → api_key_id (UUID, REFERENCES auth.api_keys(id) RESTRICT)
-- See docs/exec-plans/active/0003-engine-port.md §3.1.

CREATE SCHEMA IF NOT EXISTS media;

CREATE TABLE media.assets (
  id                TEXT PRIMARY KEY,
  api_key_id        UUID NOT NULL REFERENCES auth.api_keys(id) ON DELETE RESTRICT,
  status            TEXT NOT NULL,                                    -- preparing | queued | ready | errored | deleted
  source_type       TEXT NOT NULL,                                    -- upload | live_recording | imported
  selected_offering TEXT,
  source_url        TEXT,
  duration_sec      NUMERIC(12,3),
  width             INTEGER,
  height            INTEGER,
  frame_rate        NUMERIC(6,3),
  audio_codec       TEXT,
  video_codec       TEXT,
  encoding_tier     TEXT NOT NULL DEFAULT 'standard',                 -- baseline | standard | premium
  ffprobe_json      JSONB,
  error_message     TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ready_at          TIMESTAMPTZ,
  deleted_at        TIMESTAMPTZ
);
CREATE INDEX assets_api_key_created ON media.assets (api_key_id, created_at DESC);
CREATE INDEX assets_not_deleted     ON media.assets (deleted_at);

CREATE TABLE media.uploads (
  id            TEXT PRIMARY KEY,
  api_key_id    UUID NOT NULL REFERENCES auth.api_keys(id) ON DELETE RESTRICT,
  asset_id      TEXT REFERENCES media.assets(id) ON DELETE CASCADE,
  status        TEXT NOT NULL,                                        -- waiting | uploading | completed | expired
  upload_url    TEXT NOT NULL,
  storage_key   TEXT NOT NULL,
  expires_at    TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at  TIMESTAMPTZ
);
CREATE INDEX uploads_expires ON media.uploads (expires_at) WHERE status IN ('waiting', 'uploading');

CREATE TABLE media.renditions (
  id           TEXT PRIMARY KEY,
  asset_id     TEXT NOT NULL REFERENCES media.assets(id) ON DELETE CASCADE,
  resolution   TEXT NOT NULL,                                         -- 240p | 360p | 480p | 720p | 1080p | 2160p
  codec        TEXT NOT NULL,                                         -- h264 | hevc | av1
  bitrate_kbps INTEGER NOT NULL,
  storage_key  TEXT,
  status       TEXT NOT NULL,                                         -- queued | running | completed | failed
  duration_sec NUMERIC(12,3),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  CONSTRAINT renditions_asset_resolution_codec UNIQUE (asset_id, resolution, codec)
);

CREATE TABLE media.encoding_jobs (
  id             TEXT PRIMARY KEY,
  asset_id       TEXT NOT NULL REFERENCES media.assets(id) ON DELETE CASCADE,
  rendition_id   TEXT REFERENCES media.renditions(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL,                                       -- probe | encode | package | thumbnail | finalize
  status         TEXT NOT NULL,                                       -- queued | running | completed | failed
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
CREATE INDEX encoding_jobs_asset          ON media.encoding_jobs (asset_id);

CREATE TABLE media.live_streams (
  id                                 TEXT PRIMARY KEY,
  api_key_id                         UUID NOT NULL REFERENCES auth.api_keys(id) ON DELETE RESTRICT,
  name                               TEXT,
  stream_key_hash                    TEXT NOT NULL UNIQUE,
  status                             TEXT NOT NULL,                   -- idle | active | reconnecting | ended | errored
  ingest_protocol                    TEXT NOT NULL DEFAULT 'rtmp',
  session_id                         TEXT,
  worker_id                          TEXT,
  worker_url                         TEXT,
  selected_capability                TEXT,
  selected_offering                  TEXT,
  selected_work_unit                 TEXT,
  selected_price_per_work_unit_wei   TEXT,
  last_seen_at                       TIMESTAMPTZ,
  created_at                         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at                           TIMESTAMPTZ
);
CREATE INDEX live_streams_api_key ON media.live_streams (api_key_id, created_at DESC);
CREATE INDEX live_streams_active  ON media.live_streams (status) WHERE status IN ('active', 'reconnecting');

CREATE TABLE media.playback_ids (
  id              TEXT PRIMARY KEY,
  api_key_id      UUID NOT NULL REFERENCES auth.api_keys(id) ON DELETE RESTRICT,
  asset_id        TEXT REFERENCES media.assets(id) ON DELETE CASCADE,
  live_stream_id  TEXT REFERENCES media.live_streams(id) ON DELETE CASCADE,
  policy          TEXT NOT NULL,                                      -- public | signed
  token_required  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT playback_ids_one_target CHECK ((asset_id IS NOT NULL) <> (live_stream_id IS NOT NULL))
);
CREATE INDEX playback_ids_asset       ON media.playback_ids (asset_id);
CREATE INDEX playback_ids_live_stream ON media.playback_ids (live_stream_id);
