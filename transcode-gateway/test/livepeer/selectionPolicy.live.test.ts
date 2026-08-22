import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLiveSelectionHints } from "../../src/livepeer/selectionPolicy.js";
import type { VideoRouteCandidate } from "../../src/livepeer/routeSelector.js";

function candidate(extra: VideoRouteCandidate["extra"]): VideoRouteCandidate {
  return {
    brokerUrl: "https://broker.example.com",
    ethAddress: "0xabc",
    capability: "video:live.rtmp",
    offering: "default",
    pricePerWorkUnitWei: "0",
    workUnit: "seconds",
    protocol: "paid-session/v1",
    job: null,
    session: {
      descriptorSchema: "rtmp-hls/v1",
      attachment: "external",
      metering: "runner-reported",
      maxRotations: 3,
      refill: "extensible",
      heartbeat: { intervalSeconds: 10, missedThreshold: 3 },
      lease: { policy: "funding-tracking" },
    },
    workUnitEstimator: null,
    settlementKeys: [],
    quoteId: null,
    quoteVersion: null,
    constraintFingerprint: null,
    routeFingerprint: null,
    unitsPerPrice: null,
    extra,
    constraints: null,
  };
}

test("buildLiveSelectionHints emits preferredExtra with mode=live, ingress=rtmp, egress=hls", () => {
  const hints = buildLiveSelectionHints({ encodingTier: "standard" });
  const v = (hints.preferredExtra as Record<string, Record<string, unknown>>)["video"]!;
  assert.equal(v["mode"], "live");
  assert.equal(v["ingress"], "rtmp");
  assert.equal(v["egress"], "hls");
  assert.equal(v["encoding_tier"], "standard");
});

test("supportFilter rejects candidate declaring only VOD support", () => {
  const hints = buildLiveSelectionHints({ encodingTier: "standard" });
  const c = candidate({ video: { supported_modes: ["vod"] } });
  assert.equal(hints.supportFilter(c), false);
});

test("supportFilter accepts candidate declaring live mode + sufficient codecs/resolution", () => {
  const hints = buildLiveSelectionHints({ encodingTier: "baseline" });
  const c = candidate({
    video: { modes: ["live"], supported_codecs: ["h264"], max_resolution: "2160p" },
  });
  assert.equal(hints.supportFilter(c), true);
});
