// Modeled on livepeer-network-modules/video-gateway/src/livepeer/selectionPolicy.ts.
// Edits per plan 0005 §3.3 and plan 0006 §4.3:
//   - VOD half landed in plan 0005.
//   - Live half landed in plan 0006 (this file). Drops `recordToVod` field
//     (no live→VOD per core-beliefs §8) and `customerTier` field (caller
//     supplies `encodingTier` directly, matching VOD shape).

import type { Codec, EncodingTier, RenditionSpec, Resolution } from "../engine/types/index.js";
import { expandTier } from "../engine/config/encodingLadder.js";
import type { JsonValue, VideoRouteCandidate } from "./routeSelector.js";

const RESOLUTION_ORDER: Record<Resolution, number> = {
  "240p": 240,
  "360p": 360,
  "480p": 480,
  "720p": 720,
  "1080p": 1080,
  "2160p": 2160,
};

export interface VodSelectionProfile {
  encodingTier: EncodingTier;
}

export interface LiveSelectionProfile {
  encodingTier: EncodingTier;
  ladder?: RenditionSpec[];   // optional explicit ladder; derived from tier when omitted
}

export interface DerivedSelectionHints {
  preferredExtra: JsonValue;
  supportFilter: (candidate: VideoRouteCandidate) => boolean;
}

export function buildVodSelectionHints(profile: VodSelectionProfile): DerivedSelectionHints {
  const renditions = expandTier(profile.encodingTier);
  const requiredCodecs = uniqueCodecs(renditions);
  const maxResolution = highestResolution(renditions.map((row) => row.resolution));
  return {
    preferredExtra: {
      video: {
        mode: "vod",
        encoding_tier: profile.encodingTier,
        output: {
          max_resolution: maxResolution,
          required_codecs: requiredCodecs,
        },
      },
    },
    supportFilter: (candidate) =>
      candidateSupportsVod(candidate, {
        encodingTier: profile.encodingTier,
        requiredCodecs,
        maxResolution,
      }),
  };
}

export function buildLiveSelectionHints(profile: LiveSelectionProfile): DerivedSelectionHints {
  const ladder = profile.ladder ?? expandTier(profile.encodingTier);
  const requiredCodecs = uniqueCodecs(ladder);
  const maxResolution = highestResolution(ladder.map((row) => row.resolution));
  return {
    preferredExtra: {
      video: {
        mode: "live",
        ingress: "rtmp",
        egress: "hls",
        encoding_tier: profile.encodingTier,
        ladder: {
          max_resolution: maxResolution,
          rendition_count: ladder.length,
          required_codecs: requiredCodecs,
        },
      },
    },
    supportFilter: (candidate) =>
      candidateSupportsLive(candidate, {
        encodingTier: profile.encodingTier,
        requiredCodecs,
        maxResolution,
      }),
  };
}

function candidateSupportsLive(
  candidate: VideoRouteCandidate,
  required: { encodingTier: EncodingTier; requiredCodecs: Codec[]; maxResolution: Resolution },
): boolean {
  if (!candidateSupportsMode(candidate, "live")) return false;
  if (!candidateSupportsEncodingTier(candidate, required.encodingTier)) return false;
  if (!candidateSupportsCodecs(candidate, required.requiredCodecs)) return false;
  if (!candidateSupportsResolution(candidate, required.maxResolution)) return false;
  return true;
}

function candidateSupportsVod(
  candidate: VideoRouteCandidate,
  required: { encodingTier: EncodingTier; requiredCodecs: Codec[]; maxResolution: Resolution },
): boolean {
  if (!candidateSupportsMode(candidate, "vod")) return false;
  if (!candidateSupportsEncodingTier(candidate, required.encodingTier)) return false;
  if (!candidateSupportsCodecs(candidate, required.requiredCodecs)) return false;
  if (!candidateSupportsResolution(candidate, required.maxResolution)) return false;
  return true;
}

function candidateSupportsMode(candidate: VideoRouteCandidate, mode: "live" | "vod"): boolean {
  const declared = firstStringList(candidate, [
    ["video", "modes"],
    ["video", "supported_modes"],
    ["modes"],
    ["supported_modes"],
  ]);
  if (declared === null) return true;
  return declared.includes(mode);
}

function candidateSupportsEncodingTier(candidate: VideoRouteCandidate, tier: EncodingTier): boolean {
  const declared = firstStringList(candidate, [
    ["video", "encoding_tiers"],
    ["video", "supported_encoding_tiers"],
    ["encoding_tiers"],
    ["supported_encoding_tiers"],
  ]);
  if (declared === null) return true;
  return declared.includes(tier);
}

function candidateSupportsCodecs(candidate: VideoRouteCandidate, codecs: Codec[]): boolean {
  const declared = firstStringList(candidate, [
    ["video", "codecs"],
    ["video", "supported_codecs"],
    ["codecs"],
    ["supported_codecs"],
  ]);
  if (declared === null) return true;
  return codecs.every((codec) => declared.includes(codec));
}

function candidateSupportsResolution(candidate: VideoRouteCandidate, required: Resolution): boolean {
  const raw = firstString(candidate, [["video", "max_resolution"], ["max_resolution"]]);
  if (raw === null) return true;
  if (!isResolution(raw)) return true;
  return RESOLUTION_ORDER[raw] >= RESOLUTION_ORDER[required];
}

function firstStringList(candidate: VideoRouteCandidate, paths: string[][]): string[] | null {
  for (const path of paths) {
    const value = lookup(candidate.extra, path) ?? lookup(candidate.constraints, path);
    const list = asStringList(value);
    if (list !== null) return list;
  }
  return null;
}

function firstString(candidate: VideoRouteCandidate, paths: string[][]): string | null {
  for (const path of paths) {
    const value = lookup(candidate.extra, path) ?? lookup(candidate.constraints, path);
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
}

function lookup(root: JsonValue | null, path: string[]): JsonValue | null {
  let current: JsonValue | null = root;
  for (const segment of path) {
    if (!isJsonObject(current)) return null;
    current = current[segment] ?? null;
  }
  return current;
}

function isJsonObject(value: JsonValue | null): value is { [key: string]: JsonValue } {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function asStringList(value: JsonValue | null): string[] | null {
  if (!Array.isArray(value)) return null;
  const out = value.filter((item): item is string => typeof item === "string");
  return out.length > 0 ? out : null;
}

function uniqueCodecs(renditions: ReadonlyArray<{ codec: Codec }>): Codec[] {
  return [...new Set(renditions.map((row) => row.codec))];
}

function highestResolution(values: Resolution[]): Resolution {
  return values.reduce((best, current) =>
    RESOLUTION_ORDER[current] > RESOLUTION_ORDER[best] ? current : best,
  );
}

function isResolution(value: string): value is Resolution {
  return value in RESOLUTION_ORDER;
}
