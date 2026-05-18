import type { DbPool } from "../db/pool.js";
import type { Upload, UploadStatus } from "../engine/types/index.js";
import type { UploadRepo } from "../engine/repo/index.js";

interface Row {
  id: string;
  api_key_id: string;
  asset_id: string | null;
  status: string;
  upload_url: string;
  storage_key: string;
  expires_at: Date;
  created_at: Date;
  completed_at: Date | null;
}

function rowToUpload(r: Row): Upload {
  return {
    id: r.id,
    apiKeyId: r.api_key_id,
    assetId: r.asset_id ?? undefined,
    status: r.status as Upload["status"],
    uploadUrl: r.upload_url,
    storageKey: r.storage_key,
    expiresAt: r.expires_at,
    createdAt: r.created_at,
    completedAt: r.completed_at ?? undefined,
  };
}

const SELECT_COLS = `id, api_key_id, asset_id, status, upload_url, storage_key,
  expires_at, created_at, completed_at`;

export function createUploadRepo(pool: DbPool): UploadRepo {
  return {
    async insert(upload) {
      const result = await pool.query<Row>(
        `INSERT INTO media.uploads (id, api_key_id, asset_id, status, upload_url, storage_key, expires_at, completed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING ${SELECT_COLS}`,
        [
          upload.id,
          upload.apiKeyId,
          upload.assetId ?? null,
          upload.status,
          upload.uploadUrl,
          upload.storageKey,
          upload.expiresAt,
          upload.completedAt ?? null,
        ],
      );
      return rowToUpload(result.rows[0]!);
    },

    async byId(id) {
      const result = await pool.query<Row>(
        `SELECT ${SELECT_COLS} FROM media.uploads WHERE id = $1`,
        [id],
      );
      return result.rowCount === 0 ? null : rowToUpload(result.rows[0]!);
    },

    async updateStatus(id, status: UploadStatus, fields) {
      const setExprs = ["status = $2"];
      const params: unknown[] = [id, status];
      if (fields?.assetId !== undefined) {
        params.push(fields.assetId);
        setExprs.push(`asset_id = $${params.length}`);
      }
      if (fields?.completedAt !== undefined) {
        params.push(fields.completedAt);
        setExprs.push(`completed_at = $${params.length}`);
      }
      await pool.query(
        `UPDATE media.uploads SET ${setExprs.join(", ")} WHERE id = $1`,
        params,
      );
    },

    async sweepExpired(now) {
      const result = await pool.query<Row>(
        `UPDATE media.uploads SET status = 'expired'
         WHERE expires_at < $1 AND status IN ('waiting', 'uploading')
         RETURNING ${SELECT_COLS}`,
        [now],
      );
      return result.rows.map(rowToUpload);
    },
  };
}
