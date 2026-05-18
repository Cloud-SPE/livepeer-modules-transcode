// Modeled on livepeer-network-modules/video-gateway/src/engine/service/jobOrchestrator.ts.
// Edits (per docs/exec-plans/active/0003-engine-port.md §3.5):
//   - Wallet / reservation handle dance dropped (no billing in v0)
//   - EventBus.emit calls dropped (no webhooks in v0); logger.info kept
//   - costQuoter + pricing imports dropped
//   - callerId → apiKeyId
//   - Math.random() makeId replaced with crypto.randomBytes

import { randomBytes } from "node:crypto";
import type {
  Asset,
  EncodingJob,
  ProbeResult,
  RenditionSpec,
  SelectedWorkerRoute,
} from "../types/index.js";
import { VideoCoreError } from "../types/index.js";
import type {
  Logger,
  StorageProvider,
  WorkerClient,
  WorkerResolver,
} from "../interfaces/index.js";
import type { AssetRepo, EncodingJobRepo, RenditionRepo } from "../repo/index.js";
import { buildMasterManifest, manifestRenditionsFromSpecs } from "./manifestBuilder.js";
import { expandTier, type EncodingLadder } from "../config/encodingLadder.js";

export interface OrchestratorDeps {
  assetRepo: AssetRepo;
  jobRepo: EncodingJobRepo;
  renditionRepo: RenditionRepo;
  storage: StorageProvider;
  workerResolver: WorkerResolver;
  workerClient: WorkerClient;
  ladder: EncodingLadder;
  logger?: Logger;
  apiKeyId: string;
  callerTier: string;
  workerOffering: string;
  workerSelectionMinWeight?: number;
  // Fires after the asset is marked ready (post-manifest finalize). Used by
  // the VOD route layer to create a media.playback_ids row. Errors are
  // logged but do not roll back the ready state.
  onAssetReady?: (assetId: string) => Promise<void>;
}

export interface EncodeResult {
  storageKey: string;
  durationSec: number;
  segmentCount?: number;
}

export async function probeAndSchedule(
  deps: OrchestratorDeps & { asset: Asset },
): Promise<void> {
  const { asset, assetRepo, storage, workerResolver, workerClient, ladder, apiKeyId, logger } = deps;

  const route = await workerResolver.selectWorker({
    capability: "video:transcode.abr",
    offering: deps.workerOffering,
    tier: deps.callerTier,
    ...(deps.workerSelectionMinWeight !== undefined
      ? { minWeight: deps.workerSelectionMinWeight }
      : {}),
  });
  if (!route) {
    await markErrored(deps, asset.id, "NoWorkersAvailable", "no workers can do video:transcode.abr");
    return;
  }

  const sourceKey = storage.pathFor({
    assetId: asset.id,
    kind: "source",
    filename: asset.sourceUrl ? (asset.sourceUrl.split("/").pop() ?? "source") : "source.mp4",
  });
  const inputUrl =
    asset.sourceUrl?.startsWith("s3://") || asset.sourceUrl?.startsWith("http")
      ? asset.sourceUrl
      : await storage.getSignedDownloadUrl({ storageKey: sourceKey, expiresInSec: 3600 });

  const probeJob = await deps.jobRepo.insert({
    id: `job_${makeId()}`,
    assetId: asset.id,
    kind: "probe",
    status: "queued",
    inputUrl,
    attemptCount: 0,
  });
  await deps.jobRepo.updateStatus(probeJob.id, "running", {
    workerUrl: route.workerUrl,
    startedAt: new Date(),
  });

  let probe: ProbeResult;
  try {
    probe = await workerClient.callWorker<{ input_url: string; job_id: string }, ProbeResult>({
      route,
      path: "/v1/video/transcode/probe",
      method: "POST",
      body: { input_url: inputUrl, job_id: probeJob.id },
      callerId: apiKeyId,
      timeoutMs: 60_000,
    });
  } catch (err) {
    await deps.jobRepo.updateStatus(probeJob.id, "failed", {
      errorMessage: stringifyError(err),
      completedAt: new Date(),
    });
    await markErrored(deps, asset.id, "WorkerError", `probe failed: ${stringifyError(err)}`);
    return;
  }

  await deps.jobRepo.updateStatus(probeJob.id, "completed", { completedAt: new Date() });
  await assetRepo.updateStatus(asset.id, "preparing", {
    durationSec: probe.durationSec,
    width: probe.width,
    height: probe.height,
    frameRate: probe.frameRate,
    audioCodec: probe.audioCodec,
    videoCodec: probe.videoCodec,
    ffprobeJson: probe.raw,
  });

  const renditions = expandTier(asset.encodingTier, ladder);
  const renditionRows: Array<{ id: string; spec: RenditionSpec }> = [];
  for (const r of renditions) {
    const row = await deps.renditionRepo.insert({
      id: `rend_${makeId()}`,
      assetId: asset.id,
      resolution: r.resolution,
      codec: r.codec,
      bitrateKbps: r.bitrateKbps,
      status: "queued",
    });
    renditionRows.push({ id: row.id, spec: r });
    await deps.jobRepo.insert({
      id: `job_${makeId()}`,
      assetId: asset.id,
      renditionId: row.id,
      kind: "encode",
      status: "queued",
      inputUrl,
      attemptCount: 0,
    });
  }
  await deps.jobRepo.insert({
    id: `job_${makeId()}`,
    assetId: asset.id,
    kind: "thumbnail",
    status: "queued",
    attemptCount: 0,
  });
  await deps.jobRepo.insert({
    id: `job_${makeId()}`,
    assetId: asset.id,
    kind: "finalize",
    status: "queued",
    attemptCount: 0,
  });

  logger?.info("orchestrator.scheduled", { asset_id: asset.id, renditions: renditions.length });

  await runEncodePhase(deps, asset.id, route, inputUrl);
  await runFinalize(deps, asset.id, renditionRows);
}

