import { test } from "node:test";
import assert from "node:assert/strict";
import { createLiveSessionDirectory } from "../../src/livepeer/liveSessionDirectory.js";

const route = {
  streamId: "live_abc",
  sessionId: "sess_123",
  brokerUrl: "https://broker.example.com",
  brokerRtmpUrl: "rtmp://broker.example.com/live/key1",
  streamKey: "key1",
  hlsPlaybackUrl: "https://broker.example.com/_hls/sess_123/index.m3u8",
};

test("record + get by sessionId returns the stored route", () => {
  const dir = createLiveSessionDirectory();
  dir.record(route);
  assert.deepEqual(dir.get("sess_123"), route);
});

test("record + getByStreamId returns the stored route", () => {
  const dir = createLiveSessionDirectory();
  dir.record(route);
  assert.deepEqual(dir.getByStreamId("live_abc"), route);
});

test("get/getByStreamId on unknown id returns null", () => {
  const dir = createLiveSessionDirectory();
  assert.equal(dir.get("nope"), null);
  assert.equal(dir.getByStreamId("nope"), null);
});

test("remove drops both lookup paths", () => {
  const dir = createLiveSessionDirectory();
  dir.record(route);
  dir.remove("sess_123");
  assert.equal(dir.get("sess_123"), null);
  assert.equal(dir.getByStreamId("live_abc"), null);
});
