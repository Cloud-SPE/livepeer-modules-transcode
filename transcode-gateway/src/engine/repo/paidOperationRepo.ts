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
  sessionRuntime?: PaidOperation["sessionRuntime"];
}

export interface PaidOperationClaim {
  owner: string;
  version: string;
  leaseExpiresAt: Date;
}

export interface PaidOperationProgress {
  status: string;
  workId?: string;
  rotationGeneration?: number;
  requestId?: string;
  locOperationId?: string;
  brokerJobId?: string;
  brokerSessionId?: string;
  fundedUnits?: string;
  claimedUnits?: string;
  balanceUnits?: string;
  willRefuseNextRefill?: boolean;
  leaseExpiresAt?: Date;
  settlementSequence?: string;
  sessionRuntime?: PaidOperation["sessionRuntime"];
}

export interface PaidOperationRepo {
  insert(value: NewPaidOperation): Promise<PaidOperation>;
  insertWithSecrets(
    value: NewPaidOperation,
    secrets: PaidOperationSecrets,
    claim: Omit<PaidOperationClaim, "version">,
  ): Promise<PaidOperation>;
  byId(id: string): Promise<PaidOperation | null>;
  byIdForApiKey(id: string, apiKeyId: string): Promise<PaidOperation | null>;
  byRequestId(requestId: string): Promise<PaidOperation | null>;
  byAssetId(assetId: string): Promise<PaidOperation | null>;
  byLiveStreamId(liveStreamId: string): Promise<PaidOperation | null>;
  byBrokerSessionId(brokerSessionId: string): Promise<PaidOperation | null>;
  listForAdmin(options: {
    kind?: PaidOperation["kind"];
    status?: string;
    limit: number;
  }): Promise<PaidOperation[]>;
  claimRecoverable(
    kind: PaidOperation["kind"],
    owner: string,
    now: Date,
    leaseExpiresAt: Date,
    limit: number,
  ): Promise<PaidOperation[]>;
  claimSessionByLiveStreamId(
    liveStreamId: string,
    owner: string,
    now: Date,
    leaseExpiresAt: Date,
  ): Promise<PaidOperation | null>;
  requestSessionWinddown(
    liveStreamId: string,
    reason: string,
  ): Promise<PaidOperation | null>;
  renewClaim(
    id: string,
    claim: PaidOperationClaim,
    leaseExpiresAt: Date,
  ): Promise<PaidOperation | null>;
  releaseClaim(id: string, claim: PaidOperationClaim): Promise<boolean>;
  recordProgress(
    id: string,
    claim: PaidOperationClaim,
    value: PaidOperationProgress,
  ): Promise<PaidOperation | null>;
  recordRetry(
    id: string,
    claim: PaidOperationClaim,
    value: {
      status: string;
      nextRetryAt: Date;
      errorCode: string;
    },
  ): Promise<PaidOperation | null>;
  recordTerminal(
    id: string,
    claim: PaidOperationClaim,
    value: {
      status: string;
      claimedUnits: string;
      settlementSequence: string;
      evidence: PaidTerminalEvidence;
      terminalAt: Date;
    },
  ): Promise<boolean>;
  recordLiveTerminal(
    id: string,
    claim: PaidOperationClaim,
    value: {
      liveStreamId: string;
      claimedUnits: string;
      settlementSequence: string;
      evidence: PaidTerminalEvidence;
      terminalAt: Date;
    },
  ): Promise<boolean>;
  recordVodTerminal(
    id: string,
    claim: PaidOperationClaim,
    value: {
      assetId: string;
      encodingJobId: string;
      playbackId: string;
      apiKeyId: string;
      locOperationId: string;
      brokerJobId: string;
      brokerRequestId: string;
      claimedUnits: string;
      settlementSequence: string;
      evidence: PaidTerminalEvidence;
      terminalAt: Date;
      renditions: Array<{
        renditionId: string;
        storageKey: string;
        durationSeconds: number;
      }>;
    },
  ): Promise<boolean>;
  putSecrets(
    id: string,
    claim: PaidOperationClaim,
    value: PaidOperationSecrets,
  ): Promise<boolean>;
  readSecrets(
    id: string,
    claim: PaidOperationClaim,
  ): Promise<PaidOperationSecrets | null>;
  deleteSecrets(id: string, claim: PaidOperationClaim): Promise<boolean>;
}
