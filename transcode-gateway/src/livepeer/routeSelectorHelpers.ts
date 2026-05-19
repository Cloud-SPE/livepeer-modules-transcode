// Helpers for routeSelector.ts — JSON merging, candidate ranking, and
// bigint comparison. Extracted to keep routeSelector.ts under the 300-line
// soft cap (per plan 0003 §4 / 0004 §4 acceptance criteria).
// Modeled on livepeer-network-modules/video-gateway/src/livepeer/routeSelector.ts.

import type { JsonValue, VideoRouteCandidate } from "./routeSelector.js";

export function parseJsonHeader(value: string | string[] | undefined): JsonValue | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return null;
  return JSON.parse(raw) as JsonValue;
}

export function parseBigIntHeader(value: string | string[] | undefined): bigint | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return null;
  return BigInt(raw);
}

export function parseOpaqueJson(raw: Buffer | Uint8Array | string | undefined): JsonValue | null {
  if (!raw) return null;
  const text = typeof raw === "string" ? raw : Buffer.from(raw).toString("utf8");
  if (!text) return null;
  return JSON.parse(text) as JsonValue;
}

export function parseOpaqueBytes(raw: Buffer | Uint8Array | string | undefined): Uint8Array | null {
  if (!raw) return null;
  if (typeof raw === "string") return Buffer.from(raw, "utf8");
  return Uint8Array.from(raw);
}

export function parseOptionalInteger(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function mergeJsonObjects(a: JsonValue | null, b: JsonValue | null): JsonValue | null {
  if (!isJsonObject(a)) return b;
  if (!isJsonObject(b)) return a;
  return { ...a, ...b };
}

export function mergeSelectorValue(a: JsonValue | null, b: JsonValue | null): JsonValue | null {
  if (a === null) return b;
  if (b === null) return a;
  return mergeJsonObjects(a, b) ?? b;
}

export function compareCandidates(
  a: VideoRouteCandidate,
  b: VideoRouteCandidate,
  preferredExtra: JsonValue | null,
): number {
  const scoreA = scorePreference(a.extra, preferredExtra);
  const scoreB = scorePreference(b.extra, preferredExtra);
  if (scoreA.fullMatch !== scoreB.fullMatch) return scoreA.fullMatch ? -1 : 1;
  if (scoreA.matchedLeaves !== scoreB.matchedLeaves) {
    return scoreB.matchedLeaves - scoreA.matchedLeaves;
  }
  const priceCmp = compareBigInts(a.pricePerWorkUnitWei, b.pricePerWorkUnitWei);
  if (priceCmp !== 0) return priceCmp;
  const urlCmp = a.brokerUrl.localeCompare(b.brokerUrl);
  if (urlCmp !== 0) return urlCmp;
  return a.ethAddress.localeCompare(b.ethAddress);
}

function scorePreference(
  candidate: JsonValue | null,
  preferred: JsonValue | null,
): { fullMatch: boolean; matchedLeaves: number } {
  if (preferred === null) return { fullMatch: true, matchedLeaves: 0 };
  return {
    fullMatch: isSubset(candidate, preferred),
    matchedLeaves: countMatchingLeaves(candidate, preferred),
  };
}

function countMatchingLeaves(candidate: JsonValue | null, preferred: JsonValue): number {
  if (preferred === null || typeof preferred !== "object") {
    return deepEqual(candidate, preferred) ? 1 : 0;
  }
  if (Array.isArray(preferred)) {
    if (!Array.isArray(candidate)) return 0;
    return preferred.reduce<number>(
      (sum, v) => sum + (candidate.some((cv) => deepEqual(cv, v)) ? 1 : 0),
      0,
    );
  }
  if (!isJsonObject(candidate)) return 0;
  let matches = 0;
  for (const [key, value] of Object.entries(preferred)) {
    matches += countMatchingLeaves(candidate[key] ?? null, value);
  }
  return matches;
}

export function isSubset(candidate: JsonValue | null, required: JsonValue): boolean {
  if (required === null || typeof required !== "object") return deepEqual(candidate, required);
  if (Array.isArray(required)) {
    if (!Array.isArray(candidate)) return false;
    return required.every((rv) => candidate.some((cv) => deepEqual(cv, rv)));
  }
  if (!isJsonObject(candidate)) return false;
  return Object.entries(required).every(([k, v]) => isSubset(candidate[k] ?? null, v));
}

function isJsonObject(value: JsonValue | null): value is { [key: string]: JsonValue } {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function deepEqual(a: JsonValue | null, b: JsonValue | null): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i] ?? null));
  }
  if (isJsonObject(a) && isJsonObject(b)) {
    const keysA = Object.keys(a).sort();
    const keysB = Object.keys(b).sort();
    if (keysA.length !== keysB.length) return false;
    return keysA.every((k, i) => k === keysB[i] && deepEqual(a[k] ?? null, b[k] ?? null));
  }
  return false;
}

export function safeBigInt(value: string): bigint {
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

function compareBigInts(a: string, b: string): number {
  const av = safeBigInt(a);
  const bv = safeBigInt(b);
  if (av < bv) return -1;
  if (av > bv) return 1;
  return 0;
}
