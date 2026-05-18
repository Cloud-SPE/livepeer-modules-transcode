import type { DbPool } from "../db/pool.js";
import { generateSessionToken, sha256Hex } from "./crypto.js";

// Modeled on blue-claw-network/web-platform/backend/src/routes/user.rs::lookup_session.

export interface SessionLookup {
  apiKeyId: string;
  userId: string;
}

export async function createSession(
  pool: DbPool,
  apiKeyId: string,
  ttlHours: number,
): Promise<{ rawToken: string; expiresAt: Date }> {
  const rawToken = generateSessionToken();
  const sessionHash = sha256Hex(rawToken);
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);

  await pool.query(
    `INSERT INTO auth.sessions (api_key_id, session_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [apiKeyId, sessionHash, expiresAt],
  );

  return { rawToken, expiresAt };
}

// Single UPDATE … RETURNING that bumps expires_at on hit so an actively-used
// session doesn't expire at the original mark. Mirrors Blueclaw's "bumped" CTE.
export async function lookupSession(
  pool: DbPool,
  rawToken: string,
  ttlHours: number,
): Promise<SessionLookup | null> {
  const sessionHash = sha256Hex(rawToken);

  const result = await pool.query<{ api_key_id: string; user_id: string }>(
    `WITH bumped AS (
       UPDATE auth.sessions
       SET expires_at = NOW() + ($2 || ' hours')::interval
       WHERE session_hash = $1
         AND revoked_at IS NULL
         AND expires_at > NOW()
       RETURNING api_key_id
     )
     SELECT b.api_key_id, k.user_id
     FROM bumped b
     JOIN auth.api_keys k ON k.id = b.api_key_id
     WHERE k.revoked_at IS NULL`,
    [sessionHash, String(ttlHours)],
  );

  if (result.rowCount === 0) return null;
  const row = result.rows[0]!;
  return { apiKeyId: row.api_key_id, userId: row.user_id };
}

export async function revokeSession(pool: DbPool, rawToken: string): Promise<void> {
  const sessionHash = sha256Hex(rawToken);
  await pool.query(
    `UPDATE auth.sessions SET revoked_at = NOW()
     WHERE session_hash = $1 AND revoked_at IS NULL`,
    [sessionHash],
  );
}

export async function revokeAllSessionsForApiKey(
  pool: DbPool,
  apiKeyId: string,
): Promise<void> {
  await pool.query(
    `UPDATE auth.sessions SET revoked_at = NOW()
     WHERE api_key_id = $1 AND revoked_at IS NULL`,
    [apiKeyId],
  );
}
