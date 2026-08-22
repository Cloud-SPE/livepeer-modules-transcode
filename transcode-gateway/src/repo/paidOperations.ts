import type { DbPool } from "../db/pool.js";
import type {
  JsonValue,
  PaidOperation,
  PaidOperationKind,
  PaidOperationSecrets,
  PaidRouteSnapshot,
} from "../engine/types/index.js";
import type {
  NewPaidOperation,
  PaidOperationProgress,
  PaidOperationRepo,
} from "../engine/repo/index.js";
import type {
  EncryptedOperationSecrets,
  OperationSecretCipher,
} from "../livepeer/operationSecrets.js";

interface Row {
  id: string;
  operation_kind: string;
  api_key_id: string;
  asset_id: string | null;
  live_stream_id: string | null;
  request_id: string;
  request_content_sha256: string;
  work_id: string;
  rotation_generation: number;
  protocol: string;
  transport: string | null;
  capability: string;
  offering: string;
  request_descriptor: string;
  response_descriptor: string | null;
  work_unit: string;
  estimator: JsonValue | null;
  price_per_unit_wei: string;
  units_per_price: string;
  quote_id: string;
  quote_version: string;
  constraint_fingerprint: string;
  route_fingerprint: string;
  settlement_key: string;
  route_snapshot: JsonValue;
  status: string;
  loc_operation_id: string | null;
  broker_job_id: string | null;
  broker_session_id: string | null;
  funded_units: string;
  claimed_units: string | null;
  balance_units: string | null;
  will_refuse_next_refill: boolean | null;
  lease_expires_at: Date | null;
  settlement_sequence: string;
  retry_count: number;
  next_retry_at: Date | null;
  last_error_code: string | null;
  terminal_evidence: PaidOperation["terminalEvidence"] | null;
  created_at: Date;
  updated_at: Date;
  terminal_at: Date | null;
}

interface SecretRow {
  key_id: string;
  wrapped_key: Buffer;
  wrapped_key_iv: Buffer;
  wrapped_key_tag: Buffer;
  ciphertext: Buffer;
  payload_iv: Buffer;
  payload_tag: Buffer;
}

const SELECT_COLUMNS = `id, operation_kind, api_key_id, asset_id, live_stream_id,
  request_id, request_content_sha256, work_id, rotation_generation, protocol,
  transport, capability, offering, request_descriptor, response_descriptor,
  work_unit, estimator, price_per_unit_wei, units_per_price, quote_id,
  quote_version, constraint_fingerprint, route_fingerprint, settlement_key,
  route_snapshot, status, loc_operation_id, broker_job_id, broker_session_id,
  funded_units, claimed_units, balance_units, will_refuse_next_refill,
  lease_expires_at, settlement_sequence, retry_count, next_retry_at,
  last_error_code, terminal_evidence, created_at, updated_at,
  terminal_at`;

function routeFromRow(row: Row): PaidRouteSnapshot {
  return {
    protocol: row.protocol as PaidRouteSnapshot["protocol"],
    transport: (row.transport ?? undefined) as PaidRouteSnapshot["transport"],
    capability: row.capability,
    offering: row.offering,
    requestDescriptor: row.request_descriptor,
    responseDescriptor: row.response_descriptor ?? undefined,
    workUnit: row.work_unit,
    estimator: row.estimator ?? undefined,
    pricePerUnitWei: row.price_per_unit_wei,
    unitsPerPrice: row.units_per_price,
    quoteId: row.quote_id,
    quoteVersion: row.quote_version,
    constraintFingerprint: row.constraint_fingerprint,
    routeFingerprint: row.route_fingerprint,
    settlementKey: row.settlement_key,
    raw: row.route_snapshot,
  };
}

