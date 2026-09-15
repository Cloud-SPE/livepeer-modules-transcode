import { z } from "zod";
import type {
  LocClient,
  LocOpenJobInput,
  LocOpenJobResult,
  LocOpenSessionInput,
  LocOpenSessionResult,
  LocPrepareSessionInput,
  LocPrepareSessionResult,
  LocRouteBinding,
  LocRouteSnapshot,
  LocCloseSessionInput,
  LocCloseSessionResult,
  LocRefillSessionInput,
  LocRefillSessionResult,
  LocSessionStatus,
  LocSettleJobInput,
  LocSettleJobResult,
  LocTransport,
} from "../engine/interfaces/index.js";
import type { JsonValue, SelectedWorkerRoute } from "../engine/types/index.js";
import { LocTransportError } from "../engine/interfaces/index.js";
import {
  parseRouteProtocolDeclaration,
  parseSettlementKeys,
  parseWorkUnitEstimator,
} from "./routeProtocol.js";

const UINT64_MAX = 18_446_744_073_709_551_615n;
const canonicalUint64 = z
  .string()
  .regex(/^(0|[1-9][0-9]*)$/)
  .refine((value) => BigInt(value) <= UINT64_MAX);
const positiveUint64 = canonicalUint64.refine((value) => value !== "0");
const weiDecimal = z.string().regex(/^(0|[1-9][0-9]*)$/);
const fingerprint = z.string().regex(/^[0-9a-f]{64}$/);
const httpUrl = z.string().url().refine((value) => {
  const url = new URL(value);
  return (
    (url.protocol === "http:" || url.protocol === "https:") &&
    url.username === "" &&
    url.password === ""
  );
});
const routeBindingWire = z
  .object({
    quote_id: z.string().min(1),
    quote_version: positiveUint64,
    constraint_fingerprint: fingerprint,
    route_fingerprint: fingerprint,
    settlement_domain_id: z.string().regex(/^0x[0-9a-f]{64}$/),
  })
  .strict();
const settlementKeyWire = z
  .object({
    public_key: z.string().min(1),
    not_before: z.string().min(1),
    expires_at: z.string().min(1),
    introduced_in_publication_seq: canonicalUint64,
  })
  .strict();
const estimatorWire = z
  .object({
    id: z.string().min(1),
    rounding: z.string().min(1),
    exactness: z.string().min(1),
    package: z.string().min(1).nullable().optional(),
    fixtures: z.string().min(1),
  })
  .strict();
const routeSnapshotWire = z
  .object({
    schema_version: z.literal("route-snapshot/v1"),
    broker_url: httpUrl,
    eth_address: z.string().min(1),
    capability: z.string().min(1),
    offering: z.string().min(1),
    protocol: z.enum(["paid-job/v1", "paid-session/v1"]),
    work_unit: z.string().min(1),
    price_per_work_unit_wei: z.string().regex(/^(0|[1-9][0-9]*)$/),
    units_per_price: positiveUint64,
    quote_id: z.string().min(1),
    quote_version: positiveUint64,
    constraint_fingerprint: fingerprint,
    route_fingerprint: fingerprint,
    settlement_domain_id: z.string().regex(/^0x[0-9a-f]{64}$/),
    settlement_keys: z.array(settlementKeyWire).min(1),
    work_unit_estimator: estimatorWire.nullable().optional(),
    job: z.unknown().nullable().optional(),
    session: z.unknown().nullable().optional(),
    extra: z.unknown().optional(),
  })
  .strict();
const commonOpen = {
  request_id: z.string().min(1),
  work_id: z.string().min(1),
  broker_url: httpUrl,
  route_snapshot: routeSnapshotWire,
  spend_authorization: z.string().min(1),
  payment_envelope: z.string().min(1).nullable().optional(),
  accounting_mode: z.literal("wholesale_account"),
  expected_value_wei: weiDecimal,
  funded_value_wei: weiDecimal,
  opened_at: z.string().min(1),
};
const prepareSessionWire = z.object({
  gateway_session_id: z.string().uuid(),
  route_binding: routeBindingWire,
  broker_url: httpUrl,
  preparation_token: z.string().min(1),
  expires_at: z.string().min(1),
}).strict();
const jobOpenWire = z
  .object({
    ...commonOpen,
    job_id: z.string().uuid(),
    protocol: z.literal("paid-job/v1"),
    transport: z.enum(["unary", "stream", "multipart"]),
    work_unit: z.string().min(1),
    settle_endpoint: z.string().min(1),
  })
  .strict();
