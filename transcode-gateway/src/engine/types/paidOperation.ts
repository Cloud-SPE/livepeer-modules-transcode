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
  retryCount: number;
  nextRetryAt?: Date;
  lastErrorCode?: string;
  terminalEvidence?: PaidTerminalEvidence;
  createdAt: Date;
  updatedAt: Date;
  terminalAt?: Date;
}

export interface PaidTerminalEvidence {
  httpStatus: number;
  responseSha256: string;
  workUnit: string;
  workUnits: string;
  protocolError?: string;
  claimSignature?: string;
}

export interface PaidOperationSecrets {
  sessionParams?: JsonValue;
  grants?: JsonValue;
  runnerIngestUrl?: string;
  runnerIngestKey?: string;
  credentials?: JsonValue;
}
