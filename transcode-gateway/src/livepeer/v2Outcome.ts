export type V2FailureCategory =
  | "caller"
  | "capacity"
  | "payment"
  | "backend"
  | "protocol"
  | "recovery"
  | "evidence";

export interface V2FailureClassification {
  code: string;
  category: V2FailureCategory;
  retryable: boolean;
  penalizeRoute: boolean;
}

const CLASSIFICATIONS: Record<string, Omit<V2FailureClassification, "code">> = {
  protocol_transport_unsupported: { category: "protocol", retryable: false, penalizeRoute: false },
  protocol_unsupported: { category: "protocol", retryable: false, penalizeRoute: false },
  capability_not_served: { category: "protocol", retryable: false, penalizeRoute: false },
  request_id_reuse: { category: "caller", retryable: false, penalizeRoute: false },
  idempotency_key_reuse: { category: "caller", retryable: false, penalizeRoute: false },
  job_in_flight: { category: "recovery", retryable: true, penalizeRoute: false },
  accounting_pending: { category: "recovery", retryable: true, penalizeRoute: false },
  idempotency_in_progress: { category: "recovery", retryable: true, penalizeRoute: false },
  idempotency_outcome_unknown: { category: "recovery", retryable: true, penalizeRoute: false },
  recipient_rotated: { category: "payment", retryable: true, penalizeRoute: false },
  rebind_refused: { category: "payment", retryable: false, penalizeRoute: false },
  refill_refused: { category: "payment", retryable: false, penalizeRoute: false },
  insufficient_balance: { category: "payment", retryable: false, penalizeRoute: false },
  cap_reached: { category: "payment", retryable: false, penalizeRoute: false },
  debit_failed: { category: "payment", retryable: false, penalizeRoute: false },
  admitted_evidence_expired: { category: "evidence", retryable: false, penalizeRoute: false },
  admitted_outcome_unknown: { category: "evidence", retryable: false, penalizeRoute: false },
  settlement_invalid: { category: "evidence", retryable: false, penalizeRoute: false },
  payment_invalid: { category: "payment", retryable: false, penalizeRoute: false },
  payment_envelope_mismatch: { category: "payment", retryable: false, penalizeRoute: false },
  daemon_unavailable: { category: "payment", retryable: true, penalizeRoute: false },
  backend_unavailable: { category: "backend", retryable: true, penalizeRoute: true },
  backend_timeout: { category: "backend", retryable: true, penalizeRoute: true },
  capacity_exhausted: { category: "capacity", retryable: true, penalizeRoute: true },
};

export function classifyV2Failure(code: string, status?: number): V2FailureClassification {
  const normalized = code.trim().toLowerCase();
  const known = CLASSIFICATIONS[normalized];
  if (known) return { code: normalized, ...known };
  if (status === 429) {
    return { code: normalized || "rate_limited", category: "capacity", retryable: true, penalizeRoute: true };
  }
  if (status === 408 || status === 425 || (status !== undefined && status >= 500)) {
    return { code: normalized || "backend_unavailable", category: "backend", retryable: true, penalizeRoute: true };
  }
  return { code: normalized || "protocol_failure", category: "protocol", retryable: false, penalizeRoute: false };
}

export interface V2Correlation {
  requestId?: string;
  locOperationId?: string;
  workId?: string;
  brokerJobId?: string;
  brokerSessionId?: string;
  gatewaySessionId?: string;
}

export function v2CorrelationContext(value: V2Correlation): Record<string, string> {
  const context: Record<string, string> = {};
  const entries = [
    ["request_id", value.requestId],
    ["loc_operation_id", value.locOperationId],
    ["work_id", value.workId],
    ["broker_job_id", value.brokerJobId],
    ["broker_session_id", value.brokerSessionId],
    ["gateway_session_id", value.gatewaySessionId],
  ] as const;
  for (const [key, candidate] of entries) {
    if (candidate !== undefined && candidate.length > 0) context[key] = candidate;
  }
  return context;
}
