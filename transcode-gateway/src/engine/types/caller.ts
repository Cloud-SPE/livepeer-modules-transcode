// Modeled on livepeer-network-modules/video-gateway/src/engine/types/caller.ts.
// CostQuote / UsageReport / ReservationHandle dropped (no pricing in v0).

export interface Caller {
  id: string;       // == apiKeyId
  tier: string;     // always "standard" in v0; reserved for phase 2
  metadata?: unknown;
}

export type Capability = "video:transcode.abr" | "video:transcode.live";

export type Codec = "h264" | "hevc" | "av1";

export type Resolution = "240p" | "360p" | "480p" | "720p" | "1080p" | "2160p";

export interface RenditionSpec {
  resolution: Resolution;
  bitrateKbps: number;
  codec: Codec;
}

export type EncodingTier = "baseline" | "standard" | "premium";
