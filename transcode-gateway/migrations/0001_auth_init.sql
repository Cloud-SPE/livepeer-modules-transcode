-- 0001_auth_init.sql
-- Initial auth schema for livepeer-modules-transcode.
--
-- Shape modeled on blue-claw-network/web-platform/backend/migrations/{001_create_waitlist,
-- 002_add_status_and_api_keys, 003_add_email_verification, 004_user_sessions,
-- 006_allow_multiple_api_keys, 019_users, 023_verification_token_expiry,
-- 024_hash_verification_tokens}.sql collapsed into one initial migration (no
-- backwards compat to preserve). See docs/exec-plans/active/0002-auth-blueclaw-port.md
-- §3.2.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE auth.waitlist (
  id                             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                           TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  email                          TEXT NOT NULL UNIQUE,
  ip_hash                        TEXT,
  status                         TEXT NOT NULL DEFAULT 'pending'
                                   CHECK (status IN ('pending', 'approved', 'rejected')),
  email_verified                 BOOLEAN NOT NULL DEFAULT FALSE,
  verification_token             TEXT,
  verification_token_expires_at  TIMESTAMPTZ,
  created_at                     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_at                    TIMESTAMPTZ,
  rejected_at                    TIMESTAMPTZ
);
CREATE INDEX waitlist_status_created ON auth.waitlist (status, created_at DESC);
CREATE UNIQUE INDEX waitlist_verification_token
  ON auth.waitlist (verification_token)
  WHERE verification_token IS NOT NULL;

CREATE TABLE auth.users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  waitlist_id UUID NOT NULL UNIQUE REFERENCES auth.waitlist(id) ON DELETE CASCADE,
  email       TEXT NOT NULL UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE auth.api_keys (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  key_prefix  TEXT NOT NULL,
  key_hash    TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at  TIMESTAMPTZ
);
CREATE INDEX api_keys_hash               ON auth.api_keys (key_hash);
CREATE INDEX api_keys_user               ON auth.api_keys (user_id);
CREATE UNIQUE INDEX api_keys_active_user ON auth.api_keys (user_id) WHERE revoked_at IS NULL;

CREATE TABLE auth.sessions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  api_key_id   UUID NOT NULL REFERENCES auth.api_keys(id) ON DELETE CASCADE,
  session_hash TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at   TIMESTAMPTZ NOT NULL,
  revoked_at   TIMESTAMPTZ
);
CREATE INDEX sessions_hash_active ON auth.sessions (session_hash) WHERE revoked_at IS NULL;
