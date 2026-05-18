import type { DbPool } from "../db/pool.js";
import type { Asset, AssetStatus } from "../engine/types/index.js";
import type { AssetRepo, ListAssetsOpts } from "../engine/repo/index.js";

interface Row {
  id: string;
  api_key_id: string;
  status: string;
  source_type: string;
  selected_offering: string | null;
  source_url: string | null;
  duration_sec: string | null;
  width: number | null;
  height: number | null;
  frame_rate: string | null;
  audio_codec: string | null;
  video_codec: string | null;
  encoding_tier: string;
  ffprobe_json: unknown;
  error_message: string | null;
  created_at: Date;
  ready_at: Date | null;
  deleted_at: Date | null;
}

function rowToAsset(r: Row): Asset {
  return {
    id: r.id,
    apiKeyId: r.api_key_id,
    status: r.status as Asset["status"],
    sourceType: r.source_type as Asset["sourceType"],
    selectedOffering: r.selected_offering ?? undefined,
    sourceUrl: r.source_url ?? undefined,
    durationSec: r.duration_sec === null ? undefined : Number(r.duration_sec),
    width: r.width ?? undefined,
    height: r.height ?? undefined,
    frameRate: r.frame_rate === null ? undefined : Number(r.frame_rate),
    audioCodec: r.audio_codec ?? undefined,
    videoCodec: r.video_codec ?? undefined,
    encodingTier: r.encoding_tier as Asset["encodingTier"],
    ffprobeJson: r.ffprobe_json ?? undefined,
    errorMessage: r.error_message ?? undefined,
    createdAt: r.created_at,
    readyAt: r.ready_at ?? undefined,
    deletedAt: r.deleted_at ?? undefined,
  };
}

const SELECT_COLS = `id, api_key_id, status, source_type, selected_offering, source_url,
  duration_sec, width, height, frame_rate, audio_codec, video_codec, encoding_tier,
  ffprobe_json, error_message, created_at, ready_at, deleted_at`;

export function createAssetRepo(pool: DbPool): AssetRepo {
  return {
    async insert(asset) {
      const result = await pool.query<Row>(
        `INSERT INTO media.assets
           (id, api_key_id, status, source_type, selected_offering, source_url,
            duration_sec, width, height, frame_rate, audio_codec, video_codec,
            encoding_tier, ffprobe_json, error_message, ready_at, deleted_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
         RETURNING ${SELECT_COLS}`,
        [
          asset.id,
          asset.apiKeyId,
          asset.status,
          asset.sourceType,
          asset.selectedOffering ?? null,
          asset.sourceUrl ?? null,
          asset.durationSec ?? null,
          asset.width ?? null,
          asset.height ?? null,
          asset.frameRate ?? null,
          asset.audioCodec ?? null,
          asset.videoCodec ?? null,
          asset.encodingTier,
          asset.ffprobeJson ?? null,
          asset.errorMessage ?? null,
          asset.readyAt ?? null,
          asset.deletedAt ?? null,
        ],
      );
      return rowToAsset(result.rows[0]!);
    },

    async byId(id) {
      const result = await pool.query<Row>(
        `SELECT ${SELECT_COLS} FROM media.assets WHERE id = $1`,
        [id],
      );
      return result.rowCount === 0 ? null : rowToAsset(result.rows[0]!);
    },

    async byPlaybackId(playbackId) {
      const result = await pool.query<Row>(
        `SELECT ${SELECT_COLS.split(",").map((c) => "a." + c.trim()).join(", ")}
         FROM media.assets a
         JOIN media.playback_ids p ON p.asset_id = a.id
         WHERE p.id = $1`,
        [playbackId],
      );
      return result.rowCount === 0 ? null : rowToAsset(result.rows[0]!);
    },

    async updateStatus(id, status: AssetStatus, fields) {
      const setExprs: string[] = ["status = $2"];
      const params: unknown[] = [id, status];
      const map: Record<string, unknown> = {};
      if (fields?.durationSec !== undefined) map["duration_sec"] = fields.durationSec;
      if (fields?.width !== undefined) map["width"] = fields.width;
      if (fields?.height !== undefined) map["height"] = fields.height;
      if (fields?.frameRate !== undefined) map["frame_rate"] = fields.frameRate;
      if (fields?.audioCodec !== undefined) map["audio_codec"] = fields.audioCodec;
      if (fields?.videoCodec !== undefined) map["video_codec"] = fields.videoCodec;
      if (fields?.ffprobeJson !== undefined) map["ffprobe_json"] = fields.ffprobeJson;
      if (fields?.errorMessage !== undefined) map["error_message"] = fields.errorMessage;
      if (fields?.readyAt !== undefined) map["ready_at"] = fields.readyAt;
      for (const [col, val] of Object.entries(map)) {
        params.push(val);
        setExprs.push(`${col} = $${params.length}`);
      }
      await pool.query(
        `UPDATE media.assets SET ${setExprs.join(", ")} WHERE id = $1`,
        params,
      );
    },

    async softDelete(id, at) {
      await pool.query(
        `UPDATE media.assets SET deleted_at = $2, status = 'deleted' WHERE id = $1`,
        [id, at],
      );
    },

    async list(opts: ListAssetsOpts) {
      const conditions = ["api_key_id = $1"];
      const params: unknown[] = [opts.apiKeyId];
      if (!opts.includeDeleted) conditions.push("deleted_at IS NULL");
      if (opts.cursor) {
        params.push(opts.cursor);
        conditions.push(`created_at < (SELECT created_at FROM media.assets WHERE id = $${params.length})`);
      }
      params.push(opts.limit + 1);
      const result = await pool.query<Row>(
        `SELECT ${SELECT_COLS} FROM media.assets
         WHERE ${conditions.join(" AND ")}
         ORDER BY created_at DESC, id DESC
         LIMIT $${params.length}`,
        params,
      );
      const items = result.rows.slice(0, opts.limit).map(rowToAsset);
      const nextCursor = result.rows.length > opts.limit ? result.rows[opts.limit - 1]!.id : undefined;
      return nextCursor !== undefined ? { items, nextCursor } : { items };
    },

    async recent(opts) {
      const result = await pool.query<Row>(
        `SELECT ${SELECT_COLS} FROM media.assets
         WHERE deleted_at IS NULL
         ORDER BY created_at DESC LIMIT $1`,
        [opts.limit],
      );
      return result.rows.map(rowToAsset);
    },
  };
}
