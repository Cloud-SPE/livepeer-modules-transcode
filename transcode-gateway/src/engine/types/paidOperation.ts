export type PaidOperationKind = "job" | "session";

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface PaidRouteSnapshot {
  protocol: "paid-job/v1" | "paid-session/v1";
  transport?: "unary" | "stream" | "multipart";
  capability: string;
  offering: string;
  requestDescriptor: string;
  responseDescriptor?: string;
  workUnit: string;
  estimator?: JsonValue;
  pricePerUnitWei: string;
  unitsPerPrice: string;
  quoteId: string;
  quoteVersion: string;
  constraintFingerprint: string;
  routeFingerprint: string;
  settlementDomainId?: string;
  settlementKey: string;
  raw: JsonValue;
}

export interface PaidOperation {
  id: string;
  kind: PaidOperationKind;
  apiKeyId: string;
  assetId?: string;
  liveStreamId?: string;
  requestId: string;
  requestContentSha256: string;
  workId: string;
  rotationGeneration: number;
  route: PaidRouteSnapshot;
  status: string;
  locOperationId?: string;
  brokerJobId?: string;
  brokerSessionId?: string;
  fundedUnits: string;
  claimedUnits?: string;
  balanceUnits?: string;
  willRefuseNextRefill?: boolean;
  leaseExpiresAt?: Date;
  settlementSequence: string;
  // Optimistic concurrency fence incremented by each recovery claim or
  // claimed mutation. A stale gateway cannot overwrite a newer owner.
  lifecycleVersion: string;
  recoveryOwner?: string;
  recoveryLeaseExpiresAt?: Date;
  sessionRuntime?: PaidSessionRuntimeState;
  retryCount: number;
  nextRetryAt?: Date;
  lastErrorCode?: string;
  terminalEvidence?: PaidTerminalEvidence;
  createdAt: Date;
  updatedAt: Date;
  terminalAt?: Date;
}

export interface PaidSessionRuntimeState {
  publisherMode: "gateway-relay" | "direct-publisher";
  relayStatus: "pending" | "starting" | "active" | "reconnecting" | "stopping" | "stopped" | "failed";
  relayGeneration: number;
  runnerSessionId?: string;
  runnerHlsUrl?: string;
  lastRunnerEventId?: string;
  lastRunnerSequence: string;
  lastRunnerUsage: string;
  controlCursor?: string;
  refillCount?: number;
  lastHttpReconcileAt?: string;
  relayDisconnectedAt?: string;
  winddownReason?: string;
  outputState?: "unknown" | "waiting" | "producing" | "stalled";
  outputStateSince?: string;
  lastFailureCode?: string;
}

export interface PaidTerminalEvidence {
  httpStatus: number;
  responseSha256: string;
  workUnit: string;
  workUnits: string;
  protocolError?: string;
  claimSignature?: string;
  closeReason?: string;
}

export interface PaidOperationSecrets {
  // Exact LOC and broker open inputs are encrypted so an unknown outcome can
  // be retried byte-for-byte without putting credentials in public columns.
  openIntent?: JsonValue;
  routeIntent?: JsonValue;
  sessionParams?: JsonValue;
  grants?: JsonValue;
  control?: JsonValue;
  loc?: JsonValue;
  runnerIngestUrl?: string;
  runnerIngestKey?: string;
  credentials?: JsonValue;
  refillIntent?: JsonValue;
}
