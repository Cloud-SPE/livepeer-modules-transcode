import type { PaidOperation } from "../engine/types/index.js";

function iso(value?: Date): string | null {
  return value?.toISOString() ?? null;
}

function warnings(operation: PaidOperation, now: Date): string[] {
  const result: string[] = [];
  if (operation.willRefuseNextRefill) result.push("refill_will_be_refused");
  if (operation.balanceUnits === "0" && !operation.terminalAt) result.push("funded_balance_exhausted");
  if (operation.leaseExpiresAt && operation.leaseExpiresAt <= now && !operation.terminalAt) {
    result.push("lease_expired");
  }
  return result;
}

export function customerOperationStatus(operation: PaidOperation | null, now = new Date()) {
  if (!operation) return null;
  return {
    operation_id: operation.id,
    protocol: operation.route.protocol,
    state: operation.status,
    request_id: operation.requestId,
    work_unit: operation.route.workUnit,
    funded_units: operation.fundedUnits,
    claimed_units: operation.claimedUnits ?? null,
    balance_units: operation.balanceUnits ?? null,
    lease_expires_at: iso(operation.leaseExpiresAt),
    warnings: warnings(operation, now),
    recovered: operation.retryCount > 0,
    retry_count: operation.retryCount,
    next_retry_at: iso(operation.nextRetryAt),
    error_code: operation.lastErrorCode ?? null,
    relay_status: operation.sessionRuntime?.relayStatus ?? null,
    delivered_units: operation.sessionRuntime?.lastRunnerUsage ?? null,
    winddown_reason: operation.sessionRuntime?.winddownReason ?? null,
    terminal_at: iso(operation.terminalAt),
  };
}

export function adminOperationStatus(operation: PaidOperation, now = new Date()) {
  return {
    ...customerOperationStatus(operation, now)!,
    kind: operation.kind,
    asset_id: operation.assetId ?? null,
    live_stream_id: operation.liveStreamId ?? null,
    loc_operation_id: operation.locOperationId ?? null,
    broker_job_id: operation.brokerJobId ?? null,
    broker_session_id: operation.brokerSessionId ?? null,
    capability: operation.route.capability,
    offering: operation.route.offering,
    transport: operation.route.transport ?? null,
    quote_id: operation.route.quoteId,
    quote_version: operation.route.quoteVersion,
    route_fingerprint: operation.route.routeFingerprint,
    rotation_generation: operation.rotationGeneration,
    settlement_sequence: operation.settlementSequence,
    updated_at: operation.updatedAt.toISOString(),
    created_at: operation.createdAt.toISOString(),
  };
}
