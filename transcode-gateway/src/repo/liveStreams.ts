import type { DbPool } from "../db/pool.js";
import type { Capability, IngestProtocol, LiveStream, LiveStreamStatus } from "../engine/types/index.js";
import type { LiveStreamRepo } from "../engine/repo/index.js";

interface Row {
  id: string;
  api_key_id: string;
  name: string | null;
  stream_key_hash: string;
  status: string;
  ingest_protocol: string;
  session_id: string | null;
  worker_id: string | null;
  worker_url: string | null;
  selected_capability: string | null;
  selected_offering: string | null;
  selected_work_unit: string | null;
  selected_price_per_work_unit_wei: string | null;
  last_seen_at: Date | null;
  created_at: Date;
  ended_at: Date | null;
}

function rowToLiveStream(r: Row): LiveStream {
  return {
    id: r.id,
    apiKeyId: r.api_key_id,
    name: r.name ?? undefined,
    streamKeyHash: r.stream_key_hash,
    status: r.status as LiveStreamStatus,
    ingestProtocol: r.ingest_protocol as IngestProtocol,
    sessionId: r.session_id ?? undefined,
    workerId: r.worker_id ?? undefined,
    workerUrl: r.worker_url ?? undefined,
    selectedCapability: (r.selected_capability ?? undefined) as Capability | undefined,
    selectedOffering: r.selected_offering ?? undefined,
    selectedWorkUnit: r.selected_work_unit ?? undefined,
    selectedPricePerWorkUnitWei: r.selected_price_per_work_unit_wei ?? undefined,
    lastSeenAt: r.last_seen_at ?? undefined,
    createdAt: r.created_at,
    endedAt: r.ended_at ?? undefined,
  };
}

const SELECT_COLS = `id, api_key_id, name, stream_key_hash, status, ingest_protocol,
  session_id, worker_id, worker_url, selected_capability, selected_offering,
  selected_work_unit, selected_price_per_work_unit_wei, last_seen_at, created_at, ended_at`;

export function createLiveStreamRepo(pool: DbPool): LiveStreamRepo {
  return {
    async insert(stream) {
      const result = await pool.query<Row>(
        `INSERT INTO media.live_streams
           (id, api_key_id, name, stream_key_hash, status, ingest_protocol, session_id,
            worker_id, worker_url, selected_capability, selected_offering, selected_work_unit,
            selected_price_per_work_unit_wei, last_seen_at, ended_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
         RETURNING ${SELECT_COLS}`,
        [
          stream.id,
          stream.apiKeyId,
          stream.name ?? null,
          stream.streamKeyHash,
          stream.status,
          stream.ingestProtocol,
          stream.sessionId ?? null,
          stream.workerId ?? null,
          stream.workerUrl ?? null,
          stream.selectedCapability ?? null,
          stream.selectedOffering ?? null,
          stream.selectedWorkUnit ?? null,
          stream.selectedPricePerWorkUnitWei ?? null,
          stream.lastSeenAt ?? null,
          stream.endedAt ?? null,
        ],
      );
      return rowToLiveStream(result.rows[0]!);
    },

    async listForApiKey(apiKeyId) {
      const result = await pool.query<Row>(`SELECT ${SELECT_COLS} FROM media.live_streams WHERE api_key_id = $1 ORDER BY created_at DESC LIMIT 100`, [apiKeyId]);
      return result.rows.map(rowToLiveStream);
    },

    async byId(id) {
      const result = await pool.query<Row>(
        `SELECT ${SELECT_COLS} FROM media.live_streams WHERE id = $1`,
        [id],
      );
      return result.rowCount === 0 ? null : rowToLiveStream(result.rows[0]!);
    },

    async byStreamKeyHash(hash) {
      const result = await pool.query<Row>(
        `SELECT ${SELECT_COLS} FROM media.live_streams WHERE stream_key_hash = $1`,
        [hash],
      );
      return result.rowCount === 0 ? null : rowToLiveStream(result.rows[0]!);
    },

    async updateStatus(id, status: LiveStreamStatus, fields) {
      const setExprs = ["status = $2"];
      const params: unknown[] = [id, status];
      const map: Record<string, unknown> = {};
      if (fields?.sessionId !== undefined) map["session_id"] = fields.sessionId;
      if (fields?.workerId !== undefined) map["worker_id"] = fields.workerId;
      if (fields?.workerUrl !== undefined) map["worker_url"] = fields.workerUrl;
      if (fields?.selectedCapability !== undefined) map["selected_capability"] = fields.selectedCapability;
      if (fields?.selectedOffering !== undefined) map["selected_offering"] = fields.selectedOffering;
      if (fields?.selectedWorkUnit !== undefined) map["selected_work_unit"] = fields.selectedWorkUnit;
      if (fields?.selectedPricePerWorkUnitWei !== undefined)
        map["selected_price_per_work_unit_wei"] = fields.selectedPricePerWorkUnitWei;
      if (fields?.lastSeenAt !== undefined) map["last_seen_at"] = fields.lastSeenAt;
      if (fields?.endedAt !== undefined) map["ended_at"] = fields.endedAt;
      for (const [col, val] of Object.entries(map)) {
        params.push(val);
        setExprs.push(`${col} = $${params.length}`);
      }
      await pool.query(
        `UPDATE media.live_streams SET ${setExprs.join(", ")} WHERE id = $1`,
        params,
      );
    },

    async active() {
      const result = await pool.query<Row>(
        `SELECT ${SELECT_COLS} FROM media.live_streams
         WHERE status IN ('active', 'reconnecting') ORDER BY created_at DESC`,
      );
      return result.rows.map(rowToLiveStream);
    },

    async sweepStale(cutoff) {
      const result = await pool.query<Row>(
        `UPDATE media.live_streams
         SET status = 'ended', ended_at = NOW()
         WHERE status IN ('active', 'reconnecting') AND last_seen_at < $1
         RETURNING ${SELECT_COLS}`,
        [cutoff],
      );
      return result.rows.map(rowToLiveStream);
    },
  };
}
