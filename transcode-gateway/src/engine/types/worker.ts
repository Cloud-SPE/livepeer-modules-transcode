// Modeled on livepeer-network-modules/video-gateway/src/engine/types/worker.ts.

import type { Capability } from "./caller.js";

export type LivepeerProtocol = "paid-job/v1" | "paid-session/v1";
export type PaidJobTransport = "unary" | "stream" | "multipart";

export interface PaidJobAxes {
  transports: PaidJobTransport[];
}

export interface PaidSessionHeartbeat {
  intervalSeconds: number;
  missedThreshold: number;
}

export interface PaidSessionLease {
  policy: "funding-tracking" | "fixed";
  maxSeconds?: number;
}

export interface PaidSessionAxes {
  descriptorSchema: string;
  attachment: "external" | "inband-ws";
  metering: "runner-reported" | "broker-observed";
  maxRotations: number;
  refill: "extensible" | "bounded";
  heartbeat: PaidSessionHeartbeat;
  lease: PaidSessionLease;
  toleranceBandPct?: number;
  runwayIncrementUnits?: number;
  sessionParamsSchema?: Record<string, unknown>;
}

export interface WorkUnitEstimator {
  id: string;
  rounding: string;
  exactness: string;
  package?: string;
  fixtures?: string;
}

export interface SettlementKey {
  publicKey: string;
  notBefore: string;
  expiresAt: string;
  introducedInPublicationSeq: number;
}

export interface SelectedWorkerRoute {
  workerUrl: string;
  ethAddress: string;
  capability: Capability;
  offering: string;
  pricePerWorkUnitWei: string;
  workUnit: string;
  protocol: LivepeerProtocol;
  job: PaidJobAxes | null;
  session: PaidSessionAxes | null;
  workUnitEstimator: WorkUnitEstimator | null;
  settlementKeys: SettlementKey[];
  unitsPerPrice?: number;
  quoteId?: string;
  quoteVersion?: number;
  constraintFingerprint?: Uint8Array;
  routeFingerprint?: Uint8Array;
  extra?: Record<string, unknown>;
  constraints?: Record<string, unknown>;
}

export interface WorkerInventoryEntry {
  url: string;
  capabilities: Capability[];
  gpu?: string;
  region?: string;
}
