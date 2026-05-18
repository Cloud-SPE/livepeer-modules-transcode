import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { DbPool } from "./pool.js";

export async function runMigrations(pool: DbPool, dir: string): Promise<string[]> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      filename    TEXT PRIMARY KEY,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const entries = await readdir(dir);
  const sqlFiles = entries.filter((f) => f.endsWith(".sql")).sort();

  const appliedRows = await pool.query<{ filename: string }>(`SELECT filename FROM _migrations`);
  const applied = new Set(appliedRows.rows.map((r) => r.filename));

  const newlyApplied: string[] = [];

  for (const file of sqlFiles) {
    if (applied.has(file)) continue;
    const sql = await readFile(path.join(dir, file), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query(`INSERT INTO _migrations (filename) VALUES ($1)`, [file]);
      await client.query("COMMIT");
      newlyApplied.push(file);
    } catch (err) {
      await client.query("ROLLBACK");
      throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
    } finally {
      client.release();
    }
  }

  return newlyApplied;
}
