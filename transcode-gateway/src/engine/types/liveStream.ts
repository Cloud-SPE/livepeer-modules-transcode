// Modeled on livepeer-network-modules/video-gateway/src/engine/types/liveStream.ts.
// projectId → apiKeyId.
// Recording fields dropped (no live→VOD in v0; see core-beliefs §8).

import type { Capability } from "./caller.js";

export interface LiveStream {
  id: string;
  apiKeyId: string;
  name?: string;
  streamKeyHash: string;
  status: LiveStreamStatus;
  ingestProtocol: IngestProtocol;
  sessionId?: string;
  workerId?: string;
  workerUrl?: string;
  selectedCapability?: Capability;
  selectedOffering?: string;
  selectedWorkUnit?: string;
  selectedPricePerWorkUnitWei?: string;
  lastSeenAt?: Date;
  createdAt: Date;
  endedAt?: Date;
}

export type LiveStreamStatus = "idle" | "active" | "reconnecting" | "ended" | "errored";

export type IngestProtocol = "rtmp";
