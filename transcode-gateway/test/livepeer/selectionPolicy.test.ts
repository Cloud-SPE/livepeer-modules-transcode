import { test } from "node:test";
import assert from "node:assert/strict";
import { buildVodSelectionHints } from "../../src/livepeer/selectionPolicy.js";
import type { VideoRouteCandidate } from "../../src/livepeer/routeSelector.js";

function candidate(extra: VideoRouteCandidate["extra"]): VideoRouteCandidate {
  return {
    brokerUrl: "https://broker.example.com",
    ethAddress: "0xabc",
    capability: "video:transcode.abr",
    offering: "default",
    pricePerWorkUnitWei: "0",
    workUnit: "seconds",
    quoteId: null,
    quoteVersion: null,
    constraintFingerprint: null,
    routeFingerprint: null,
    unitsPerPrice: null,
    extra,
    constraints: null,
  };
}

test("buildVodSelectionHints emits preferredExtra mentioning vod mode + encoding tier", () => {
  const hints = buildVodSelectionHints({ encodingTier: "standard" });
  const v = (hints.preferredExtra as Record<string, Record<string, unknown>>)["video"]!;
  assert.equal(v["mode"], "vod");
  assert.equal(v["encoding_tier"], "standard");
  const out = v["output"] as { required_codecs: string[]; max_resolution: string };
  assert.ok(out.required_codecs.includes("h264"));
  assert.ok(out.required_codecs.includes("hevc"));
  assert.equal(out.max_resolution, "2160p");
});

test("supportFilter accepts a candidate that declares no constraints (open world)", () => {
  const hints = buildVodSelectionHints({ encodingTier: "baseline" });
  const c = candidate(null);
  assert.equal(hints.supportFilter(c), true);
});

test("supportFilter rejects candidate that explicitly excludes required codec", () => {
  const hints = buildVodSelectionHints({ encodingTier: "premium" });
  const c = candidate({ video: { supported_codecs: ["h264", "hevc"] } });
  assert.equal(hints.supportFilter(c), false, "av1 missing → reject");
});

test("supportFilter accepts candidate declaring vod mode + all required codecs + sufficient resolution", () => {
  const hints = buildVodSelectionHints({ encodingTier: "baseline" });
  // Baseline tier expands to h264 across all six resolutions, so the ladder's
  // max resolution is 2160p. A candidate must declare it (or omit
  // max_resolution entirely) to pass the filter.
  const c = candidate({
    video: { modes: ["vod"], supported_codecs: ["h264"], max_resolution: "2160p" },
  });
  assert.equal(hints.supportFilter(c), true);
});

test("supportFilter rejects candidate declaring max_resolution lower than required", () => {
  const hints = buildVodSelectionHints({ encodingTier: "premium" });
  const c = candidate({ video: { max_resolution: "720p" } });
  assert.equal(hints.supportFilter(c), false, "2160p required, 720p declared → reject");
});

test("supportFilter rejects candidate declaring it only supports live mode", () => {
  const hints = buildVodSelectionHints({ encodingTier: "standard" });
  const c = candidate({ video: { supported_modes: ["live"] } });
  assert.equal(hints.supportFilter(c), false);
});