function rowToOperation(row: Row): PaidOperation {
  return {
    id: row.id,
    kind: row.operation_kind as PaidOperationKind,
    apiKeyId: row.api_key_id,
    assetId: row.asset_id ?? undefined,
    liveStreamId: row.live_stream_id ?? undefined,
    requestId: row.request_id,
    requestContentSha256: row.request_content_sha256,
    workId: row.work_id,
    rotationGeneration: row.rotation_generation,
    route: routeFromRow(row),
    status: row.status,
    locOperationId: row.loc_operation_id ?? undefined,
    brokerJobId: row.broker_job_id ?? undefined,
    brokerSessionId: row.broker_session_id ?? undefined,
    fundedUnits: row.funded_units,
    claimedUnits: row.claimed_units ?? undefined,
    balanceUnits: row.balance_units ?? undefined,
    willRefuseNextRefill: row.will_refuse_next_refill ?? undefined,
    leaseExpiresAt: row.lease_expires_at ?? undefined,
    settlementSequence: row.settlement_sequence,
    retryCount: row.retry_count,
    nextRetryAt: row.next_retry_at ?? undefined,
    lastErrorCode: row.last_error_code ?? undefined,
    terminalEvidence: row.terminal_evidence ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    terminalAt: row.terminal_at ?? undefined,
  };
}

function encryptedFromRow(row: SecretRow): EncryptedOperationSecrets {
  return {
    keyId: row.key_id,
    wrappedKey: row.wrapped_key,
    wrappedKeyIv: row.wrapped_key_iv,
    wrappedKeyTag: row.wrapped_key_tag,
    ciphertext: row.ciphertext,
    payloadIv: row.payload_iv,
    payloadTag: row.payload_tag,
  };
}

