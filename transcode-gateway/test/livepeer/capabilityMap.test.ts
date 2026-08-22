import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PROTOCOL,
  MODE,
  modeForCapability,
  CAPABILITY_MODES,
  routeRequirementForCapability,
} from "../../src/livepeer/capabilityMap.js";

test("every Capability maps to a Mode", () => {
  const caps = Object.keys(CAPABILITY_MODES) as Array<keyof typeof CAPABILITY_MODES>;
  for (const cap of caps) assert.ok(CAPABILITY_MODES[cap], `${cap} unmapped`);
});

test("transcode.abr → http-reqresp@v0", () => {
  assert.equal(modeForCapability("video:transcode.abr"), MODE.HTTP_REQRESP);
});

test("live.rtmp → rtmp-ingress-hls-egress@v0", () => {
  assert.equal(modeForCapability("video:live.rtmp"), MODE.RTMP_INGRESS_HLS_EGRESS);
});

test("transcode.abr selects paid-job/v1 without interaction-mode derivation", () => {
  assert.deepEqual(routeRequirementForCapability("video:transcode.abr"), {
    protocol: PROTOCOL.PAID_JOB,
    acceptedTransports: ["unary", "stream"],
  });
});

test("live.rtmp selects the supported paid-session descriptor before open", () => {
  assert.deepEqual(routeRequirementForCapability("video:live.rtmp"), {
    protocol: PROTOCOL.PAID_SESSION,
    descriptorSchema: "rtmp-hls/v1",
    attachment: "external",
  });
});
