import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  AbrExchangeError,
  encodeAbrExchangeRequest,
  validateAbrTerminal,
} from "../../src/engine/service/abrExchange.js";

const fixtureRoot = new URL("../../../../abr-runner/testdata/contracts/v2/", import.meta.url);

function settlement(actualUnits = 346) {
  return {
    brokerJobId: "broker-job-1",
    actualUnits,
    workUnit: "video-frame-megapixel",
    outcome: "EXACT",
    envelope: {
      payload: {},
      signature: {
        algorithm: "secp256k1" as const,
        canonicalization: "jcs" as const,
        value: `0x${"44".repeat(65)}`,
      },
    },
  };
}

test("canonical request bytes are deterministic for exact replay", async () => {
  const request = JSON.parse(await readFile(new URL("request.json", fixtureRoot), "utf8"));
  const first = encodeAbrExchangeRequest(request);
  const replay = encodeAbrExchangeRequest(request);
  assert.deepEqual(replay.body, first.body);
  assert.equal(replay.sha256, first.sha256);
});

test("runner success fixture reconciles terminal metadata before settlement", async () => {
  const body = await readFile(new URL("result.sse", fixtureRoot));
  const result = validateAbrTerminal({
    brokerBody: body,
    settlement: settlement(),
    workloadId: "asset-fixture-001",
    requestSha256: "6ec51df51598e35eb851973ab08d2904fc3b3eed948fb211fa39b0a20a9bdef0",
    maximumUnits: 400,
  });
  assert.equal(result.renditions.length, 3);
  assert.equal(result.manifest_uri, "vod/asset-fixture-001/master.m3u8");
});

test("claim drift and failed terminal outcomes stop LOC settlement", async () => {
  const success = await readFile(new URL("result.sse", fixtureRoot));
  assert.throws(
    () => validateAbrTerminal({
      brokerBody: success,
      settlement: settlement(345),
      workloadId: "asset-fixture-001",
      requestSha256: "6ec51df51598e35eb851973ab08d2904fc3b3eed948fb211fa39b0a20a9bdef0",
      maximumUnits: 400,
    }),
    (error: unknown) => error instanceof AbrExchangeError && error.code === "abr_terminal_identity_mismatch",
  );
  const failed = await readFile(new URL("error.sse", fixtureRoot));
  assert.throws(
    () => validateAbrTerminal({
      brokerBody: failed,
      settlement: settlement(0),
      workloadId: "asset-fixture-001",
      requestSha256: "6ec51df51598e35eb851973ab08d2904fc3b3eed948fb211fa39b0a20a9bdef0",
      maximumUnits: 400,
    }),
    (error: unknown) => error instanceof AbrExchangeError && error.code === "encode_failed" && error.retryable,
  );
});
