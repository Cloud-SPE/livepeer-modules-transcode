import type { DbPool } from "../db/pool.js";
import type { Codec, Rendition, RenditionStatus, Resolution } from "../engine/types/index.js";
import type { RenditionRepo } from "../engine/repo/index.js";

interface Row {
  id: string;
  asset_id: string;
  resolution: string;
  codec: string;
  bitrate_kbps: number;
  storage_key: string | null;
  status: string;
  duration_sec: string | null;
  created_at: Date;
  completed_at: Date | null;
}

function rowToRendition(r: Row): Rendition {
  return {
    id: r.id,
    assetId: r.asset_id,
    resolution: r.resolution as Resolution,
    codec: r.codec as Codec,
    bitrateKbps: r.bitrate_kbps,
    storageKey: r.storage_key ?? undefined,
    status: r.status as Rendition["status"],
    durationSec: r.duration_sec === null ? undefined : Number(r.duration_sec),
    createdAt: r.created_at,
    completedAt: r.completed_at ?? undefined,
  };
}

const SELECT_COLS = `id, asset_id, resolution, codec, bitrate_kbps, storage_key,
  status, duration_sec, created_at, completed_at`;

export function createRenditionRepo(pool: DbPool): RenditionRepo {
  return {
    async insert(r) {
      const result = await pool.query<Row>(
        `INSERT INTO media.renditions (id, asset_id, resolution, codec, bitrate_kbps, storage_key, status, duration_sec, completed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING ${SELECT_COLS}`,
        [
          r.id,
          r.assetId,
          r.resolution,
          r.codec,
          r.bitrateKbps,
          r.storageKey ?? null,
          r.status,
          r.durationSec ?? null,
          r.completedAt ?? null,
        ],
      );
      return rowToRendition(result.rows[0]!);
    },

    async byAsset(assetId) {
      const result = await pool.query<Row>(
        `SELECT ${SELECT_COLS} FROM media.renditions WHERE asset_id = $1 ORDER BY created_at ASC`,
        [assetId],
      );
      return result.rows.map(rowToRendition);
    },

    async updateStatus(id, status: RenditionStatus, fields) {
      const setExprs = ["status = $2"];
      const params: unknown[] = [id, status];
      if (fields?.storageKey !== undefined) {
        params.push(fields.storageKey);
        setExprs.push(`storage_key = $${params.length}`);
      }
      if (fields?.durationSec !== undefined) {
        params.push(fields.durationSec);
        setExprs.push(`duration_sec = $${params.length}`);
      }
      if (fields?.completedAt !== undefined) {
        params.push(fields.completedAt);
        setExprs.push(`completed_at = $${params.length}`);
      }
      await pool.query(
        `UPDATE media.renditions SET ${setExprs.join(", ")} WHERE id = $1`,
        params,
      );
    },
  };
}
