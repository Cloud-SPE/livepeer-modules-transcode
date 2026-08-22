import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import type { QueryResult, QueryResultRow } from "pg";

import type { DbPool } from "../../src/db/pool.js";
import { createOperationSecretCipher } from "../../src/livepeer/operationSecrets.js";
import { createPaidOperationRepo } from "../../src/repo/paidOperations.js";

function result<T extends QueryResultRow>(rows: T[]): QueryResult<T> {
  return {
    command: "SELECT",
    rowCount: rows.length,
    oid: 0,
    fields: [],
    rows,
  };
}

test("paid operation repository stores only encrypted secret material and clears it", async () => {
  let stored: Record<string, Buffer | string> | null = null;
  const query = async (
    sql: string,
    params?: unknown[],
  ): Promise<QueryResult<Record<string, unknown>>> => {
    if (sql.includes("INSERT INTO media.paid_operation_secrets")) {
      stored = {
        key_id: params![1] as string,
        wrapped_key: params![2] as Buffer,
        wrapped_key_iv: params![3] as Buffer,
        wrapped_key_tag: params![4] as Buffer,
        ciphertext: params![5] as Buffer,
        payload_iv: params![6] as Buffer,
        payload_tag: params![7] as Buffer,
      };
      return result([]);
    }
    if (sql.includes("DELETE FROM media.paid_operation_secrets")) {
      stored = null;
      return result([]);
    }
    if (sql.includes("FROM media.paid_operation_secrets")) {
      return result(stored === null ? [] : [stored]);
    }
    throw new Error(`unexpected SQL: ${sql}`);
  };
  const pool = { query } as unknown as DbPool;
  const repo = createPaidOperationRepo(
    pool,
    createOperationSecretCipher("test-key", randomBytes(32)),
  );
  const secrets = { runnerIngestKey: "private-runner-key", grants: { issue: "grant" } };

  await repo.putSecrets("00000000-0000-4000-8000-000000000001", secrets);
  assert.ok(stored);
  assert.equal((stored["ciphertext"] as Buffer).includes(Buffer.from("private-runner-key")), false);
  assert.deepEqual(await repo.readSecrets("00000000-0000-4000-8000-000000000001"), secrets);
  await repo.recordTerminal("00000000-0000-4000-8000-000000000001", {
    status: "settled",
    claimedUnits: "42",
    settlementSequence: "3",
    evidence: {
      httpStatus: 200,
      responseSha256: "a".repeat(64),
      workUnit: "output_seconds",
      workUnits: "42",
    },
    terminalAt: new Date("2026-08-22T00:00:00Z"),
  });
  assert.equal(await repo.readSecrets("00000000-0000-4000-8000-000000000001"), null);
});

test("v2 persistence migration is additive and enforces identity, ownership, and secret separation", async () => {
  const sql = await readFile(resolve(process.cwd(), "migrations/0003_paid_operations_v2.sql"), "utf8");
  assert.doesNotMatch(sql, /\b(?:DROP|ALTER|TRUNCATE)\b/i);
  assert.match(sql, /request_id\s+TEXT NOT NULL UNIQUE/);
  assert.match(sql, /request_content_sha256/);
  assert.match(sql, /paid_operations_owner/);
  assert.match(sql, /paid_operations_protocol_kind/);
  assert.match(sql, /loc_operation_id/);
  assert.match(sql, /broker_(?:job|session)_id/);
  assert.match(sql, /rotation_generation/);
  assert.match(sql, /settlement_sequence/);
  assert.match(sql, /will_refuse_next_refill/);
  assert.match(sql, /CREATE TABLE media\.paid_operation_secrets/);
  assert.doesNotMatch(sql, /runner_ingest_(?:url|key)\s+TEXT/i);
});

test("paid operation recovery is restart-safe and customer reads are owner-scoped", async () => {
  const calls: Array<{ sql: string; params?: unknown[] }> = [];
  const pool = {
    async query(sql: string, params?: unknown[]) {
      calls.push({ sql, params });
      return result([]);
    },
  } as unknown as DbPool;
  const repo = createPaidOperationRepo(
    pool,
    createOperationSecretCipher("test-key", randomBytes(32)),
  );
  const now = new Date("2026-08-22T12:00:00Z");

  assert.deepEqual(await repo.recoverable(now, 50), []);
  assert.match(calls[0]!.sql, /terminal_at IS NULL/);
  assert.match(calls[0]!.sql, /next_retry_at IS NULL OR next_retry_at <= \$1/);
  assert.deepEqual(calls[0]!.params, [now, 50]);
  await assert.rejects(() => repo.recoverable(now, 0));

  assert.equal(await repo.byIdForApiKey("op-1", "api-key-1"), null);
  assert.match(calls[1]!.sql, /id = \$1 AND api_key_id = \$2/);
  assert.deepEqual(calls[1]!.params, ["op-1", "api-key-1"]);
});