const sessionOpenWire = z
  .object({
    ...commonOpen,
    session_id: z.string().uuid(),
    protocol: z.literal("paid-session/v1"),
    session: z.unknown(),
    refill_endpoint: z.string().min(1),
    close_endpoint: z.string().min(1),
  })
  .strict();
const settlementEnvelopeWire = z
  .object({
    payload: z.record(z.string(), z.json()),
    signature: z
      .object({
        algorithm: z.literal("secp256k1"),
        canonicalization: z.literal("jcs"),
        value: z.string().regex(/^0x[0-9a-fA-F]{130}$/),
      })
      .strict(),
  })
  .strict();
const settleJobWire = z
  .object({
    job_id: z.string().uuid(),
    work_id: z.string().min(1),
    actual_units: z.number().int().nonnegative(),
    billed_value_wei: weiDecimal,
    refund_wei: weiDecimal,
    outcome: z.string().min(1),
    closed_at: z.string().min(1),
    cap_status: z.unknown(),
  })
  .strict();
const capStatusWire = z
  .object({
    session_pct_used: z.number().min(0).max(1),
    spend_period_pct_used: z.number().min(0).max(1).nullable(),
    user_balance_pct_used: z.number().min(0).max(1).nullable(),
    operator_pool_pct_used: z.number().min(0).max(1).nullable(),
    will_refuse_next_refill: z.boolean(),
    winddown_reason: z.string().nullable(),
  })
  .strict();
const refillSessionWire = z
  .object({
    work_id: z.string().min(1),
    request_id: z.string().min(1),
    refill_seq: z.number().int().nonnegative(),
    spend_authorization: z.string().min(1),
    payment_envelope: z.string().min(1).nullable().optional(),
    accounting_mode: z.literal("wholesale_account"),
    expected_value_wei: weiDecimal,
    funded_value_wei: weiDecimal,
    cap_status: capStatusWire,
  })
  .strict();
const sessionStatusWire = z
  .object({
    session_id: z.string().uuid(),
    work_id: z.string().min(1),
    capability: z.string().min(1),
    offering: z.string().min(1),
    protocol: z.literal("paid-session/v1"),
    state: z.string().min(1),
    estimated_units: z.number().int().positive(),
    max_total_units: z.number().int().positive(),
    funded_value_wei: weiDecimal,
    billed_value_wei: weiDecimal,
    refill_count: z.number().int().nonnegative(),
    cap_status: capStatusWire.nullable(),
    opened_at: z.string().min(1),
    closed_at: z.string().nullable(),
    actual_units: z.number().int().nonnegative().nullable(),
    outcome: z.string().nullable(),
  })
  .strict();
const closeSessionWire = z
  .object({
    session_id: z.string().uuid(),
    work_id: z.string().min(1),
    actual_units: z.number().int().nonnegative(),
    billed_value_wei: weiDecimal,
    refund_wei: weiDecimal,
    outcome: z.string().min(1),
    closed_at: z.string().min(1),
  })
  .strict();

export function routeBindingFor(route: SelectedWorkerRoute): LocRouteBinding {
  if (
    !route.quoteId ||
    !route.quoteVersion ||
    !route.constraintFingerprint ||
    !route.routeFingerprint ||
    !route.settlementDomainId
  ) {
    throw invalidRequest();
  }
  const candidate = {
    quote_id: route.quoteId,
    quote_version: route.quoteVersion,
    constraint_fingerprint: hexFingerprint(route.constraintFingerprint),
    route_fingerprint: hexFingerprint(route.routeFingerprint),
    settlement_domain_id: route.settlementDomainId,
  };
  const parsed = routeBindingWire.safeParse(candidate);
  if (!parsed.success) throw invalidRequest();
  return bindingFromWire(parsed.data);
}

