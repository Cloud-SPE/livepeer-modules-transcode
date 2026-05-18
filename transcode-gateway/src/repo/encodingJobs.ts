import type { DbPool } from "../db/pool.js";
import type { EncodingJob, JobKind, JobStatus } from "../engine/types/index.js";
import type { EncodingJobRepo } from "../engine/repo/index.js";

interface Row {
  id: string;
  asset_id: string;
  rendition_id: string | null;
  kind: string;
  status: string;
  worker_url: string | null;
  attempt_count: number;
  input_url: string | null;
  output_prefix: string | null;
  error_message: string | null;
  started_at: Date | null;
  completed_at: Date | null;
  created_at: Date;
}

function rowToJob(r: Row): EncodingJob {
  return {
    id: r.id,
    assetId: r.asset_id,
    renditionId: r.rendition_id ?? undefined,
    kind: r.kind as JobKind,
    status: r.status as JobStatus,
    workerUrl: r.worker_url ?? undefined,
    attemptCount: r.attempt_count,
    inputUrl: r.input_url ?? undefined,
    outputPrefix: r.output_prefix ?? undefined,
    errorMessage: r.error_message ?? undefined,
    startedAt: r.started_at ?? undefined,
    completedAt: r.completed_at ?? undefined,
    createdAt: r.created_at,
  };
}

const SELECT_COLS = `id, asset_id, rendition_id, kind, status, worker_url, attempt_count,
  input_url, output_prefix, error_message, started_at, completed_at, created_at`;

export function createEncodingJobRepo(pool: DbPool): EncodingJobRepo {
  return {
    async insert(job) {
      const result = await pool.query<Row>(
        `INSERT INTO media.encoding_jobs
           (id, asset_id, rendition_id, kind, status, worker_url, attempt_count, input_url, output_prefix, error_message, started_at, completed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         RETURNING ${SELECT_COLS}`,
        [
          job.id,
          job.assetId,
          job.renditionId ?? null,
          job.kind,
          job.status,
          job.workerUrl ?? null,
          job.attemptCount ?? 0,
          job.inputUrl ?? null,
          job.outputPrefix ?? null,
          job.errorMessage ?? null,
          job.startedAt ?? null,
          job.completedAt ?? null,
        ],
      );
      return rowToJob(result.rows[0]!);
    },

    async byId(id) {
      const result = await pool.query<Row>(
        `SELECT ${SELECT_COLS} FROM media.encoding_jobs WHERE id = $1`,
        [id],
      );
      return result.rowCount === 0 ? null : rowToJob(result.rows[0]!);
    },

    async byAsset(assetId) {
      const result = await pool.query<Row>(
        `SELECT ${SELECT_COLS} FROM media.encoding_jobs
         WHERE asset_id = $1 ORDER BY created_at ASC`,
        [assetId],
      );
      return result.rows.map(rowToJob);
    },

    async queued(assetId, kinds) {
      const result = await pool.query<Row>(
        `SELECT ${SELECT_COLS} FROM media.encoding_jobs
         WHERE asset_id = $1 AND status = 'queued' AND kind = ANY($2)
         ORDER BY created_at ASC`,
        [assetId, kinds],
      );
      return result.rows.map(rowToJob);
    },

    async updateStatus(id, status: JobStatus, fields) {
      const setExprs = ["status = $2"];
      const params: unknown[] = [id, status];
      if (fields?.workerUrl !== undefined) {
        params.push(fields.workerUrl);
        setExprs.push(`worker_url = $${params.length}`);
      }
      if (fields?.outputPrefix !== undefined) {
        params.push(fields.outputPrefix);
        setExprs.push(`output_prefix = $${params.length}`);
      }
      if (fields?.errorMessage !== undefined) {
        params.push(fields.errorMessage);
        setExprs.push(`error_message = $${params.length}`);
      }
      if (fields?.startedAt !== undefined) {
        params.push(fields.startedAt);
        setExprs.push(`started_at = $${params.length}`);
      }
      if (fields?.completedAt !== undefined) {
        params.push(fields.completedAt);
        setExprs.push(`completed_at = $${params.length}`);
      }
      await pool.query(
        `UPDATE media.encoding_jobs SET ${setExprs.join(", ")} WHERE id = $1`,
        params,
      );
    },

    async incrementAttempt(id) {
      await pool.query(
        `UPDATE media.encoding_jobs SET attempt_count = attempt_count + 1 WHERE id = $1`,
        [id],
      );
    },
  };
}
