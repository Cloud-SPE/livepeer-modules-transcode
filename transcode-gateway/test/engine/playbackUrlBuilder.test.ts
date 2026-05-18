import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPlaybackUrl } from "../../src/engine/service/playbackUrlBuilder.js";
import type { PlaybackId } from "../../src/engine/types/index.js";

const basePlayback: Omit<PlaybackId, "policy" | "tokenRequired"> = {
  id: "pb_abc",
  apiKeyId: "00000000-0000-0000-0000-000000000000",
  assetId: "asset_1",
  createdAt: new Date(),
};

test("public playback URL has no token query param", () => {
  const url = buildPlaybackUrl({
    playbackId: { ...basePlayback, policy: "public", tokenRequired: false },
    baseUrl: "https://cdn.example.com",
  });
  assert.equal(url, "https://cdn.example.com/pb_abc.m3u8");
});

test("signed playback URL appends URL-encoded token", () => {
  const url = buildPlaybackUrl({
    playbackId: { ...basePlayback, policy: "signed", tokenRequired: true },
    baseUrl: "https://cdn.example.com/",
    signedToken: "t/k+1=",
  });
  assert.equal(url, "https://cdn.example.com/pb_abc.m3u8?token=t%2Fk%2B1%3D");
});

test("signed playback URL with no token falls back to bare URL", () => {
  const url = buildPlaybackUrl({
    playbackId: { ...basePlayback, policy: "signed", tokenRequired: true },
    baseUrl: "https://cdn.example.com",
  });
  assert.equal(url, "https://cdn.example.com/pb_abc.m3u8");
});

test("trailing slash on baseUrl is collapsed", () => {
  const url = buildPlaybackUrl({
    playbackId: { ...basePlayback, policy: "public", tokenRequired: false },
    baseUrl: "https://cdn.example.com/",
  });
  assert.equal(url, "https://cdn.example.com/pb_abc.m3u8");
});
