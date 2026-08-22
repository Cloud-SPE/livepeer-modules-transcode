import type {
  PaidOperation,
  PaidOperationSecrets,
  PaidRouteSnapshot,
  PaidTerminalEvidence,
} from "../types/index.js";

export interface NewPaidOperation {
  id: string;
  kind: "job" | "session";
  apiKeyId: string;
  assetId?: string;
  liveStreamId?: string;
  requestId: string;
  requestContentSha256: string;
  workId: string;
  rotationGeneration?: number;
  route: PaidRouteSnapshot;
  status: string;
  fundedUnits: string;
}

export interface PaidOperationProgress {
  status: string;
  locOperationId?: string;
  brokerJobId?: string;
  brokerSessionId?: string;
  fundedUnits?: string;
  claimedUnits?: string;
  balanceUnits?: string;
  willRefuseNextRefill?: boolean;
  leaseExpiresAt?: Date;
  settlementSequence?: string;
}

export interface PaidOperationRepo {
  insert(value: NewPaidOperation): Promise<PaidOperation>;
  byId(id: string): Promise<PaidOperation | null>;
  byIdForApiKey(id: string, apiKeyId: string): Promise<PaidOperation | null>;
  byRequestId(requestId: string): Promise<PaidOperation | null>;
  recoverable(now: Date, limit: number): Promise<PaidOperation[]>;
  recordProgress(id: string, value: PaidOperationProgress): Promise<void>;
  recordRetry(id: string, value: {
    status: string;
    nextRetryAt: Date;
    errorCode: string;
  }): Promise<void>;
  recordTerminal(id: string, value: {
    status: string;
    claimedUnits: string;
    settlementSequence: string;
    evidence: PaidTerminalEvidence;
    terminalAt: Date;
  }): Promise<void>;
  putSecrets(id: string, value: PaidOperationSecrets): Promise<void>;
  readSecrets(id: string): Promise<PaidOperationSecrets | null>;
  deleteSecrets(id: string): Promise<void>;
}
