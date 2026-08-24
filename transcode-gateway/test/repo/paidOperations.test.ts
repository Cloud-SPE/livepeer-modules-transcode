import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import type { QueryResult, QueryResultRow } from "pg";

import type { DbPool } from "../../src/db/pool.js";
import type { NewPaidOperation } from "../../src/engine/repo/index.js";
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
  const secrets = {
    runnerIngestKey: "private-runner-key",
    grants: { issue: "grant" },
  };
  const claim = {
    owner: "gateway-test-1",
    version: "1",
    leaseExpiresAt: new Date("2030-01-01T00:00:00Z"),
  };

  await repo.putSecrets("00000000-0000-4000-8000-000000000001", claim, secrets);
  assert.ok(stored);
  assert.equal(
    (stored["ciphertext"] as Buffer).includes(
      Buffer.from("private-runner-key"),
    ),
    false,
  );
  assert.deepEqual(
    await repo.readSecrets("00000000-0000-4000-8000-000000000001", claim),
    secrets,
  );
  await repo.recordTerminal("00000000-0000-4000-8000-000000000001", claim, {
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
  assert.equal(
    await repo.readSecrets("00000000-0000-4000-8000-000000000001", claim),
    null,
  );
});

test("v2 persistence migration is additive and enforces identity, ownership, and secret separation", async () => {
  const sql = await readFile(
    resolve(process.cwd(), "migrations/0003_paid_operations_v2.sql"),
    "utf8",
  );
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

test("paid session recovery migration adds a fenced multi-instance claim without plaintext secrets", async () => {
  const sql = await readFile(
    resolve(process.cwd(), "migrations/0004_paid_session_recovery.sql"),
    "utf8",
  );
  assert.doesNotMatch(sql, /\b(?:DROP|TRUNCATE)\b/i);
  assert.match(sql, /lifecycle_version BIGINT NOT NULL DEFAULT 0/);
  assert.match(sql, /recovery_owner TEXT/);
  assert.match(sql, /recovery_lease_expires_at TIMESTAMPTZ/);
  assert.match(sql, /paid_operations_recovery_lease_complete/);
  assert.match(sql, /session_runtime JSONB/);
  assert.match(sql, /paid_operations_session_runtime_kind/);
  assert.doesNotMatch(
    sql,
    /(?:stream_key|credential|grant|session_params)\s+(?:TEXT|JSONB)/i,
  );
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

  const leaseExpiresAt = new Date("2026-08-22T12:01:00Z");
  assert.deepEqual(
    await repo.claimRecoverable("gateway-1", now, leaseExpiresAt, 25),
    [],
  );
  assert.match(calls[2]!.sql, /FOR UPDATE SKIP LOCKED/);
  assert.match(
    calls[2]!.sql,
    /recovery_lease_expires_at IS NULL OR recovery_lease_expires_at <= \$2/,
  );
  assert.match(calls[2]!.sql, /lifecycle_version = lifecycle_version \+ 1/);
  assert.deepEqual(calls[2]!.params, ["gateway-1", now, leaseExpiresAt, 25]);

  const claim = { owner: "gateway-1", version: "7", leaseExpiresAt };
  assert.equal(
    await repo.recordProgress("op-1", claim, { status: "active" }),
    null,
  );
  assert.match(calls[3]!.sql, /recovery_owner = \$3/);
  assert.match(calls[3]!.sql, /lifecycle_version = \$4/);
  assert.match(calls[3]!.sql, /recovery_lease_expires_at = \$5/);
  await assert.rejects(() =>
    repo.recordProgress(
      "op-1",
      { ...claim, version: "-1" },
      { status: "active" },
    ),
  );
});

test("paid live operation and encrypted open intent are created in one transaction", async () => {
  const calls: Array<{ sql: string; params?: unknown[] }> = [];
  let released = false;
  const client = {
    async query(sql: string, params?: unknown[]) {
      calls.push({ sql, params });
      if (sql.includes("INSERT INTO media.paid_operation_secrets")) {
        throw new Error("secret write failed");
      }
      return result(
        sql.includes("INSERT INTO media.paid_operations") ? [{}] : [],
      );
    },
    release() {
      released = true;
    },
  };
  const pool = {
    async connect() {
      return client;
    },
  } as unknown as DbPool;
  const repo = createPaidOperationRepo(
    pool,
    createOperationSecretCipher("test-key", randomBytes(32)),
  );
  const operation: NewPaidOperation = {
    id: "00000000-0000-4000-8000-000000000002",
    kind: "session",
    apiKeyId: "00000000-0000-4000-8000-000000000003",
    liveStreamId: "live_001",
    requestId: "request-001",
    requestContentSha256: "a".repeat(64),
    workId: "work-001",
    route: {
      protocol: "paid-session/v1",
      capability: "video:live.rtmp",
      offering: "live-standard",
      requestDescriptor: "rtmp-hls-session/v1",
      responseDescriptor: "rtmp-hls/v1",
      workUnit: "output_seconds",
      pricePerUnitWei: "1",
      unitsPerPrice: "1",
      quoteId: "quote-1",
      quoteVersion: "1",
      constraintFingerprint: "constraint-1",
      routeFingerprint: "route-1",
      settlementKey: "settlement-1",
      raw: {},
    },
    status: "opening",
    fundedUnits: "60",
    sessionRuntime: {
      publisherMode: "gateway-relay",
      relayStatus: "pending",
      relayGeneration: 0,
      lastRunnerSequence: "0",
      lastRunnerUsage: "0",
    },
  };
  await assert.rejects(
    () =>
      repo.insertWithSecrets(
        operation,
        {
          openIntent: { request_id: "request-001" },
          runnerIngestKey: "private-key",
        },
        {
          owner: "gateway-1",
          leaseExpiresAt: new Date("2030-01-01T00:00:00Z"),
        },
      ),
    /secret write failed/,
  );
  assert.equal(calls[0]!.sql, "BEGIN");
  assert.match(calls[1]!.sql, /INSERT INTO media\.paid_operations/);
  assert.match(calls[2]!.sql, /INSERT INTO media\.paid_operation_secrets/);
  assert.equal(calls[3]!.sql, "ROLLBACK");
  assert.equal(released, true);
  const serializedParams = calls
    .flatMap((call) => call.params ?? [])
    .map((value) =>
      Buffer.isBuffer(value) ? value.toString("utf8") : String(value),
    )
    .join(" ");
  assert.doesNotMatch(serializedParams, /private-key/);
});
