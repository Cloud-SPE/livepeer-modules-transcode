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
  paymentEnvelope: string;
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
  billedValueWei: number;
  refundWei: number;
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
}

export interface LocOpenSessionResult {
  operationId: string;
  requestId: string;
  workId: string;
  brokerUrl: string;
  protocol: "paid-session/v1";
  session: PaidSessionAxes;
  routeSnapshot: LocRouteSnapshot;
  paymentEnvelope: string;
  refillEndpoint: string;
  closeEndpoint: string;
  openedAt: string;
}

export interface LocClient {
  openJob(input: LocOpenJobInput): Promise<LocOpenJobResult>;
  settleJob(input: LocSettleJobInput): Promise<LocSettleJobResult>;
  openSession(input: LocOpenSessionInput): Promise<LocOpenSessionResult>;
}
