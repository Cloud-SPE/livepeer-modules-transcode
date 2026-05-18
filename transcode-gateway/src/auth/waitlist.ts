import type { DbPool } from "../db/pool.js";
import { generateVerificationToken, sha256Hex } from "./crypto.js";

// Modeled on blue-claw-network/web-platform/backend/src/routes/waitlist.rs.

export interface WaitlistEntry {
  id: string;
  name: string;
  email: string;
  ipHash: string | null;
  status: string;
  emailVerified: boolean;
  createdAt: Date;
}

export interface InsertSignupResult {
  inserted: boolean;
  rawVerificationToken?: string;
}

// Atomic insert with ON CONFLICT DO NOTHING. Same response shape for
// "new" vs "duplicate" prevents email enumeration.
export async function insertSignup(
  pool: DbPool,
  input: { name: string; email: string; ipHash: string | null },
  tokenTtlHours: number,
): Promise<InsertSignupResult> {
  const rawToken = generateVerificationToken();
  const tokenHash = sha256Hex(rawToken);
  const expiresAt = new Date(Date.now() + tokenTtlHours * 60 * 60 * 1000);

  const result = await pool.query<{ id: string }>(
    `INSERT INTO auth.waitlist
       (name, email, ip_hash, status, email_verified,
        verification_token, verification_token_expires_at)
     VALUES ($1, $2, $3, 'pending', false, $4, $5)
     ON CONFLICT (email) DO NOTHING
     RETURNING id`,
    [input.name, input.email, input.ipHash, tokenHash, expiresAt],
  );

  if (result.rowCount === 0) return { inserted: false };
  return { inserted: true, rawVerificationToken: rawToken };
}

export async function verifyEmail(
  pool: DbPool,
  rawToken: string,
): Promise<{ name: string; email: string } | null> {
  const tokenHash = sha256Hex(rawToken);

  const result = await pool.query<{ name: string; email: string }>(
    `UPDATE auth.waitlist
     SET email_verified = true,
         verification_token = NULL,
         verification_token_expires_at = NULL
     WHERE verification_token = $1
       AND email_verified = false
       AND (verification_token_expires_at IS NULL
            OR verification_token_expires_at > NOW())
     RETURNING name, email`,
    [tokenHash],
  );

  if (result.rowCount === 0) return null;
  const row = result.rows[0]!;
  return { name: row.name, email: row.email };
}

export interface ListFilters {
  page?: number;
  perPage?: number;
  sort?: "name" | "email" | "status" | "created_at";
  order?: "asc" | "desc";
  search?: string;
  status?: "pending" | "approved" | "rejected";
  verified?: boolean;
}

export interface ListResult {
  data: WaitlistEntry[];
  page: number;
  perPage: number;
  total: number;
  totalPages: number;
}

export async function listForAdmin(pool: DbPool, filters: ListFilters): Promise<ListResult> {
  const page = Math.max(1, filters.page ?? 1);
  const perPage = Math.min(200, Math.max(1, filters.perPage ?? 50));
  const offset = (page - 1) * perPage;

  const sortCol = filters.sort ?? "created_at";
  const orderDir = filters.order === "asc" ? "ASC" : "DESC";

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters.status) {
    params.push(filters.status);
    conditions.push(`status = $${params.length}`);
  }
  if (filters.verified !== undefined) {
    params.push(filters.verified);
    conditions.push(`email_verified = $${params.length}`);
  }
  if (filters.search) {
    params.push(`%${filters.search}%`);
    conditions.push(`(name ILIKE $${params.length} OR email ILIKE $${params.length})`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const dataParams = [...params, perPage, offset];
  const dataQuery = `
    SELECT id, name, email, ip_hash, status, email_verified, created_at
    FROM auth.waitlist
    ${whereClause}
    ORDER BY ${sortCol} ${orderDir}
    LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`;

  const countQuery = `SELECT COUNT(*)::int AS total FROM auth.waitlist ${whereClause}`;

  const [dataRes, countRes] = await Promise.all([
    pool.query<{
      id: string;
      name: string;
      email: string;
      ip_hash: string | null;
      status: string;
      email_verified: boolean;
      created_at: Date;
    }>(dataQuery, dataParams),
    pool.query<{ total: number }>(countQuery, params),
  ]);

  const total = countRes.rows[0]!.total;
  return {
    data: dataRes.rows.map((r) => ({
      id: r.id,
      name: r.name,
      email: r.email,
      ipHash: r.ip_hash,
      status: r.status,
      emailVerified: r.email_verified,
      createdAt: r.created_at,
    })),
    page,
    perPage,
    total,
    totalPages: Math.ceil(total / perPage),
  };
}

export async function countAll(pool: DbPool): Promise<number> {
  const result = await pool.query<{ count: number }>(`SELECT COUNT(*)::int AS count FROM auth.waitlist`);
  return result.rows[0]!.count;
}

export interface Stats {
  totalSignups: number;
  today: number;
  thisWeek: number;
  thisMonth: number;
  dailyCounts: Array<{ date: string; count: number }>;
}

export async function stats(pool: DbPool): Promise<Stats> {
  const queries = [
    pool.query<{ total: number }>(`SELECT COUNT(*)::int AS total FROM auth.waitlist`),
    pool.query<{ today: number }>(
      `SELECT COUNT(*)::int AS today FROM auth.waitlist WHERE created_at >= CURRENT_DATE`,
    ),
    pool.query<{ week: number }>(
      `SELECT COUNT(*)::int AS week FROM auth.waitlist
       WHERE created_at >= date_trunc('week', CURRENT_DATE)`,
    ),
    pool.query<{ month: number }>(
      `SELECT COUNT(*)::int AS month FROM auth.waitlist
       WHERE created_at >= date_trunc('month', CURRENT_DATE)`,
    ),
    pool.query<{ date: string; count: number }>(
      `SELECT created_at::date::text AS date, COUNT(*)::int AS count
       FROM auth.waitlist
       WHERE created_at >= CURRENT_DATE - INTERVAL '30 days'
       GROUP BY created_at::date
       ORDER BY date DESC`,
    ),
  ] as const;
  const [total, today, week, month, daily] = await Promise.all(queries);

  return {
    totalSignups: total.rows[0]!.total,
    today: today.rows[0]!.today,
    thisWeek: week.rows[0]!.week,
    thisMonth: month.rows[0]!.month,
    dailyCounts: daily.rows.map((r) => ({ date: r.date, count: r.count })),
  };
}

export async function exportRows(pool: DbPool): Promise<WaitlistEntry[]> {
  const result = await pool.query<{
    id: string;
    name: string;
    email: string;
    ip_hash: string | null;
    status: string;
    email_verified: boolean;
    created_at: Date;
  }>(
    `SELECT id, name, email, ip_hash, status, email_verified, created_at
     FROM auth.waitlist ORDER BY created_at DESC`,
  );
  return result.rows.map((r) => ({
    id: r.id,
    name: r.name,
    email: r.email,
    ipHash: r.ip_hash,
    status: r.status,
    emailVerified: r.email_verified,
    createdAt: r.created_at,
  }));
}
