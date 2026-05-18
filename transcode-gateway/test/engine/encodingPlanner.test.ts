import { test } from "node:test";
import assert from "node:assert/strict";
import { planJobs } from "../../src/engine/service/encodingPlanner.js";
import { defaultEncodingLadder } from "../../src/engine/config/encodingLadder.js";

const ladder = defaultEncodingLadder();

test("planJobs baseline tier — h264 only across 6 resolutions", () => {
  const plan = planJobs({ asset: { encodingTier: "baseline" }, ladder });
  assert.equal(plan.probe.kind, "probe");
  assert.equal(plan.thumbnail.kind, "thumbnail");
  assert.equal(plan.finalize.kind, "finalize");
  assert.equal(plan.encodes.length, 6);
  for (const e of plan.encodes) assert.equal(e.rendition.codec, "h264");
});

test("planJobs standard tier — h264 + hevc", () => {
  const plan = planJobs({ asset: { encodingTier: "standard" }, ladder });
  assert.equal(plan.encodes.length, 12);
  const codecs = new Set(plan.encodes.map((e) => e.rendition.codec));
  assert.deepEqual([...codecs].sort(), ["h264", "hevc"]);
});

test("planJobs premium tier — h264 + hevc + av1", () => {
  const plan = planJobs({ asset: { encodingTier: "premium" }, ladder });
  assert.equal(plan.encodes.length, 18);
  const codecs = new Set(plan.encodes.map((e) => e.rendition.codec));
  assert.deepEqual([...codecs].sort(), ["av1", "h264", "hevc"]);
});

test("planJobs renditions are ordered ascending by resolution", () => {
  const plan = planJobs({ asset: { encodingTier: "baseline" }, ladder });
  const resolutions = plan.encodes.map((e) => e.rendition.resolution);
  assert.deepEqual(resolutions, ["240p", "360p", "480p", "720p", "1080p", "2160p"]);
});