export function createLocClient(transport: LocTransport): LocClient {
  return {
    async openJob(input) {
      validateOpenUnits(input.estimatedUnits, input.maxTotalUnits);
      const routeBinding = bindingToWire(input.routeBinding);
      const response = await transport.request({
        method: "POST",
        path: "/v1/jobs",
        idempotencyKey: input.requestId,
        body: {
          capability: input.capability,
          offering: input.offering,
          transport: input.transport,
          estimated_units: input.estimatedUnits,
          ...(input.maxTotalUnits === undefined
            ? {}
            : { max_total_units: input.maxTotalUnits }),
          route_binding: routeBinding,
          workload_request_digest: input.workloadRequestDigest,
          caller_public_key: input.callerPublicKey,
        },
        schema: jobOpenWire,
      });
      return mapJobOpen(response, input);
    },

    async prepareSession(input) {
      const response = await transport.request({
        method: "POST",
        path: "/v1/sessions/prepare",
        idempotencyKey: `${input.requestId}:prepare`,
        body: {
          capability: input.capability,
          offering: input.offering,
          descriptor_schema: input.descriptorSchema,
          route_binding: bindingToWire(input.routeBinding),
        },
        schema: prepareSessionWire,
      });
      return mapPreparedSession(response, input);
    },

    async settleJob(input) {
      validateSettleJob(input);
      const response = await transport.request({
        method: "POST",
        path: `/v1/jobs/${encodeURIComponent(input.operationId)}/settle`,
        idempotencyKey: `settle:${input.operationId}`,
        body: {
          actual_units: input.actualUnits,
          broker_job_id: input.brokerJobId,
          work_unit: input.workUnit,
          outcome: input.outcome,
          settlement: input.settlement,
        },
        schema: settleJobWire,
      });
      return mapJobSettlement(response, input);
    },

    async openSession(input) {
      validateOpenUnits(input.estimatedRunwayUnits, input.maxTotalUnits);
      const routeBinding = bindingToWire(input.routeBinding);
      const response = await transport.request({
        method: "POST",
        path: "/v1/sessions",
        idempotencyKey: input.requestId,
        body: {
          capability: input.capability,
          offering: input.offering,
          descriptor_schema: input.descriptorSchema,
          session_params: input.sessionParams,
          estimated_runway_units: input.estimatedRunwayUnits,
          max_total_units: input.maxTotalUnits,
          route_binding: routeBinding,
          gateway_session_id: input.gatewaySessionId,
          preparation_token: input.preparationToken,
          workload_request_digest: input.workloadRequestDigest,
          caller_public_key: input.callerPublicKey,
        },
        schema: sessionOpenWire,
      });
      return mapSessionOpen(response, input);
    },

    async refillSession(input) {
      validateRefill(input);
      const response = await transport.request({
        method: "POST",
        path: `/v1/sessions/${encodeURIComponent(input.operationId)}/refill`,
        idempotencyKey: input.requestId,
        body: {
          ...(input.observedConsumedUnits === undefined
            ? {}
            : { observed_consumed_units: input.observedConsumedUnits }),
          max_total_units: input.maxTotalUnits,
          workload_request_digest: input.workloadRequestDigest,
        },
        schema: refillSessionWire,
      });
      return mapRefill(response, input);
    },

    async getSession(operationId) {
      if (!z.string().uuid().safeParse(operationId).success) throw invalidRequest();
      const response = await transport.request({
        method: "GET",
        path: `/v1/sessions/${encodeURIComponent(operationId)}`,
        schema: sessionStatusWire,
      });
      return mapSessionStatus(response, operationId);
    },

    async closeSession(input) {
      validateClose(input);
      const response = await transport.request({
        method: "POST",
        path: `/v1/sessions/${encodeURIComponent(input.operationId)}/close`,
        idempotencyKey: `close:${input.operationId}`,
        body: {
          actual_units: input.actualUnits,
          outcome: input.outcome,
          settlement: input.settlement,
        },
        schema: closeSessionWire,
      });
      return mapClose(response, input);
    },
  };
}