async function runEncodePhase(
  deps: OrchestratorDeps,
  assetId: string,
  route: SelectedWorkerRoute,
  inputUrl: string,
): Promise<void> {
  const queued = await deps.jobRepo.queued(assetId, ["encode", "thumbnail"]);
  const cap = 4;
  let i = 0;
  async function worker(): Promise<void> {
    while (true) {
      const idx = i++;
      if (idx >= queued.length) return;
      const job = queued[idx];
      if (!job) return;
      await runOneJob(deps, job, route, inputUrl);
    }
  }
  await Promise.all(Array.from({ length: Math.min(cap, queued.length) }, () => worker()));
}

async function runOneJob(
  deps: OrchestratorDeps,
  job: EncodingJob,
  route: SelectedWorkerRoute,
  inputUrl: string,
): Promise<void> {
  await deps.jobRepo.updateStatus(job.id, "running", {
    workerUrl: route.workerUrl,
    startedAt: new Date(),
  });
  try {
    if (job.kind === "encode") {
      if (!job.renditionId) throw new Error("encode job without rendition_id");
      const renditions = await deps.renditionRepo.byAsset(job.assetId);
      const rend = renditions.find((r) => r.id === job.renditionId);
      if (!rend) throw new Error("rendition not found");

      const outputPrefix = deps.storage.pathFor({
        assetId: job.assetId,
        kind: "rendition",
        codec: rend.codec,
        resolution: rend.resolution,
        filename: "",
      });

      const result = await deps.workerClient.callWorker<unknown, EncodeResult>({
        route,
        path: "/v1/video/transcode",
        method: "POST",
        body: {
          job_id: job.id,
          input_url: inputUrl,
          output_prefix: outputPrefix,
          codec: rend.codec,
          resolution: rend.resolution,
          bitrate_kbps: rend.bitrateKbps,
        },
        callerId: deps.apiKeyId,
        timeoutMs: 30 * 60_000,
      });
      await deps.renditionRepo.updateStatus(rend.id, "completed", {
        storageKey: result.storageKey,
        durationSec: result.durationSec,
        completedAt: new Date(),
      });
      await deps.jobRepo.updateStatus(job.id, "completed", {
        completedAt: new Date(),
        outputPrefix,
      });
    } else if (job.kind === "thumbnail") {
      await deps.jobRepo.updateStatus(job.id, "completed", { completedAt: new Date() });
    }
  } catch (err) {
    await deps.jobRepo.updateStatus(job.id, "failed", {
      errorMessage: stringifyError(err),
      completedAt: new Date(),
    });
    if (job.renditionId) {
      await deps.renditionRepo.updateStatus(job.renditionId, "failed", { completedAt: new Date() });
    }
  }
}

async function runFinalize(
  deps: OrchestratorDeps,
  assetId: string,
  expected: Array<{ id: string; spec: RenditionSpec }>,
): Promise<void> {
  const all = await deps.renditionRepo.byAsset(assetId);
  const completed = all.filter((r) => r.status === "completed");
  const failedCount = all.filter((r) => r.status === "failed").length;

  if (failedCount > 0 || completed.length !== expected.length) {
    await markErrored(deps, assetId, "WorkerError", `rendition failure (${failedCount} failed)`);
    return;
  }

  const manifestRenditions = manifestRenditionsFromSpecs(
    completed.map((r) => ({
      resolution: r.resolution,
      codec: r.codec,
      bitrateKbps: r.bitrateKbps,
    })),
    (s) => `${s.codec}/${s.resolution}/playlist.m3u8`,
  );
  const masterBody = buildMasterManifest(manifestRenditions);
  const masterKey = deps.storage.pathFor({ assetId, kind: "manifest", filename: "master.m3u8" });
  await deps.storage.putObject(masterKey, masterBody, {
    contentType: "application/vnd.apple.mpegurl",
  });

  await deps.assetRepo.updateStatus(assetId, "ready", { readyAt: new Date() });
  deps.logger?.info("orchestrator.asset_ready", { asset_id: assetId });

  if (deps.onAssetReady) {
    try {
      await deps.onAssetReady(assetId);
    } catch (err) {
      deps.logger?.error("orchestrator.onAssetReady_failed", {
        asset_id: assetId,
        error: stringifyError(err),
      });
    }
  }
}

async function markErrored(
  deps: OrchestratorDeps,
  assetId: string,
  code: string,
  message: string,
): Promise<void> {
  await deps.assetRepo.updateStatus(assetId, "errored", { errorMessage: `${code}: ${message}` });
  deps.logger?.error("orchestrator.errored", { asset_id: assetId, code, message });
}

function makeId(): string {
  return randomBytes(8).toString("hex");
}

function stringifyError(err: unknown): string {
  if (err instanceof VideoCoreError) return `${err.code}: ${err.message}`;
  if (err instanceof Error) return err.message;
  return String(err);
}
