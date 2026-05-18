import type { DbPool } from "../db/pool.js";
import type { PlaybackId, PlaybackPolicy } from "../engine/types/index.js";
import type { PlaybackIdRepo } from "../engine/repo/index.js";

interface Row {
  id: string;
  api_key_id: string;
  asset_id: string | null;
  live_stream_id: string | null;
  policy: string;
  token_required: boolean;
  created_at: Date;
}

function rowToPlaybackId(r: Row): PlaybackId {
  return {
    id: r.id,
    apiKeyId: r.api_key_id,
    assetId: r.asset_id ?? undefined,
    liveStreamId: r.live_stream_id ?? undefined,
    policy: r.policy as PlaybackPolicy,
    tokenRequired: r.token_required,
    createdAt: r.created_at,
  };
}

const SELECT_COLS = `id, api_key_id, asset_id, live_stream_id, policy, token_required, created_at`;

export function createPlaybackIdRepo(pool: DbPool): PlaybackIdRepo {
  return {
    async insert(pb) {
      const result = await pool.query<Row>(
        `INSERT INTO media.playback_ids (id, api_key_id, asset_id, live_stream_id, policy, token_required)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING ${SELECT_COLS}`,
        [
          pb.id,
          pb.apiKeyId,
          pb.assetId ?? null,
          pb.liveStreamId ?? null,
          pb.policy,
          pb.tokenRequired,
        ],
      );
      return rowToPlaybackId(result.rows[0]!);
    },

    async byId(id) {
      const result = await pool.query<Row>(
        `SELECT ${SELECT_COLS} FROM media.playback_ids WHERE id = $1`,
        [id],
      );
      return result.rowCount === 0 ? null : rowToPlaybackId(result.rows[0]!);
    },

    async byAsset(assetId) {
      const result = await pool.query<Row>(
        `SELECT ${SELECT_COLS} FROM media.playback_ids
         WHERE asset_id = $1 ORDER BY created_at ASC`,
        [assetId],
      );
      return result.rows.map(rowToPlaybackId);
    },

    async byLiveStream(liveStreamId) {
      const result = await pool.query<Row>(
        `SELECT ${SELECT_COLS} FROM media.playback_ids
         WHERE live_stream_id = $1 ORDER BY created_at ASC`,
        [liveStreamId],
      );
      return result.rows.map(rowToPlaybackId);
    },

    async delete(id) {
      await pool.query(`DELETE FROM media.playback_ids WHERE id = $1`, [id]);
    },
  };
}
