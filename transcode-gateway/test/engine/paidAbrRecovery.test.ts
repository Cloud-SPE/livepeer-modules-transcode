import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import type { PaidJobClient } from "../../src/engine/interfaces/index.js";
import type { AssetRepo, EncodingJobRepo, PaidOperationRepo, RenditionRepo } from "../../src/engine/repo/index.js";
import type { PaidOperation } from "../../src/engine/types/index.js";
import { recoverPaidAbrOperations } from "../../src/engine/service/paidAbrRecovery.js";

test("VOD recovery replays the encrypted exact request and schedules pending outcomes", async () => {
  const intent = {
    schema: "video-transcode-abr/v2",
    workload_id: "asset-1",
    input: { download_url: "https://storage.example/source?secret=1" },
    ladder: { preset: "abr-mobile" },
    output: {
      manifest: { artifact_uri: "vod/asset-1/master.m3u8", upload_url: "https://storage.example/master?secret=1" },
      renditions: {
        "720p": {
          playlist: { artifact_uri: "vod/asset-1/h264-720p/playlist.m3u8", upload_url: "https://storage.example/playlist?secret=1" },
          stream: { artifact_uri: "vod/asset-1/h264-720p/stream.mp4", upload_url: "https://storage.example/stream?secret=1" },
        },
      },
    },
  };
  const body = Buffer.from(JSON.stringify(intent));
  const operation = operationFor(createHash("sha256").update(body).digest("hex"));
  let retry: { status: string; errorCode: string } | undefined;
  const paidOperationRepo = {
    async claimRecoverable() { return [operation]; },
    async readSecrets() { return { openIntent: intent, loc: { idempotency_key: "caller-request-1" } }; },
    async recordProgress(_id: string, _claim: unknown, value: { requestId?: string; locOperationId?: string }) {
      assert.equal(value.requestId, "broker-request-1");
      assert.equal(value.locOperationId, "loc-operation-1");
      return { ...operation, lifecycleVersion: "8" };
    },
    async recordRetry(_id: string, _claim: unknown, value: { status: string; errorCode: string }) {
      retry = value;
      return { ...operation, lifecycleVersion: "9" };
    },
  } as unknown as PaidOperationRepo;
  let dispatches = 0;
  const paidJobClient = {
    async execute(value: { requestId: string; body: Uint8Array }) {
      dispatches += 1;
      assert.equal(value.requestId, "caller-request-1");
      assert.deepEqual(value.body, body);
      return {
        kind: "in_flight" as const,
        opened: { operationId: "loc-operation-1", requestId: "broker-request-1" },
        brokerJobId: "broker-job-1",
      };
    },
  } as unknown as PaidJobClient;

  const count = await recoverPaidAbrOperations({
    assetRepo: { async byId() { return { id: "asset-1", apiKeyId: "api-key-1", durationSec: 10 }; } } as unknown as AssetRepo,
    jobRepo: { async byAsset() { return [{ id: "job-1", kind: "encode", status: "running" }]; } } as unknown as EncodingJobRepo,
    renditionRepo: { async byAsset() { return [{ id: "rendition-1", resolution: "720p" }]; } } as unknown as RenditionRepo,
    paidOperationRepo,
    paidJobClient,
    owner: "gateway-new",
    leaseMs: 60_000,
    retryMs: 2_000,
  }, { now: new Date("2026-08-24T00:00:00Z") });

  assert.equal(count, 1);
  assert.equal(dispatches, 1);
  assert.deepEqual(retry, { status: "in_flight", errorCode: "in_flight", nextRetryAt: retry && "nextRetryAt" in retry ? retry.nextRetryAt : undefined });
});

function operationFor(requestContentSha256: string): PaidOperation {
  return {
    id: "operation-1",
    kind: "job",
    apiKeyId: "api-key-1",
    assetId: "asset-1",
    requestId: "broker-request-1",
    requestContentSha256,
    workId: "broker-job-1",
    rotationGeneration: 0,
    route: {
      protocol: "paid-job/v1",
      transport: "stream",
      capability: "video:transcode.abr",
      offering: "abr",
      requestDescriptor: "video-transcode-abr/v2",
      responseDescriptor: "video-transcode-abr-result/v2",
      workUnit: "video-frame-megapixel",
      estimator: { id: "abr-output-frame-megapixels/v1", rounding: "ceil-total", exactness: "ceiling" },
      pricePerUnitWei: "1",
      unitsPerPrice: "1",
      quoteId: "quote-1",
      quoteVersion: "1",
      constraintFingerprint: "01".repeat(32),
      routeFingerprint: "02".repeat(32),
      settlementKey: "key-1",
      raw: { broker_url: "https://broker.example", eth_address: "0x1111111111111111111111111111111111111111" },
    },
    status: "in_flight",
    fundedUnits: "100",
    settlementSequence: "0",
    lifecycleVersion: "7",
    recoveryOwner: "gateway-new",
    recoveryLeaseExpiresAt: new Date("2026-08-24T00:01:00Z"),
    retryCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}
