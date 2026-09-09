import type {
  LocCapStatus,
  LocCloseSessionResult,
  LocOpenSessionResult,
  LocRefillSessionResult,
  LocSettlementEnvelope,
} from "./locClient.js";
import type { JsonValue, SelectedWorkerRoute } from "../types/index.js";

export interface PaidSessionOpenRequest {
  gatewaySessionId: string;
  requestId: string;
  route: SelectedWorkerRoute;
  descriptorSchema: string;
  sessionParams: { [key: string]: JsonValue };
  estimatedRunwayUnits: number;
  maxTotalUnits: number;
}

export interface PaidSessionGrant {
  id: string;
  operations: string[];
  secret: string;
  expiresAt: string;
  maxUses?: number;
}

export interface PaidSessionBalance {
  claimedUnits: number;
  debitedUnits: number;
  unit: string;
  runwayUnits: number | null;
  runwaySecondsEstimate: number | null;
  status: "ok" | "low" | "exhausted";
  willRefuseNextRefill: boolean;
}

export interface PaidSessionControl {
  statusUrl: string;
  topupUrl: string;
  endUrl: string;
  eventsWs: string;
}

export interface PaidSessionStreamKeyRequest {
  keyIssueUrl: string;
  grant: PaidSessionGrant;
  requestId: string;
  audience: "gateway-relay" | "direct-publisher";
}

export interface PaidSessionStreamKeyResult {
  requestId: string;
  streamKey: string;
  expiresAt: string;
}

export interface PaidSessionOpenResult {
  opened: LocOpenSessionResult;
  gatewaySessionId: string;
  brokerSessionId: string;
  workId: string;
  state: string;
  credential: string;
  runtimeSchema: string;
  runtimePublic: JsonValue;
  grants: PaidSessionGrant[];
  leaseExpiresAt: string;
  balance: PaidSessionBalance;
  control: PaidSessionControl;
}

export interface PaidSessionRecoveryHandle {
  operationId: string;
  brokerUrl: string;
  descriptorSchema: string;
  workUnit: string;
}

export type PaidSessionControlHandle = LocOpenSessionResult | PaidSessionRecoveryHandle;

export interface PaidSessionRefillRequest {
  opened: PaidSessionControlHandle;
  brokerSessionId: string;
  credential: string;
  requestId: string;
  observedConsumedUnits?: number;
  rebindFrom?: string;
  replacesRequestId?: string;
}

export interface PaidSessionRefillResult {
  loc: LocRefillSessionResult;
  brokerSessionId: string;
  workId: string;
  leaseExpiresAt: string;
  balance: PaidSessionBalance;
}

export interface PaidSessionStatusResult {
  brokerSessionId: string;
  gatewaySessionId: string;
  workId: string;
  state: string;
  runtimeSchema: string;
  runtimePublic: JsonValue;
  claimedUnits: number;
  workUnit: string;
  leaseExpiresAt: string;
  balance: PaidSessionBalance;
  closeReason: string | null;
  outputState: "unknown" | "waiting" | "producing" | "stalled";
  outputStateSince: string | null;
  lastFailureCode: string | null;
}

export interface PaidSessionEndRequest {
  opened: PaidSessionControlHandle;
  gatewaySessionId: string;
  brokerSessionId: string;
  credential: string;
  reason: string;
}

export interface PaidSessionEndResult {
  brokerSessionId: string;
  workId: string;
  state: string;
  closeReason: string;
  settlementSequence: number;
  actualUnits: number;
  outcome: string;
  envelope: LocSettlementEnvelope;
  accounting: LocCloseSessionResult;
}

export interface PaidSessionClient {
  open(input: PaidSessionOpenRequest): Promise<PaidSessionOpenResult>;
  issueStreamKey(input: PaidSessionStreamKeyRequest): Promise<PaidSessionStreamKeyResult>;
  status(input: { opened: PaidSessionControlHandle; brokerSessionId: string; workId: string; credential: string }): Promise<PaidSessionStatusResult>;
  refill(input: PaidSessionRefillRequest): Promise<PaidSessionRefillResult>;
  end(input: PaidSessionEndRequest): Promise<PaidSessionEndResult>;
}

export type PaidSessionControlEvent =
  | { type: "session.usage.tick"; sequence: number; unit: string; claimedTotal: number; debitedUnits: number }
  | { type: "session.balance"; balance: PaidSessionBalance }
  | {
    type: "session.output.health";
    outputState: "waiting" | "producing" | "stalled";
    outputStateSince: string;
    lastFailureCode: string | null;
  }
  | { type: "session.ended"; state: string; closeReason: string }
  | { type: "session.rebound"; rotationGeneration: number; predecessorWorkId: string; workId: string };

export class PaidSessionClientError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, options: { retryable: boolean; cause?: unknown }) {
    super(code, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "PaidSessionClientError";
    this.code = code;
    this.retryable = options.retryable;
  }
}

export type { LocCapStatus };
