import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildMasterManifest,
  manifestRenditionsFromSpecs,
} from "../../src/engine/service/manifestBuilder.js";
import type { RenditionSpec } from "../../src/engine/types/index.js";

test("buildMasterManifest emits a valid HLS master playlist header", () => {
  const out = buildMasterManifest([]);
  assert.match(out, /^#EXTM3U\n/);
  assert.match(out, /#EXT-X-VERSION:6/);
  assert.match(out, /#EXT-X-INDEPENDENT-SEGMENTS/);
});

test("buildMasterManifest emits one STREAM-INF per rendition with correct bandwidth + resolution", () => {
  const out = buildMasterManifest([
    { codec: "h264", resolution: "720p", bitrateKbps: 2800, variantUri: "h264/720p/p.m3u8" },
    { codec: "hevc", resolution: "1080p", bitrateKbps: 3500, variantUri: "hevc/1080p/p.m3u8" },
  ]);
  assert.match(out, /BANDWIDTH=2800000/);
  assert.match(out, /BANDWIDTH=3500000/);
  assert.match(out, /RESOLUTION=1280x720/);
  assert.match(out, /RESOLUTION=1920x1080/);
  assert.match(out, /h264\/720p\/p\.m3u8/);
  assert.match(out, /hevc\/1080p\/p\.m3u8/);
  assert.match(out, /CODECS="avc1\.640028,mp4a\.40\.2"/);
  assert.match(out, /CODECS="hvc1\.1\.6\.L120\.B0,mp4a\.40\.2"/);
});

test("manifestRenditionsFromSpecs threads variantUri builder over each spec", () => {
  const specs: RenditionSpec[] = [
    { codec: "h264", resolution: "480p", bitrateKbps: 1400 },
    { codec: "av1",  resolution: "720p", bitrateKbps: 1540 },
  ];
  const out = manifestRenditionsFromSpecs(specs, (s) => `${s.codec}/${s.resolution}.m3u8`);
  assert.equal(out.length, 2);
  assert.equal(out[0]!.variantUri, "h264/480p.m3u8");
  assert.equal(out[1]!.variantUri, "av1/720p.m3u8");
});
