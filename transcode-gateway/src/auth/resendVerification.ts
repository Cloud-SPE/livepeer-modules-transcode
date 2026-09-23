import type { DbPool } from "../db/pool.js";
import { generateVerificationToken, sha256Hex } from "./crypto.js";

// Keep the previous token valid if the provider rejects the replacement email.
// Only pending, unverified signups are eligible; never bypass verification.
export async function resendVerification(
  pool: DbPool,
  id: string,
  ttlHours: number,
  send: (entry: { name: string; email: string }, token: string) => Promise<void>,
): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const token = generateVerificationToken();
    const result = await client.query<{ name: string; email: string }>(
      `UPDATE auth.waitlist SET verification_token = $2, verification_token_expires_at = $3
       WHERE id = $1 AND status = 'pending' AND email_verified = false RETURNING name, email`,
      [id, sha256Hex(token), new Date(Date.now() + ttlHours * 3600_000)],
    );
    if (!result.rows[0]) { await client.query("ROLLBACK"); return false; }
    await send(result.rows[0], token);
    await client.query("COMMIT");
    return true;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}
