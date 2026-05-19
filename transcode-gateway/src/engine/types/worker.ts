// Modeled on livepeer-network-modules/video-gateway/src/engine/types/worker.ts.

import type { Capability } from "./caller.js";

export interface SelectedWorkerRoute {
  workerUrl: string;
  ethAddress: string;
  capability: Capability;
  offering: string;
  pricePerWorkUnitWei: string;
  workUnit: string;
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
