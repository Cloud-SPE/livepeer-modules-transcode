-- 0004_paid_session_recovery.sql
-- Multi-instance recovery lease and durable public live relay/control cursor.

ALTER TABLE media.paid_operations
  ADD COLUMN lifecycle_version BIGINT NOT NULL DEFAULT 0
    CHECK (lifecycle_version >= 0),
  ADD COLUMN recovery_owner TEXT,
  ADD COLUMN recovery_lease_expires_at TIMESTAMPTZ,
  ADD COLUMN session_runtime JSONB;

ALTER TABLE media.paid_operations
  ADD CONSTRAINT paid_operations_recovery_lease_complete CHECK (
    (recovery_owner IS NULL) = (recovery_lease_expires_at IS NULL)
  ),
  ADD CONSTRAINT paid_operations_session_runtime_kind CHECK (
    session_runtime IS NULL OR
    (operation_kind = 'session' AND jsonb_typeof(session_runtime) = 'object')
  );

CREATE INDEX paid_operations_recovery_claim
  ON media.paid_operations (recovery_lease_expires_at, next_retry_at, updated_at)
  WHERE terminal_at IS NULL;

COMMENT ON COLUMN media.paid_operations.session_runtime IS
  'Non-secret paid-session relay, control cursor, and runner usage snapshot; credentials remain in paid_operation_secrets';
COMMENT ON COLUMN media.paid_operations.recovery_owner IS
  'Gateway instance holding the renewable recovery lease; mutations from stale owners are rejected by lifecycle_version';