function mapRefill(
  value: z.infer<typeof refillSessionWire>,
  input: LocRefillSessionInput,
): LocRefillSessionResult {
  return {
    workId: value.work_id,
    requestId: value.request_id,
    refillSequence: value.refill_seq,
    spendAuthorization: value.spend_authorization,
    paymentEnvelope: value.payment_envelope ?? null,
    expectedValueWei: value.expected_value_wei,
    fundedValueWei: value.funded_value_wei,
    capStatus: mapCapStatus(value.cap_status),
  };
}

function mapPreparedSession(
  value: z.infer<typeof prepareSessionWire>,
  input: LocPrepareSessionInput,
): LocPrepareSessionResult {
  if (!sameBinding(bindingFromWire(value.route_binding), input.routeBinding)) throw invalidResponse();
  return {
    gatewaySessionId: value.gateway_session_id,
    routeBinding: bindingFromWire(value.route_binding),
    brokerUrl: value.broker_url,
    preparationToken: value.preparation_token,
    expiresAt: value.expires_at,
  };
}

function mapSessionStatus(
  value: z.infer<typeof sessionStatusWire>,
  operationId: string,
): LocSessionStatus {
  if (value.session_id !== operationId) throw invalidResponse();
  return {
    operationId: value.session_id,
    workId: value.work_id,
    state: value.state,
    fundedValueWei: value.funded_value_wei,
    billedValueWei: value.billed_value_wei,
    refillCount: value.refill_count,
    capStatus: value.cap_status === null ? null : mapCapStatus(value.cap_status),
    actualUnits: value.actual_units,
    outcome: value.outcome,
    closedAt: value.closed_at,
  };
}

function mapClose(
  value: z.infer<typeof closeSessionWire>,
  input: LocCloseSessionInput,
): LocCloseSessionResult {
  if (
    value.session_id !== input.operationId ||
    value.actual_units !== input.actualUnits ||
    value.outcome !== input.outcome
  ) throw invalidResponse();
  return {
    operationId: value.session_id,
    workId: value.work_id,
    actualUnits: value.actual_units,
    billedValueWei: value.billed_value_wei,
    refundWei: value.refund_wei,
    outcome: value.outcome,
    closedAt: value.closed_at,
  };
}

function mapCapStatus(value: z.infer<typeof capStatusWire>) {
  return {
    sessionPctUsed: value.session_pct_used,
    spendPeriodPctUsed: value.spend_period_pct_used,
    userBalancePctUsed: value.user_balance_pct_used,
    operatorPoolPctUsed: value.operator_pool_pct_used,
    willRefuseNextRefill: value.will_refuse_next_refill,
    winddownReason: value.winddown_reason,
  };
}

function mapJobSettlement(
  value: z.infer<typeof settleJobWire>,
  input: LocSettleJobInput,
): LocSettleJobResult {
  if (
    value.job_id !== input.operationId ||
    value.actual_units !== input.actualUnits ||
    value.outcome !== input.outcome
  ) {
    throw invalidResponse();
  }
  return {
    operationId: value.job_id,
    workId: value.work_id,
    actualUnits: value.actual_units,
    billedValueWei: value.billed_value_wei,
    refundWei: value.refund_wei,
    outcome: value.outcome,
    closedAt: value.closed_at,
  };
}

function mapJobOpen(
  value: z.infer<typeof jobOpenWire>,
  input: LocOpenJobInput,
): LocOpenJobResult {
  const routeSnapshot = mapRouteSnapshot(value.route_snapshot);
  requireSnapshot(input, routeSnapshot, "paid-job/v1");
  if (
    value.broker_url !== routeSnapshot.brokerUrl ||
    value.work_unit !== routeSnapshot.workUnit ||
    value.transport !== input.transport ||
    !routeSnapshot.job?.transports.includes(input.transport) ||
    value.settle_endpoint !== `/v1/jobs/${value.job_id}/settle`
  ) {
    throw invalidResponse();
  }
  return {
    operationId: value.job_id,
    requestId: value.request_id,
    workId: value.work_id,
    brokerUrl: value.broker_url,
    protocol: value.protocol,
    transport: value.transport,
    workUnit: value.work_unit,
    routeSnapshot,
    spendAuthorization: value.spend_authorization,
    paymentEnvelope: value.payment_envelope ?? null,
    expectedValueWei: value.expected_value_wei,
    fundedValueWei: value.funded_value_wei,
    settleEndpoint: value.settle_endpoint,
    openedAt: value.opened_at,
  };
}

