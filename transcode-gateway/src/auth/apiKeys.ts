import type { PoolClient } from "pg";
import type { DbPool } from "../db/pool.js";
import {
  apiKeyHashCandidates,
  generateApiKey,
  hashApiKeyForStorage,
  keyPrefix,
} from "./crypto.js";

// Modeled on blue-claw-network/web-platform/backend/src/routes/{waitlist,user}.rs API-key helpers.

export interface ApiKeyRecord {
  id: string;
  userId: string;
  keyPrefix: string;
  createdAt: Date;
}

type Execer = Pick<PoolClient, "query">;

export async function createApiKey(
  exec: Execer,
  userId: string,
  pepper: string | undefined,
): Promise<{ id: string; rawKey: string; prefix: string }> {
  const rawKey = generateApiKey();
  const hash = hashApiKeyForStorage(rawKey, pepper);
  const prefix = keyPrefix(rawKey);

  const result = await exec.query<{ id: string }>(
    `INSERT INTO auth.api_keys (user_id, key_prefix, key_hash)
     SELECT $1, $2, $3
     WHERE NOT EXISTS (
       SELECT 1 FROM auth.api_keys WHERE user_id = $1 AND revoked_at IS NULL
     )
     RETURNING id`,
    [userId, prefix, hash],
  );

  if (result.rowCount === 0) {
    throw new Error(`User ${userId} already has an active API key`);
  }
  return { id: result.rows[0]!.id, rawKey, prefix };
}

export async function lookupActiveByCandidates(
  pool: DbPool,
  rawKey: string,
  pepper: string | undefined,
): Promise<ApiKeyRecord | null> {
  const candidates = apiKeyHashCandidates(rawKey, pepper);

  const result = await pool.query<{
    id: string;
    user_id: string;
    key_prefix: string;
    created_at: Date;
  }>(
    `SELECT id, user_id, key_prefix, created_at
     FROM auth.api_keys
     WHERE key_hash = ANY($1) AND revoked_at IS NULL`,
    [candidates],
  );

  if (result.rowCount === 0) return null;
  const row = result.rows[0]!;
  return {
    id: row.id,
    userId: row.user_id,
    keyPrefix: row.key_prefix,
    createdAt: row.created_at,
  };
}

export async function revokeApiKey(exec: Execer, apiKeyId: string): Promise<void> {
  await exec.query(
    `UPDATE auth.api_keys SET revoked_at = NOW() WHERE id = $1 AND revoked_at IS NULL`,
    [apiKeyId],
  );
}
