import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  AssetRepo,
  EncodingJobRepo,
  PaidOperationRepo,
  RenditionRepo,
} from "../../src/engine/repo/index.js";
import type {
  PaidJobClient,
  PaidJobRequest,
  StorageProvider,
} from "../../src/engine/interfaces/index.js";
import type { Asset, PaidOperation, SelectedWorkerRoute } from "../../src/engine/types/index.js";
import { runPaidAbrAsset } from "../../src/engine/service/paidAbrOrchestrator.js";

test("VOD dispatch persists and settles one complete paid ABR job", async () => {
  const events: string[] = [];
  const asset: Asset = {
    id: "asset-1",
    apiKeyId: "api-key-1",
    status: "queued",
    sourceType: "upload",
    sourceUrl: "source/input.mp4",
    encodingTier: "baseline",
    createdAt: new Date("2026-08-24T00:00:00Z"),
  };
  const storage = {
    async getSignedDownloadUrl() { return "https://storage.example/source.mp4?signature=secret"; },
    async putSignedUploadUrl(value: { assetId: string; codec?: string; resolution?: string; filename: string }) {
      const key = ["vod", value.assetId, value.codec && value.resolution ? `${value.codec}-${value.resolution}` : undefined, value.filename]
        .filter(Boolean).join("/");
      return { storageKey: key, url: `https://storage.example/${key}?signature=secret` };
    },
  } as unknown as StorageProvider;
  let renditionSequence = 0;
  const renditionIds = new Map<string, string>();
  const renditionRepo = {
    async insert(value: { resolution: string }) {
      const id = `rendition-${++renditionSequence}`;
      renditionIds.set(value.resolution, id);
      return { ...value, id, createdAt: new Date() };
    },
  } as unknown as RenditionRepo;
  const assetRepo = {
    async updateStatus() { events.push("probe-recorded"); },
  } as unknown as AssetRepo;
  const jobRepo = {
    async insert(value: object) {
      events.push("job-recorded");
      return { ...value, id: "encoding-job-1", attemptCount: 0, createdAt: new Date() };
    },
  } as unknown as EncodingJobRepo;
  const operation = {
    id: "operation-1",
    lifecycleVersion: "1",
  } as PaidOperation;
  let terminalValue: Parameters<PaidOperationRepo["recordVodTerminal"]>[2] | undefined;
  const paidOperationRepo = {
    async insertWithSecrets(value: { requestId: string }, secrets: unknown) {
      events.push("operation-persisted");
      assert.match(value.requestId, /^pending:req_/);
      assert.ok(secrets);
      return operation;
    },
    async recordVodTerminal(_id: string, _claim: unknown, value: Parameters<PaidOperationRepo["recordVodTerminal"]>[2]) {
      events.push("product-settled");
      terminalValue = value;
      return true;
    },
  } as unknown as PaidOperationRepo;
  let dispatches = 0;
  const paidJobClient = {
    async execute(input: PaidJobRequest) {
      dispatches += 1;
      events.push("network-dispatched");
      const request = JSON.parse(Buffer.from(input.body).toString("utf8")) as {
        workload_id: string;
        output: {
          manifest: { artifact_uri: string };
          renditions: Record<string, { playlist: { artifact_uri: string }; stream: { artifact_uri: string } }>;
        };
      };
      const terminal = {
        schema: "video-transcode-abr-result/v2",
        workload_id: request.workload_id,
        request_sha256: await import("node:crypto").then(({ createHash }) => createHash("sha256").update(input.body).digest("hex")),
        outcome: "succeeded",
        manifest_uri: request.output.manifest.artifact_uri,
        renditions: Object.entries(request.output.renditions).map(([name, output]) => ({
          name,
          playlist_uri: output.playlist.artifact_uri,
          stream_uri: output.stream.artifact_uri,
          video: { actual_frames: 1, width: name === "720p" ? 1280 : name === "480p" ? 854 : 640, height: Number.parseInt(name, 10) },
          file_size_bytes: 1,
        })),
        usage: { unit: "video-frame-megapixel", units: 2 },
      };
      const settlement = {
        brokerJobId: "broker-job-1",
        actualUnits: 2,
        workUnit: "video-frame-megapixel",
        outcome: "EXACT",
        envelope: { payload: {}, signature: { algorithm: "secp256k1" as const, canonicalization: "jcs" as const, value: `0x${"11".repeat(65)}` } },
      };
      await input.validateTerminal?.({
        brokerBody: Buffer.from(`event: result\ndata: ${JSON.stringify(terminal)}\n\n`),
        settlement,
      });
      return {
        kind: "settled" as const,
        opened: { operationId: "loc-operation-1", requestId: "broker-request-1" },
        brokerStatus: 200,
        brokerContentType: "text/event-stream",
        brokerBody: Buffer.from("terminal"),
        settlement,
        accounting: {},
      };
    },
  } as unknown as PaidJobClient;

  await runPaidAbrAsset({
    assetRepo,
    jobRepo,
    renditionRepo,
    paidOperationRepo,
    storage,
    sourceProbe: { async probe() { return { durationSec: 1, width: 1920, height: 1080, frameRate: 1, audioCodec: "aac", videoCodec: "h264", raw: {} }; } },
    paidJobClient,
    owner: "gateway-test",
    recoveryLeaseMs: 60_000,
  }, { asset, route: route() });

  assert.equal(dispatches, 1);
  assert.deepEqual(events, ["probe-recorded", "job-recorded", "operation-persisted", "network-dispatched", "product-settled"]);
  assert.equal(terminalValue?.brokerRequestId, "broker-request-1");
  assert.equal(terminalValue?.renditions.length, 3);
  assert.deepEqual(new Set(terminalValue?.renditions.map((value) => value.renditionId)), new Set(renditionIds.values()));
});

function route(): SelectedWorkerRoute {
  return {
    workerUrl: "https://broker.example",
    ethAddress: "0x1111111111111111111111111111111111111111",
    capability: "video:transcode.abr",
    offering: "abr",
    pricePerWorkUnitWei: "1",
    unitsPerPrice: "1",
    workUnit: "video-frame-megapixel",
    protocol: "paid-job/v1",
    job: { transports: ["stream"] },
    session: null,
    workUnitEstimator: { id: "abr-output-frame-megapixels/v1", rounding: "ceil-total", exactness: "ceiling" },
    settlementKeys: [{ publicKey: "0x02", notBefore: "2026-01-01T00:00:00Z", expiresAt: "2027-01-01T00:00:00Z", introducedInPublicationSeq: "1" }],
    quoteId: "quote-1",
    quoteVersion: "1",
    constraintFingerprint: Uint8Array.from([1]),
    routeFingerprint: Uint8Array.from([2]),
  };
}