function mapSessionOpen(
  value: z.infer<typeof sessionOpenWire>,
  input: LocOpenSessionInput,
): LocOpenSessionResult {
  const routeSnapshot = mapRouteSnapshot(value.route_snapshot);
  requireSnapshot(input, routeSnapshot, "paid-session/v1");
  const declaration = parseRouteProtocolDeclaration("paid-session/v1", {
    session: jsonValue(value.session),
  });
  if (
    !declaration?.session ||
    value.broker_url !== routeSnapshot.brokerUrl ||
    declaration.session.descriptorSchema !== input.descriptorSchema ||
    !sameJson(declaration.session, routeSnapshot.session) ||
    value.refill_endpoint !== `/v1/sessions/${value.session_id}/refill` ||
    value.close_endpoint !== `/v1/sessions/${value.session_id}/close`
  ) {
    throw invalidResponse();
  }
  return {
    operationId: value.session_id,
    gatewaySessionId: input.gatewaySessionId,
    requestId: value.request_id,
    workId: value.work_id,
    brokerUrl: value.broker_url,
    protocol: value.protocol,
    session: declaration.session,
    routeSnapshot,
    spendAuthorization: value.spend_authorization,
    paymentEnvelope: value.payment_envelope ?? null,
    expectedValueWei: value.expected_value_wei,
    fundedValueWei: value.funded_value_wei,
    refillEndpoint: value.refill_endpoint,
    closeEndpoint: value.close_endpoint,
    openedAt: value.opened_at,
  };
}

function mapRouteSnapshot(value: z.infer<typeof routeSnapshotWire>): LocRouteSnapshot {
  const axes = parseRouteProtocolDeclaration(value.protocol, {
    ...(value.job === undefined || value.job === null
      ? {}
      : { job: jsonValue(value.job) }),
    ...(value.session === undefined || value.session === null
      ? {}
      : { session: jsonValue(value.session) }),
  });
  const settlementKeys = parseSettlementKeys(value.settlement_keys);
  const estimator =
    value.work_unit_estimator === undefined || value.work_unit_estimator === null
      ? null
      : parseWorkUnitEstimator(value.work_unit_estimator);
  if (
    !axes ||
    !settlementKeys ||
    settlementKeys.length === 0 ||
    (value.work_unit_estimator && !estimator)
  ) {
    throw invalidResponse();
  }
  return {
    schemaVersion: value.schema_version,
    brokerUrl: value.broker_url,
    ethAddress: value.eth_address,
    capability: value.capability,
    offering: value.offering,
    protocol: value.protocol,
    workUnit: value.work_unit,
    pricePerWorkUnitWei: value.price_per_work_unit_wei,
    unitsPerPrice: value.units_per_price,
    binding: bindingFromWire({
      quote_id: value.quote_id,
      quote_version: value.quote_version,
      constraint_fingerprint: value.constraint_fingerprint,
      route_fingerprint: value.route_fingerprint,
      settlement_domain_id: value.settlement_domain_id,
    }),
    settlementDomainId: value.settlement_domain_id,
    settlementKeys,
    workUnitEstimator: estimator,
    job: axes.job,
    session: axes.session,
    extra: jsonValue(value.extra ?? {}),
    raw: jsonValue(value),
  };
}

function requireSnapshot(
  input: { capability: string; offering: string; routeBinding: LocRouteBinding },
  snapshot: LocRouteSnapshot,
  protocol: LocRouteSnapshot["protocol"],
): void {
  if (
    snapshot.capability !== input.capability ||
    snapshot.offering !== input.offering ||
    snapshot.protocol !== protocol ||
    !sameBinding(snapshot.binding, input.routeBinding)
  ) {
    throw invalidResponse();
  }
}

