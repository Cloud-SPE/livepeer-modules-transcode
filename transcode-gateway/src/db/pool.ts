import pg from "pg";

export type DbPool = pg.Pool;

export function createPool(databaseUrl: string): DbPool {
  return new pg.Pool({
    connectionString: databaseUrl,
    max: 20,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
}
