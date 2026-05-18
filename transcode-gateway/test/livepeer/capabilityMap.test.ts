import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MODE,
  modeForCapability,
  CAPABILITY_MODES,
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