function bindingToWire(value: LocRouteBinding): z.infer<typeof routeBindingWire> {
  const parsed = routeBindingWire.safeParse({
    quote_id: value.quoteId,
    quote_version: value.quoteVersion,
    constraint_fingerprint: value.constraintFingerprint,
    route_fingerprint: value.routeFingerprint,
    settlement_domain_id: value.settlementDomainId,
  });
  if (!parsed.success) throw invalidRequest();
  return parsed.data;
}

function bindingFromWire(value: z.infer<typeof routeBindingWire>): LocRouteBinding {
  return {
    quoteId: value.quote_id,
    quoteVersion: value.quote_version,
    constraintFingerprint: value.constraint_fingerprint,
    routeFingerprint: value.route_fingerprint,
    settlementDomainId: value.settlement_domain_id,
  };
}

function validateOpenUnits(estimated: number, maximum: number | undefined): void {
  if (
    !Number.isSafeInteger(estimated) ||
    estimated < 1 ||
    (maximum !== undefined &&
      (!Number.isSafeInteger(maximum) || maximum < estimated))
  ) {
    throw invalidRequest();
  }
}

function validateSettleJob(input: LocSettleJobInput): void {
  if (
    !z.string().uuid().safeParse(input.operationId).success ||
    !Number.isSafeInteger(input.actualUnits) ||
    input.actualUnits < 0 ||
    input.brokerJobId.length === 0 ||
    input.workUnit.length === 0 ||
    input.outcome.length === 0 ||
    !settlementEnvelopeWire.safeParse(input.settlement).success
  ) {
    throw invalidRequest();
  }
}

function validateRefill(input: LocRefillSessionInput): void {
  if (
    !z.string().uuid().safeParse(input.operationId).success ||
    input.requestId.length === 0 ||
    (input.observedConsumedUnits !== undefined &&
      (!Number.isSafeInteger(input.observedConsumedUnits) || input.observedConsumedUnits < 0)) ||
    !Number.isSafeInteger(input.maxTotalUnits) ||
    input.maxTotalUnits < 1 ||
    !fingerprint.safeParse(input.workloadRequestDigest).success
  ) throw invalidRequest();
}

function validateClose(input: LocCloseSessionInput): void {
  if (
    !z.string().uuid().safeParse(input.operationId).success ||
    !Number.isSafeInteger(input.actualUnits) ||
    input.actualUnits < 0 ||
    input.outcome.length === 0 ||
    !settlementEnvelopeWire.safeParse(input.settlement).success
  ) throw invalidRequest();
}

function hexFingerprint(value: Uint8Array): string {
  return value.length === 32 ? Buffer.from(value).toString("hex") : "";
}

function jsonValue(value: unknown): JsonValue {
  if (!isJsonValue(value)) throw invalidResponse();
  return value;
}

function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  return (
    typeof value === "object" &&
    Object.values(value as Record<string, unknown>).every(isJsonValue)
  );
}

function sameJson(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length &&
      left.every((value, index) => sameJson(value, right[index]))
    );
  }
  if (
    left === null ||
    right === null ||
    typeof left !== "object" ||
    typeof right !== "object" ||
    Array.isArray(left) ||
    Array.isArray(right)
  ) {
    return false;
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord).sort();
  const rightKeys = Object.keys(rightRecord).sort();
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key, index) =>
        key === rightKeys[index] && sameJson(leftRecord[key], rightRecord[key]),
    )
  );
}

function sameBinding(left: LocRouteBinding, right: LocRouteBinding): boolean {
  return (
    left.quoteId === right.quoteId &&
    left.quoteVersion === right.quoteVersion &&
    left.constraintFingerprint === right.constraintFingerprint &&
    left.routeFingerprint === right.routeFingerprint &&
    left.settlementDomainId === right.settlementDomainId
  );
}

function invalidRequest(): LocTransportError {
  return new LocTransportError("loc_request_invalid", { retryable: false });
}

function invalidResponse(): LocTransportError {
  return new LocTransportError("loc_response_invalid", { retryable: false });
}
