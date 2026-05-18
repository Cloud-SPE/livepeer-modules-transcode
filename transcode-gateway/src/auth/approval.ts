import type { DbPool } from "../db/pool.js";
import { createApiKey } from "./apiKeys.js";

// Admin approval transactions + the profile lookup used by login/profile
// routes. Modeled on
// blue-claw-network/web-platform/backend/src/routes/waitlist.rs::admin_approve
// + user.rs::user_profile.

export interface ApprovedRow {
  waitlistId: string;
  userId: string;
  apiKeyId: string;
  name: string;
  email: string;
  rawKey: string;
  keyPrefix: string;
}

export interface ApproveBatchResult {
  approved: ApprovedRow[];
  skipped: Array<{ id: string; reason: string }>;
}

// Per-id atomic transaction. Two concurrent approvals on the same id no
// longer both pass a stale read of status='pending' — the second to commit
// sees zero rows and skips.
export async function approveBatch(
  pool: DbPool,
  ids: string[],
  pepper: string | undefined,
): Promise<ApproveBatchResult> {
  const approved: ApprovedRow[] = [];
  const skipped: Array<{ id: string; reason: string }> = [];

  for (const id of ids) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const entryRes = await client.query<{
        id: string;
        name: string;
        email: string;
        email_verified: boolean;
      }>(
        `UPDATE auth.waitlist
         SET status = 'approved', approved_at = NOW()
         WHERE id = $1 AND status = 'pending'
         RETURNING id, name, email, email_verified`,
        [id],
      );

      if (entryRes.rowCount === 0) {
        await client.query("ROLLBACK");
        skipped.push({ id, reason: "not_pending" });
        continue;
      }
      const entry = entryRes.rows[0]!;

      if (!entry.email_verified) {
        await client.query("ROLLBACK");
        skipped.push({ id, reason: "email_not_verified" });
        continue;
      }

      const userRes = await client.query<{ id: string }>(
        `INSERT INTO auth.users (waitlist_id, email)
         VALUES ($1, $2)
         ON CONFLICT (waitlist_id) DO UPDATE SET updated_at = NOW()
         RETURNING id`,
        [entry.id, entry.email],
      );
      const userId = userRes.rows[0]!.id;

      const apiKey = await createApiKey(client, userId, pepper);

      await client.query("COMMIT");

      approved.push({
        waitlistId: entry.id,
        userId,
        apiKeyId: apiKey.id,
        name: entry.name,
        email: entry.email,
        rawKey: apiKey.rawKey,
        keyPrefix: apiKey.prefix,
      });
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      skipped.push({ id, reason: (err as Error).message });
    } finally {
      client.release();
    }
  }

  return { approved, skipped };
}

export async function rejectBatch(pool: DbPool, ids: string[]): Promise<{ rejected: number }> {
  if (ids.length === 0) return { rejected: 0 };
  const result = await pool.query(
    `UPDATE auth.waitlist SET status = 'rejected', rejected_at = NOW()
     WHERE id = ANY($1) AND status = 'pending'`,
    [ids],
  );
  return { rejected: result.rowCount ?? 0 };
}

export async function deleteOne(pool: DbPool, id: string): Promise<boolean> {
  const result = await pool.query(`DELETE FROM auth.waitlist WHERE id = $1`, [id]);
  return (result.rowCount ?? 0) > 0;
}

export interface ProfileRow {
  name: string;
  email: string;
  keyPrefix: string;
  keyCreatedAt: Date;
  accountStatus: string;
  memberSince: Date;
}

export async function profileByApiKeyId(
  pool: DbPool,
  apiKeyId: string,
): Promise<ProfileRow | null> {
  const result = await pool.query<{
    name: string;
    email: string;
    key_prefix: string;
    key_created_at: Date;
    status: string;
    member_since: Date;
  }>(
    `SELECT w.name,
            w.email,
            k.key_prefix,
            k.created_at AS key_created_at,
            w.status,
            w.created_at AS member_since
     FROM auth.api_keys k
     JOIN auth.users u ON u.id = k.user_id
     JOIN auth.waitlist w ON w.id = u.waitlist_id
     WHERE k.id = $1 AND k.revoked_at IS NULL`,
    [apiKeyId],
  );
  if (result.rowCount === 0) return null;
  const r = result.rows[0]!;
  return {
    name: r.name,
    email: r.email,
    keyPrefix: r.key_prefix,
    keyCreatedAt: r.key_created_at,
    accountStatus: r.status,
    memberSince: r.member_since,
  };
}
