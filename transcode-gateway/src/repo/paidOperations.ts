import type { DbPool } from "../db/pool.js";
import type {
  JsonValue,
  PaidOperation,
  PaidOperationKind,
  PaidOperationSecrets,
  PaidRouteSnapshot,
  PaidSessionRuntimeState,
} from "../engine/types/index.js";
import type {
  NewPaidOperation,
  PaidOperationClaim,
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
  lifecycle_version: string;
  recovery_owner: string | null;
  recovery_lease_expires_at: Date | null;
  session_runtime: PaidSessionRuntimeState | null;
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
  lifecycle_version, recovery_owner, recovery_lease_expires_at, session_runtime,
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
    lifecycleVersion: row.lifecycle_version,
    recoveryOwner: row.recovery_owner ?? undefined,
    recoveryLeaseExpiresAt: row.recovery_lease_expires_at ?? undefined,
    sessionRuntime: row.session_runtime ?? undefined,
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

function validateClaim(claim: PaidOperationClaim): void {
  if (
    claim.owner.length === 0 ||
    claim.owner.length > 255 ||
    !/^(?:0|[1-9][0-9]*)$/.test(claim.version) ||
    Number.isNaN(claim.leaseExpiresAt.getTime())
  ) {
    throw new Error("paid operation claim is invalid");
  }
}

function insertStatement(
  value: NewPaidOperation,
  claim?: Omit<PaidOperationClaim, "version">,
): { sql: string; params: unknown[] } {
  const columns = [
    "id",
    "operation_kind",
    "api_key_id",
    "asset_id",
    "live_stream_id",
    "request_id",
    "request_content_sha256",
    "work_id",
    "rotation_generation",
    "protocol",
    "transport",
    "capability",
    "offering",
    "request_descriptor",
    "response_descriptor",
    "work_unit",
    "estimator",
    "price_per_unit_wei",
    "units_per_price",
    "quote_id",
    "quote_version",
    "constraint_fingerprint",
    "route_fingerprint",
    "settlement_key",
    "route_snapshot",
    "status",
    "funded_units",
    "session_runtime",
    "recovery_owner",
    "recovery_lease_expires_at",
    "lifecycle_version",
  ];
  const params: unknown[] = [
    value.id,
    value.kind,
    value.apiKeyId,
    value.assetId ?? null,
    value.liveStreamId ?? null,
    value.requestId,
    value.requestContentSha256,
    value.workId,
    value.rotationGeneration ?? 0,
    value.route.protocol,
    value.route.transport ?? null,
    value.route.capability,
    value.route.offering,
    value.route.requestDescriptor,
    value.route.responseDescriptor ?? null,
    value.route.workUnit,
    value.route.estimator ?? null,
    value.route.pricePerUnitWei,
    value.route.unitsPerPrice,
    value.route.quoteId,
    value.route.quoteVersion,
    value.route.constraintFingerprint,
    value.route.routeFingerprint,
    value.route.settlementKey,
    value.route.raw,
    value.status,
    value.fundedUnits,
    value.sessionRuntime ?? null,
    claim?.owner ?? null,
    claim?.leaseExpiresAt ?? null,
    claim === undefined ? "0" : "1",
  ];
  const placeholders = params.map((_, index) => `$${index + 1}`).join(", ");
  return {
    sql: `INSERT INTO media.paid_operations (${columns.join(", ")})
		 VALUES (${placeholders}) RETURNING ${SELECT_COLUMNS}`,
    params,
  };
}

function encryptedParams(
  id: string,
  encrypted: EncryptedOperationSecrets,
): unknown[] {
  return [
    id,
    encrypted.keyId,
    encrypted.wrappedKey,
    encrypted.wrappedKeyIv,
    encrypted.wrappedKeyTag,
    encrypted.ciphertext,
    encrypted.payloadIv,
    encrypted.payloadTag,
  ];
}

const UPSERT_SECRETS = `INSERT INTO media.paid_operation_secrets
  (operation_id, key_id, wrapped_key, wrapped_key_iv, wrapped_key_tag,
   ciphertext, payload_iv, payload_tag)
 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
 ON CONFLICT (operation_id) DO UPDATE SET
   key_id = EXCLUDED.key_id, wrapped_key = EXCLUDED.wrapped_key,
   wrapped_key_iv = EXCLUDED.wrapped_key_iv,
   wrapped_key_tag = EXCLUDED.wrapped_key_tag,
   ciphertext = EXCLUDED.ciphertext, payload_iv = EXCLUDED.payload_iv,
   payload_tag = EXCLUDED.payload_tag, updated_at = NOW()`;

export function createPaidOperationRepo(
  pool: DbPool,
  secretCipher: OperationSecretCipher,
): PaidOperationRepo {
  return {
    async insert(value: NewPaidOperation) {
      const statement = insertStatement(value);
      const result = await pool.query<Row>(statement.sql, statement.params);
      return rowToOperation(result.rows[0]!);
    },

    async insertWithSecrets(value, secrets, claim) {
      validateClaim({ ...claim, version: "1" });
      const encrypted = secretCipher.encrypt(value.id, secrets);
      const statement = insertStatement(value, claim);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await client.query<Row>(statement.sql, statement.params);
        await client.query(
          UPSERT_SECRETS,
          encryptedParams(value.id, encrypted),
        );
        await client.query("COMMIT");
        return rowToOperation(result.rows[0]!);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
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

    async byLiveStreamId(liveStreamId) {
      const result = await pool.query<Row>(
        `SELECT ${SELECT_COLUMNS} FROM media.paid_operations
				 WHERE live_stream_id = $1 AND operation_kind = 'session'
				 ORDER BY rotation_generation DESC LIMIT 1`,
        [liveStreamId],
      );
      return result.rowCount === 0 ? null : rowToOperation(result.rows[0]!);
    },

    async byBrokerSessionId(brokerSessionId) {
      const result = await pool.query<Row>(
        `SELECT ${SELECT_COLUMNS} FROM media.paid_operations
         WHERE broker_session_id = $1 AND operation_kind = 'session'
         ORDER BY rotation_generation DESC LIMIT 1`,
        [brokerSessionId],
      );
      return result.rowCount === 0 ? null : rowToOperation(result.rows[0]!);
    },

    async claimRecoverable(kind, owner, now, leaseExpiresAt, limit) {
      validateClaim({ owner, version: "0", leaseExpiresAt });
      if (
        (kind !== "job" && kind !== "session") ||
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        limit > 1_000 ||
        leaseExpiresAt <= now
      ) {
        throw new Error("recovery claim inputs are invalid");
      }
      const result = await pool.query<Row>(
				`WITH candidates AS (
				   SELECT id FROM media.paid_operations
				   WHERE operation_kind = $1 AND terminal_at IS NULL
				     AND (next_retry_at IS NULL OR next_retry_at <= $3)
				     AND (recovery_lease_expires_at IS NULL OR recovery_lease_expires_at <= $3)
				   ORDER BY updated_at ASC
				   FOR UPDATE SKIP LOCKED LIMIT $5
				 )
				 UPDATE media.paid_operations AS operation
				 SET recovery_owner = $2, recovery_lease_expires_at = $4,
				     lifecycle_version = lifecycle_version + 1, updated_at = NOW()
				 FROM candidates WHERE operation.id = candidates.id
				 RETURNING operation.*`,
        [kind, owner, now, leaseExpiresAt, limit],
      );
      return result.rows.map(rowToOperation);
    },

    async renewClaim(id, claim, leaseExpiresAt) {
      validateClaim(claim);
      if (
        Number.isNaN(leaseExpiresAt.getTime()) ||
        leaseExpiresAt <= claim.leaseExpiresAt
      ) {
        throw new Error("recovery lease extension is invalid");
      }
      const result = await pool.query<Row>(
        `UPDATE media.paid_operations
				 SET recovery_lease_expires_at = $5, lifecycle_version = lifecycle_version + 1,
				     updated_at = NOW()
				 WHERE id = $1 AND recovery_owner = $2 AND lifecycle_version = $3
				   AND recovery_lease_expires_at = $4 AND recovery_lease_expires_at > NOW()
				   AND terminal_at IS NULL
				 RETURNING ${SELECT_COLUMNS}`,
        [id, claim.owner, claim.version, claim.leaseExpiresAt, leaseExpiresAt],
      );
      return result.rowCount === 0 ? null : rowToOperation(result.rows[0]!);
    },

    async releaseClaim(id, claim) {
      validateClaim(claim);
      const result = await pool.query<{ id: string }>(
        `UPDATE media.paid_operations
				 SET recovery_owner = NULL, recovery_lease_expires_at = NULL,
				     lifecycle_version = lifecycle_version + 1, updated_at = NOW()
				 WHERE id = $1 AND recovery_owner = $2 AND lifecycle_version = $3
				   AND recovery_lease_expires_at = $4
				 RETURNING id`,
        [id, claim.owner, claim.version, claim.leaseExpiresAt],
      );
      return (result.rowCount ?? 0) > 0;
    },

    async recordProgress(id, claim, value: PaidOperationProgress) {
      validateClaim(claim);
      const sets = [
        "status = $2",
        "updated_at = NOW()",
        "last_error_code = NULL",
      ];
      const params: unknown[] = [id, value.status];
      const fields: Array<[string, unknown]> = [
        ["request_id", value.requestId],
        ["loc_operation_id", value.locOperationId],
        ["broker_job_id", value.brokerJobId],
        ["broker_session_id", value.brokerSessionId],
        ["funded_units", value.fundedUnits],
        ["claimed_units", value.claimedUnits],
        ["balance_units", value.balanceUnits],
        ["will_refuse_next_refill", value.willRefuseNextRefill],
        ["lease_expires_at", value.leaseExpiresAt],
        ["settlement_sequence", value.settlementSequence],
        ["session_runtime", value.sessionRuntime],
      ];
      for (const [column, fieldValue] of fields) {
        if (fieldValue === undefined) continue;
        params.push(fieldValue);
        sets.push(`${column} = $${params.length}`);
      }
      params.push(claim.owner, claim.version, claim.leaseExpiresAt);
      sets.push("lifecycle_version = lifecycle_version + 1");
      const result = await pool.query<Row>(
        `UPDATE media.paid_operations SET ${sets.join(", ")}
				 WHERE id = $1 AND recovery_owner = $${params.length - 2}
				   AND lifecycle_version = $${params.length - 1}
				   AND recovery_lease_expires_at = $${params.length}
				   AND recovery_lease_expires_at > NOW()
				 RETURNING ${SELECT_COLUMNS}`,
        params,
      );
      return result.rowCount === 0 ? null : rowToOperation(result.rows[0]!);
    },

    async recordRetry(id, claim, value) {
      validateClaim(claim);
      const result = await pool.query<Row>(
        `UPDATE media.paid_operations SET status = $2, retry_count = retry_count + 1,
           next_retry_at = $3, last_error_code = $4,
				 lifecycle_version = lifecycle_version + 1, updated_at = NOW()
				 WHERE id = $1 AND recovery_owner = $5 AND lifecycle_version = $6
				   AND recovery_lease_expires_at = $7 AND recovery_lease_expires_at > NOW()
				 RETURNING ${SELECT_COLUMNS}`,
        [
          id,
          value.status,
          value.nextRetryAt,
          value.errorCode,
          claim.owner,
          claim.version,
          claim.leaseExpiresAt,
        ],
      );
      return result.rowCount === 0 ? null : rowToOperation(result.rows[0]!);
    },

    async recordTerminal(id, claim, value) {
      validateClaim(claim);
      const result = await pool.query<{ id: string }>(
        `WITH terminal AS (
           UPDATE media.paid_operations SET status = $2, claimed_units = $3,
             settlement_sequence = $4, terminal_evidence = $5, terminal_at = $6,
				 next_retry_at = NULL, last_error_code = NULL, updated_at = NOW(),
				 lifecycle_version = lifecycle_version + 1,
				 recovery_owner = NULL, recovery_lease_expires_at = NULL
				 WHERE id = $1 AND recovery_owner = $7 AND lifecycle_version = $8
				   AND recovery_lease_expires_at = $9 AND recovery_lease_expires_at > NOW()
				 RETURNING id
			 ), erased AS (
			   DELETE FROM media.paid_operation_secrets
			   WHERE operation_id IN (SELECT id FROM terminal)
			   RETURNING operation_id
         )
			 SELECT id FROM terminal`,
        [
          id,
          value.status,
          value.claimedUnits,
          value.settlementSequence,
          value.evidence,
          value.terminalAt,
          claim.owner,
          claim.version,
          claim.leaseExpiresAt,
        ],
      );
      return (result.rowCount ?? 0) > 0;
    },

    async recordVodTerminal(id, claim, value) {
      validateClaim(claim);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const terminal = await client.query<{ id: string }>(
          `UPDATE media.paid_operations SET status = 'settled', claimed_units = $2,
             settlement_sequence = $3, terminal_evidence = $4, terminal_at = $5,
             loc_operation_id = $10, broker_job_id = $11, request_id = $12,
             next_retry_at = NULL, last_error_code = NULL, updated_at = NOW(),
             lifecycle_version = lifecycle_version + 1,
             recovery_owner = NULL, recovery_lease_expires_at = NULL
           WHERE id = $1 AND asset_id = $6 AND recovery_owner = $7
             AND lifecycle_version = $8 AND recovery_lease_expires_at = $9
             AND recovery_lease_expires_at > NOW() AND terminal_at IS NULL
           RETURNING id`,
          [
            id,
            value.claimedUnits,
            value.settlementSequence,
            value.evidence,
            value.terminalAt,
            value.assetId,
            claim.owner,
            claim.version,
            claim.leaseExpiresAt,
            value.locOperationId,
            value.brokerJobId,
            value.brokerRequestId,
          ],
        );
        if (terminal.rowCount === 0) {
          await client.query("ROLLBACK");
          return false;
        }
        for (const rendition of value.renditions) {
          const updated = await client.query(
            `UPDATE media.renditions SET status = 'completed', storage_key = $3,
               duration_sec = $4, completed_at = $5
             WHERE id = $1 AND asset_id = $2 AND status IN ('queued', 'running')`,
            [rendition.renditionId, value.assetId, rendition.storageKey, rendition.durationSeconds, value.terminalAt],
          );
          if (updated.rowCount !== 1) throw new Error("terminal rendition identity mismatch");
        }
        const completedJob = await client.query(
          `UPDATE media.encoding_jobs SET status = 'completed', completed_at = $3
           WHERE id = $1 AND asset_id = $2`,
          [value.encodingJobId, value.assetId, value.terminalAt],
        );
        if (completedJob.rowCount !== 1) throw new Error("terminal encoding job identity mismatch");
        const readyAsset = await client.query(
          `UPDATE media.assets SET status = 'ready', ready_at = $2 WHERE id = $1`,
          [value.assetId, value.terminalAt],
        );
        if (readyAsset.rowCount !== 1) throw new Error("terminal asset identity mismatch");
        await client.query(
          `INSERT INTO media.playback_ids
             (id, api_key_id, asset_id, live_stream_id, policy, token_required)
           SELECT $1, $2, $3, NULL, 'public', false
           WHERE NOT EXISTS (SELECT 1 FROM media.playback_ids WHERE asset_id = $3)`,
          [value.playbackId, value.apiKeyId, value.assetId],
        );
        await client.query(
          `DELETE FROM media.paid_operation_secrets WHERE operation_id = $1`,
          [id],
        );
        await client.query("COMMIT");
        return true;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },

    async putSecrets(id, claim, value: PaidOperationSecrets) {
      validateClaim(claim);
      const encrypted = secretCipher.encrypt(id, value);
      const result = await pool.query<{ operation_id: string }>(
        `INSERT INTO media.paid_operation_secrets
           (operation_id, key_id, wrapped_key, wrapped_key_iv, wrapped_key_tag,
            ciphertext, payload_iv, payload_tag)
			 SELECT $1, $2, $3, $4, $5, $6, $7, $8
			 WHERE EXISTS (
			   SELECT 1 FROM media.paid_operations WHERE id = $1
			     AND recovery_owner = $9 AND lifecycle_version = $10
			     AND recovery_lease_expires_at = $11 AND recovery_lease_expires_at > NOW()
			 )
         ON CONFLICT (operation_id) DO UPDATE SET
           key_id = EXCLUDED.key_id, wrapped_key = EXCLUDED.wrapped_key,
           wrapped_key_iv = EXCLUDED.wrapped_key_iv,
           wrapped_key_tag = EXCLUDED.wrapped_key_tag,
           ciphertext = EXCLUDED.ciphertext, payload_iv = EXCLUDED.payload_iv,
				 payload_tag = EXCLUDED.payload_tag, updated_at = NOW()
			 RETURNING operation_id`,
        [
          ...encryptedParams(id, encrypted),
          claim.owner,
          claim.version,
          claim.leaseExpiresAt,
        ],
      );
      return (result.rowCount ?? 0) > 0;
    },

    async readSecrets(id, claim) {
      validateClaim(claim);
      const result = await pool.query<SecretRow>(
        `SELECT key_id, wrapped_key, wrapped_key_iv, wrapped_key_tag, ciphertext,
				 payload_iv, payload_tag FROM media.paid_operation_secrets AS secrets
			 JOIN media.paid_operations AS operation ON operation.id = secrets.operation_id
			 WHERE secrets.operation_id = $1 AND operation.recovery_owner = $2
			   AND operation.lifecycle_version = $3
			   AND operation.recovery_lease_expires_at = $4
			   AND operation.recovery_lease_expires_at > NOW()`,
        [id, claim.owner, claim.version, claim.leaseExpiresAt],
      );
      if (result.rowCount === 0) return null;
      return secretCipher.decrypt(id, encryptedFromRow(result.rows[0]!));
    },

    async deleteSecrets(id, claim) {
      validateClaim(claim);
      const result = await pool.query(
        `DELETE FROM media.paid_operation_secrets AS secrets
				 USING media.paid_operations AS operation
				 WHERE secrets.operation_id = $1 AND operation.id = secrets.operation_id
				   AND operation.recovery_owner = $2 AND operation.lifecycle_version = $3
				   AND operation.recovery_lease_expires_at = $4
				   AND operation.recovery_lease_expires_at > NOW()`,
        [id, claim.owner, claim.version, claim.leaseExpiresAt],
      );
      return (result.rowCount ?? 0) > 0;
    },
  };
}
