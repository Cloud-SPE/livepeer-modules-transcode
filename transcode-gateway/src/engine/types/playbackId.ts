// Modeled on livepeer-network-modules/video-gateway/src/engine/types/playbackId.ts.
// projectId → apiKeyId.

export interface PlaybackId {
  id: string;
  apiKeyId: string;
  assetId?: string;
  liveStreamId?: string;
  policy: PlaybackPolicy;
  tokenRequired: boolean;
  createdAt: Date;
}

export type PlaybackPolicy = "public" | "signed";
