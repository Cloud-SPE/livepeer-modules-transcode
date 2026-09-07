import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PROTOCOL,
  routeRequirementForCapability,
} from "../../src/livepeer/capabilityMap.js";

test("transcode.abr selects paid-job/v1 without interaction-mode derivation", () => {
  assert.deepEqual(routeRequirementForCapability("video:transcode.abr"), {
    protocol: PROTOCOL.PAID_JOB,
    acceptedTransports: ["unary", "stream"],
  });
});

test("live.rtmp selects the supported paid-session descriptor before open", () => {
  assert.deepEqual(routeRequirementForCapability("video:transcode.live"), {
    protocol: PROTOCOL.PAID_SESSION,
    descriptorSchema: "rtmp-hls/v1",
    attachment: "external",
  });
});