export function createPaidOperationRepo(
  pool: DbPool,
  secretCipher: OperationSecretCipher,
): PaidOperationRepo {
  return {
    async insert(value: NewPaidOperation) {
      const columns = [
        "id", "operation_kind", "api_key_id", "asset_id", "live_stream_id",
        "request_id", "request_content_sha256", "work_id", "rotation_generation",
        "protocol", "transport", "capability", "offering", "request_descriptor",
        "response_descriptor", "work_unit", "estimator", "price_per_unit_wei",
        "units_per_price", "quote_id", "quote_version", "constraint_fingerprint",
        "route_fingerprint", "settlement_key", "route_snapshot", "status", "funded_units",
      ];
      const params: unknown[] = [
        value.id, value.kind, value.apiKeyId, value.assetId ?? null,
        value.liveStreamId ?? null, value.requestId, value.requestContentSha256,
        value.workId, value.rotationGeneration ?? 0, value.route.protocol,
        value.route.transport ?? null, value.route.capability, value.route.offering,
        value.route.requestDescriptor, value.route.responseDescriptor ?? null,
        value.route.workUnit, value.route.estimator ?? null, value.route.pricePerUnitWei,
        value.route.unitsPerPrice, value.route.quoteId, value.route.quoteVersion,
        value.route.constraintFingerprint, value.route.routeFingerprint,
        value.route.settlementKey, value.route.raw, value.status, value.fundedUnits,
      ];
      const placeholders = params.map((_, index) => `$${index + 1}`).join(", ");
      const result = await pool.query<Row>(
        `INSERT INTO media.paid_operations (${columns.join(", ")})
         VALUES (${placeholders}) RETURNING ${SELECT_COLUMNS}`,
        params,
      );
      return rowToOperation(result.rows[0]!);
    },

    async byId(id) {
      const result = await pool.query<Row>(
        `SELECT ${SELECT_COLUMNS} FROM media.paid_operations WHERE id = $1`,
        [id],
      );
      return result.rowCount === 0 ? null : rowToOperation(result.rows[0]!);
    },

    async byIdForApiKey(id, apiKeyId) {
      const result = await pool.query<Row>(
        `SELECT ${SELECT_COLUMNS} FROM media.paid_operations
         WHERE id = $1 AND api_key_id = $2`,
        [id, apiKeyId],
      );
      return result.rowCount === 0 ? null : rowToOperation(result.rows[0]!);
    },

    async byRequestId(requestId) {
      const result = await pool.query<Row>(
        `SELECT ${SELECT_COLUMNS} FROM media.paid_operations WHERE request_id = $1`,
        [requestId],
      );
      return result.rowCount === 0 ? null : rowToOperation(result.rows[0]!);
    },

    async recoverable(now, limit) {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
        throw new Error("recovery batch limit must be an integer from 1 to 1000");
      }
      const result = await pool.query<Row>(
        `SELECT ${SELECT_COLUMNS} FROM media.paid_operations
         WHERE terminal_at IS NULL AND (next_retry_at IS NULL OR next_retry_at <= $1)
         ORDER BY updated_at ASC LIMIT $2`,
        [now, limit],
      );
      return result.rows.map(rowToOperation);
    },

    async recordProgress(id, value: PaidOperationProgress) {
      const sets = ["status = $2", "updated_at = NOW()", "last_error_code = NULL"];
      const params: unknown[] = [id, value.status];
      const fields: Array<[string, unknown]> = [
        ["loc_operation_id", value.locOperationId],
        ["broker_job_id", value.brokerJobId],
        ["broker_session_id", value.brokerSessionId],
        ["funded_units", value.fundedUnits],
        ["claimed_units", value.claimedUnits],
        ["balance_units", value.balanceUnits],
        ["will_refuse_next_refill", value.willRefuseNextRefill],
        ["lease_expires_at", value.leaseExpiresAt],
        ["settlement_sequence", value.settlementSequence],
      ];
      for (const [column, fieldValue] of fields) {
        if (fieldValue === undefined) continue;
        params.push(fieldValue);
        sets.push(`${column} = $${params.length}`);
      }
      await pool.query(`UPDATE media.paid_operations SET ${sets.join(", ")} WHERE id = $1`, params);
    },

    async recordRetry(id, value) {
      await pool.query(
        `UPDATE media.paid_operations SET status = $2, retry_count = retry_count + 1,
           next_retry_at = $3, last_error_code = $4,
           updated_at = NOW() WHERE id = $1`,
        [id, value.status, value.nextRetryAt, value.errorCode],
      );
    },

    async recordTerminal(id, value) {
      await pool.query(
        `WITH terminal AS (
           UPDATE media.paid_operations SET status = $2, claimed_units = $3,
             settlement_sequence = $4, terminal_evidence = $5, terminal_at = $6,
             next_retry_at = NULL, last_error_code = NULL, updated_at = NOW()
           WHERE id = $1 RETURNING id
         )
         DELETE FROM media.paid_operation_secrets
         WHERE operation_id IN (SELECT id FROM terminal)`,
        [id, value.status, value.claimedUnits, value.settlementSequence, value.evidence, value.terminalAt],
      );
    },

    async putSecrets(id, value: PaidOperationSecrets) {
      const encrypted = secretCipher.encrypt(id, value);
      await pool.query(
        `INSERT INTO media.paid_operation_secrets
           (operation_id, key_id, wrapped_key, wrapped_key_iv, wrapped_key_tag,
            ciphertext, payload_iv, payload_tag)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (operation_id) DO UPDATE SET
           key_id = EXCLUDED.key_id, wrapped_key = EXCLUDED.wrapped_key,
           wrapped_key_iv = EXCLUDED.wrapped_key_iv,
           wrapped_key_tag = EXCLUDED.wrapped_key_tag,
           ciphertext = EXCLUDED.ciphertext, payload_iv = EXCLUDED.payload_iv,
           payload_tag = EXCLUDED.payload_tag, updated_at = NOW()`,
        [id, encrypted.keyId, encrypted.wrappedKey, encrypted.wrappedKeyIv,
          encrypted.wrappedKeyTag, encrypted.ciphertext, encrypted.payloadIv,
          encrypted.payloadTag],
      );
    },

    async readSecrets(id) {
      const result = await pool.query<SecretRow>(
        `SELECT key_id, wrapped_key, wrapped_key_iv, wrapped_key_tag, ciphertext,
           payload_iv, payload_tag FROM media.paid_operation_secrets
         WHERE operation_id = $1`,
        [id],
      );
      if (result.rowCount === 0) return null;
      return secretCipher.decrypt(id, encryptedFromRow(result.rows[0]!));
    },

    async deleteSecrets(id) {
      await pool.query(`DELETE FROM media.paid_operation_secrets WHERE operation_id = $1`, [id]);
    },
  };
}
