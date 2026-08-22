-- 0003_paid_operations_v2.sql
-- Durable correlation and encrypted secret state for Modules v2.
-- Forward-only: the legacy columns remain until the coordinated cutover.

CREATE TABLE media.paid_operations (
  id                              UUID PRIMARY KEY,
  operation_kind                  TEXT NOT NULL CHECK (operation_kind IN ('job', 'session')),
  api_key_id                      UUID NOT NULL REFERENCES auth.api_keys(id) ON DELETE RESTRICT,
  asset_id                        TEXT REFERENCES media.assets(id) ON DELETE CASCADE,
  live_stream_id                  TEXT REFERENCES media.live_streams(id) ON DELETE CASCADE,

  request_id                      TEXT NOT NULL UNIQUE,
  request_content_sha256          TEXT NOT NULL CHECK (request_content_sha256 ~ '^[0-9a-f]{64}$'),
  work_id                         TEXT NOT NULL,
  rotation_generation             INTEGER NOT NULL DEFAULT 0 CHECK (rotation_generation >= 0),

  protocol                        TEXT NOT NULL CHECK (protocol IN ('paid-job/v1', 'paid-session/v1')),
  transport                       TEXT,
  capability                      TEXT NOT NULL,
  offering                        TEXT NOT NULL,
  request_descriptor              TEXT NOT NULL,
  response_descriptor             TEXT,
  work_unit                       TEXT NOT NULL,
  estimator                       JSONB,
  price_per_unit_wei              NUMERIC(78,0) NOT NULL CHECK (price_per_unit_wei >= 0),
  units_per_price                 NUMERIC(78,0) NOT NULL CHECK (units_per_price > 0),
  quote_id                        TEXT NOT NULL,
  quote_version                   TEXT NOT NULL,
  constraint_fingerprint          TEXT NOT NULL,
  route_fingerprint               TEXT NOT NULL,
  settlement_key                  TEXT NOT NULL,
  route_snapshot                  JSONB NOT NULL,

  status                          TEXT NOT NULL,
  loc_operation_id                TEXT UNIQUE,
  broker_job_id                   TEXT,
  broker_session_id               TEXT,
  funded_units                    NUMERIC(78,0) NOT NULL DEFAULT 0 CHECK (funded_units >= 0),
  claimed_units                   NUMERIC(78,0) CHECK (claimed_units >= 0),
  balance_units                   NUMERIC(78,0) CHECK (balance_units >= 0),
  will_refuse_next_refill         BOOLEAN,
  lease_expires_at                TIMESTAMPTZ,
  settlement_sequence             NUMERIC(78,0) NOT NULL DEFAULT 0 CHECK (settlement_sequence >= 0),
  retry_count                     INTEGER NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  next_retry_at                   TIMESTAMPTZ,
  last_error_code                 TEXT,
  terminal_evidence               JSONB,
  created_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  terminal_at                     TIMESTAMPTZ,

  CONSTRAINT paid_operations_owner CHECK (
    (operation_kind = 'job' AND asset_id IS NOT NULL AND live_stream_id IS NULL) OR
    (operation_kind = 'session' AND asset_id IS NULL AND live_stream_id IS NOT NULL)
  ),
  CONSTRAINT paid_operations_protocol_kind CHECK (
    (operation_kind = 'job' AND protocol = 'paid-job/v1' AND transport IS NOT NULL) OR
    (operation_kind = 'session' AND protocol = 'paid-session/v1')
  )
);

CREATE INDEX paid_operations_api_key_created
  ON media.paid_operations (api_key_id, created_at DESC);
CREATE INDEX paid_operations_asset
  ON media.paid_operations (asset_id) WHERE asset_id IS NOT NULL;
CREATE INDEX paid_operations_live_stream
  ON media.paid_operations (live_stream_id) WHERE live_stream_id IS NOT NULL;
CREATE INDEX paid_operations_recovery
  ON media.paid_operations (next_retry_at, updated_at)
  WHERE terminal_at IS NULL;
CREATE UNIQUE INDEX paid_operations_broker_job
  ON media.paid_operations (broker_job_id) WHERE broker_job_id IS NOT NULL;
CREATE UNIQUE INDEX paid_operations_broker_session
  ON media.paid_operations (broker_session_id) WHERE broker_session_id IS NOT NULL;

CREATE TABLE media.paid_operation_secrets (
  operation_id                    UUID PRIMARY KEY REFERENCES media.paid_operations(id) ON DELETE CASCADE,
  key_id                          TEXT NOT NULL,
  wrapped_key                     BYTEA NOT NULL,
  wrapped_key_iv                  BYTEA NOT NULL,
  wrapped_key_tag                 BYTEA NOT NULL,
  ciphertext                      BYTEA NOT NULL,
  payload_iv                      BYTEA NOT NULL,
  payload_tag                     BYTEA NOT NULL,
  created_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE media.paid_operation_secrets IS
  'Envelope-encrypted runner credentials, grants, and session_params; no plaintext columns';
