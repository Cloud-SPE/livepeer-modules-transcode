import type {
  JsonValue,
  PaidJobAxes,
  PaidJobTransport,
  PaidSessionAxes,
  SettlementKey,
  WorkUnitEstimator,
} from "../types/index.js";

export interface LocRouteBinding {
  quoteId: string;
  quoteVersion: string;
  constraintFingerprint: string;
  routeFingerprint: string;
  settlementDomainId: string;
}

export interface LocRouteSnapshot {
  schemaVersion: "route-snapshot/v1";
  brokerUrl: string;
  ethAddress: string;
  capability: string;
  offering: string;
  protocol: "paid-job/v1" | "paid-session/v1";
  workUnit: string;
  pricePerWorkUnitWei: string;
  unitsPerPrice: string;
  binding: LocRouteBinding;
  settlementDomainId: string;
  settlementKeys: SettlementKey[];
  workUnitEstimator: WorkUnitEstimator | null;
  job: PaidJobAxes | null;
  session: PaidSessionAxes | null;
  extra: JsonValue;
  raw: JsonValue;
}

export interface LocOpenJobInput {
  requestId: string;
  capability: string;
  offering: string;
  transport: PaidJobTransport;
  estimatedUnits: number;
  maxTotalUnits?: number;
  routeBinding: LocRouteBinding;
  workloadRequestDigest: string;
  callerPublicKey: string;
}

export interface LocOpenJobResult {
  operationId: string;
  requestId: string;
  workId: string;
  brokerUrl: string;
  protocol: "paid-job/v1";
  transport: PaidJobTransport;
  workUnit: string;
  routeSnapshot: LocRouteSnapshot;
  spendAuthorization: string;
  paymentEnvelope: string | null;
  expectedValueWei: string;
  fundedValueWei: string;
  settleEndpoint: string;
  openedAt: string;
}

export interface LocSettlementEnvelope {
  payload: { [key: string]: JsonValue };
  signature: {
    algorithm: "secp256k1";
    canonicalization: "jcs";
    value: string;
  };
}

export interface LocSettleJobInput {
  operationId: string;
  actualUnits: number;
  brokerJobId: string;
  workUnit: string;
  outcome: string;
  settlement: LocSettlementEnvelope;
}

export interface LocSettleJobResult {
  operationId: string;
  workId: string;
  actualUnits: number;
  billedValueWei: string;
  refundWei: string;
  outcome: string;
  closedAt: string;
}

export interface LocOpenSessionInput {
  requestId: string;
  capability: string;
  offering: string;
  descriptorSchema: string;
  sessionParams: { [key: string]: JsonValue };
  estimatedRunwayUnits: number;
  maxTotalUnits: number;
  routeBinding: LocRouteBinding;
  gatewaySessionId: string;
  preparationToken: string;
  workloadRequestDigest: string;
  callerPublicKey: string;
}

export interface LocPrepareSessionInput {
  requestId: string;
  capability: string;
  offering: string;
  descriptorSchema: string;
  routeBinding: LocRouteBinding;
}

export interface LocPrepareSessionResult {
  gatewaySessionId: string;
  routeBinding: LocRouteBinding;
  brokerUrl: string;
  preparationToken: string;
  expiresAt: string;
}

export interface LocOpenSessionResult {
  operationId: string;
  gatewaySessionId: string;
  requestId: string;
  workId: string;
  brokerUrl: string;
  protocol: "paid-session/v1";
  session: PaidSessionAxes;
  routeSnapshot: LocRouteSnapshot;
  spendAuthorization: string;
  paymentEnvelope: string | null;
  expectedValueWei: string;
  fundedValueWei: string;
  refillEndpoint: string;
  closeEndpoint: string;
  openedAt: string;
}

export interface LocCapStatus {
  sessionPctUsed: number;
  spendPeriodPctUsed: number | null;
  userBalancePctUsed: number | null;
  operatorPoolPctUsed: number | null;
  willRefuseNextRefill: boolean;
  winddownReason: string | null;
}

export interface LocRefillSessionInput {
  operationId: string;
  requestId: string;
  observedConsumedUnits?: number;
  maxTotalUnits: number;
  workloadRequestDigest: string;
}

export interface LocRefillSessionResult {
  workId: string;
  requestId: string;
  refillSequence: number;
  spendAuthorization: string;
  paymentEnvelope: string | null;
  expectedValueWei: string;
  fundedValueWei: string;
  capStatus: LocCapStatus;
}

export interface LocSessionStatus {
  operationId: string;
  workId: string;
  state: string;
  fundedValueWei: string;
  billedValueWei: string;
  refillCount: number;
  capStatus: LocCapStatus | null;
  actualUnits: number | null;
  outcome: string | null;
  closedAt: string | null;
}

export interface LocCloseSessionInput {
  operationId: string;
  actualUnits: number;
  outcome: string;
  settlement: LocSettlementEnvelope;
}

export interface LocCloseSessionResult {
  operationId: string;
  workId: string;
  actualUnits: number;
  billedValueWei: string;
  refundWei: string;
  outcome: string;
  closedAt: string;
}

export interface LocClient {
  openJob(input: LocOpenJobInput): Promise<LocOpenJobResult>;
  settleJob(input: LocSettleJobInput): Promise<LocSettleJobResult>;
  prepareSession(input: LocPrepareSessionInput): Promise<LocPrepareSessionResult>;
  openSession(input: LocOpenSessionInput): Promise<LocOpenSessionResult>;
  refillSession(input: LocRefillSessionInput): Promise<LocRefillSessionResult>;
  getSession(operationId: string): Promise<LocSessionStatus>;
  closeSession(input: LocCloseSessionInput): Promise<LocCloseSessionResult>;
}
