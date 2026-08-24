import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ABR_ESTIMATOR_ID,
  ABR_WORK_UNIT,
  AbrUsageError,
  calculateAbrFrameMegapixelUnits,
  estimateAbrFunding,
  reconcileAbrUsage,
} from "../../src/engine/service/vodUsage.js";

const estimator = {
  id: ABR_ESTIMATOR_ID,
  rounding: "ceil-total",
  exactness: "ceiling",
  fixtures: "transcode/v2",
};

test("runner fixture uses one ceiling after summing mixed-resolution output pixels", () => {
  assert.equal(calculateAbrFrameMegapixelUnits([
    { name: "720p", video: { actualFrames: 300, width: 1280, height: 720 } },
    { name: "360p", video: { actualFrames: 300, width: 640, height: 360 } },
    { name: "audio-only" },
  ]), 346);
});

test("funding estimation rounds fractional frame counts per target and covers the declared ladder", () => {
  const result = estimateAbrFunding({
    durationSeconds: 10.01,
    sourceFrameRate: 29.97,
    targets: [
      { resolution: "720p" },
      { resolution: "360p", frameRate: 24 },
    ],
    estimator,
  });
  assert.deepEqual(result.estimatedFramesByTarget, [300, 241]);
  assert.deepEqual(result.maximumFramesByTarget, [360, 289]);
  assert.equal(result.estimatedUnits, 333);
  assert.equal(result.maxTotalUnits, 399);
  assert.ok(result.maxTotalUnits >= result.estimatedUnits);
});

test("audio-only outputs contribute zero and mixed frame rates still sum before ceiling", () => {
  assert.equal(calculateAbrFrameMegapixelUnits([
    { name: "1080p", video: { actualFrames: 30, width: 1920, height: 1080 } },
    { name: "480p", video: { actualFrames: 24, width: 854, height: 480 } },
    { name: "audio-only" },
  ]), 73);
});

test("reconciliation accepts exact terminal metadata and exposes zero divergence", () => {
  assert.deepEqual(reconcileAbrUsage({
    renditions: [
      { name: "720p", video: { actualFrames: 300, width: 1280, height: 720 } },
      { name: "360p", video: { actualFrames: 300, width: 640, height: 360 } },
      { name: "audio-only" },
    ],
    signedUnit: ABR_WORK_UNIT,
    signedUnits: 346,
    maximumUnits: 400,
  }), {
    observedUnits: 346,
    signedUnits: 346,
    maximumUnits: 400,
    deltaUnits: 0,
  });
});

test("unsupported estimator, over-ceiling claims, and any body/claim drift fail closed", () => {
  assert.throws(
    () => estimateAbrFunding({
      durationSeconds: 10,
      sourceFrameRate: 30,
      targets: [{ resolution: "720p" }],
      estimator: { ...estimator, rounding: "floor-each" },
    }),
    (error: unknown) => error instanceof AbrUsageError && error.code === "abr_estimator_unsupported",
  );
  const renditions = [{ name: "720p", video: { actualFrames: 300, width: 1280, height: 720 } }];
  assert.throws(
    () => reconcileAbrUsage({ renditions, signedUnit: ABR_WORK_UNIT, signedUnits: 277, maximumUnits: 276 }),
    (error: unknown) => error instanceof AbrUsageError && error.code === "abr_usage_exceeds_funding",
  );
  assert.throws(
    () => reconcileAbrUsage({ renditions, signedUnit: ABR_WORK_UNIT, signedUnits: 275, maximumUnits: 300 }),
    (error: unknown) => error instanceof AbrUsageError && error.code === "abr_usage_claim_mismatch",
  );
});
