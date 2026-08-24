import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Config } from "../../config.js";
import type { DbPool } from "../../db/pool.js";
import type { Logger, PaidJobClient, SourceProbe, StorageProvider, WorkerResolver } from "../../engine/interfaces/index.js";
import type {
  AssetRepo,
  EncodingJobRepo,
  PlaybackIdRepo,
  PaidOperationRepo,
  RenditionRepo,
} from "../../engine/repo/index.js";
import { runPaidAbrAsset } from "../../engine/service/paidAbrOrchestrator.js";
import { makeUserApiKeyAuth } from "../../middleware/userApiKeyAuth.js";

// VOD routes. Submit dispatches one complete ABR ladder through paid-job/v1.
// All asset reads are scoped by api_key_id to prevent cross-tenant enumeration.

export interface VodDeps {
  pool: DbPool;
  config: Config;
  storage: StorageProvider | null;
  workerResolver: WorkerResolver;
  paidJobClient: PaidJobClient | null;
  paidOperationRepo: PaidOperationRepo | null;
  sourceProbe: SourceProbe;
  recoveryOwner: string;
  assetRepo: AssetRepo;
  jobRepo: EncodingJobRepo;
  renditionRepo: RenditionRepo;
  playbackIdRepo: PlaybackIdRepo;
  logger?: Logger;
}

const submitBody = z.object({
  asset_id: z.string().min(1),
  encoding_tier: z.enum(["baseline", "standard", "premium"]).default("standard"),
  offering: z.string().optional(),
});

const assetIdParam = z.object({ asset_id: z.string().min(1) });
const idParam = z.object({ id: z.string().min(1) });

const listQuery = z.object({
  limit: z.coerce.number().int().positive().max(200).default(50),
  cursor: z.string().optional(),
  include_deleted: z.coerce.boolean().optional().default(false),
});

function serializeAsset(asset: {
  id: string;
  apiKeyId: string;
  status: string;
  sourceType: string;
  encodingTier: string;
  durationSec?: number;
  width?: number;
  height?: number;
  frameRate?: number;
  audioCodec?: string;
  videoCodec?: string;
  selectedOffering?: string;
  createdAt: Date;
  readyAt?: Date;
  deletedAt?: Date;
  errorMessage?: string;
}, playbackId: string | null) {
  return {
    asset_id: asset.id,
    api_key_id: asset.apiKeyId,
    status: asset.status,
    source_type: asset.sourceType,
    encoding_tier: asset.encodingTier,
    duration_sec: asset.durationSec ?? null,
    width: asset.width ?? null,
    height: asset.height ?? null,
    frame_rate: asset.frameRate ?? null,
    audio_codec: asset.audioCodec ?? null,
    video_codec: asset.videoCodec ?? null,
    selected_offering: asset.selectedOffering ?? null,
    created_at: asset.createdAt.toISOString(),
    ready_at: asset.readyAt?.toISOString() ?? null,
    deleted_at: asset.deletedAt?.toISOString() ?? null,
    error_message: asset.errorMessage ?? null,
    playback_id: playbackId,
    playback_url: playbackId ? `/v1/playback/${encodeURIComponent(playbackId)}` : null,
  };
}

export function registerVod(app: FastifyInstance, deps: VodDeps): void {
  const auth = makeUserApiKeyAuth({ pool: deps.pool, config: deps.config });
  // POST /v1/vod/submit
  app.post("/v1/vod/submit", { preHandler: auth }, async (req, reply) => {
    const parsed = submitBody.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400).send({ status: "error", message: parsed.error.issues[0]?.message ?? "Invalid body." });
      return;
    }

    const apiKey = req.apiKey!;
    if (!deps.storage || !deps.paidJobClient || !deps.paidOperationRepo) {
      reply.code(503).send({
        status: "error",
        error: "paid_job_not_configured",
        message: "VOD requires S3, LOC, and an operation-secrets wrapping key",
      });
      return;
    }
    const asset = await deps.assetRepo.byId(parsed.data.asset_id);
    if (!asset || asset.deletedAt || asset.apiKeyId !== apiKey.id) {
      reply.code(404).send({ status: "error", message: "Asset not found." });
      return;
    }

    const offering = parsed.data.offering ?? deps.config.LIVEPEER_VOD_OFFERING_DEFAULT;

    const route = await deps.workerResolver.selectWorker({
      capability: "video:transcode.abr",
      offering,
      tier: parsed.data.encoding_tier,
    });
    if (!route) {
      reply.code(503).send({
        status: "error",
        error: "no_video_transcode_route",
        message: "no video:transcode.abr route is currently available",
      });
      return;
    }
    if (
      route.protocol !== "paid-job/v1" ||
      !route.job?.transports.includes("stream") ||
      route.workUnit !== "video-frame-megapixel"
    ) {
      reply.code(503).send({
        status: "error",
        error: "video_transcode_route_incompatible",
        message: "the selected route does not implement the required paid-job/v1 ABR contract",
      });
      return;
    }

    await deps.assetRepo.updateStatus(asset.id, "queued", {
      encodingTier: parsed.data.encoding_tier,
      selectedOffering: route.offering,
    });

    // Fire-and-forget orchestrator. Logger captures any background failures.
    void runPaidAbrAsset({
      assetRepo: deps.assetRepo,
      jobRepo: deps.jobRepo,
      renditionRepo: deps.renditionRepo,
      paidOperationRepo: deps.paidOperationRepo,
      storage: deps.storage,
      sourceProbe: deps.sourceProbe,
      paidJobClient: deps.paidJobClient,
      logger: deps.logger,
      owner: deps.recoveryOwner,
      recoveryLeaseMs: deps.config.VOD_RECOVERY_LEASE_MS,
    }, {
      asset: { ...asset, encodingTier: parsed.data.encoding_tier },
      route,
    }).catch((err) => {
      deps.logger?.error("vod.submit.background_failed", {
        asset_id: asset.id,
        error: err instanceof Error ? err.message : String(err),
      });
    });

    reply.code(202).send({
      asset_id: asset.id,
      api_key_id: asset.apiKeyId,
      status: "queued",
      selected_capability: "video:transcode.abr",
      selected_offering: route.offering,
      selected_broker_url: route.workerUrl,
      encoding_tier: parsed.data.encoding_tier,
    });
  });

  // Shared "fetch + serialize asset + renditions + jobs" body.
  async function fetchAssetBundle(id: string, apiKeyId: string) {
    const asset = await deps.assetRepo.byId(id);
    if (!asset || asset.apiKeyId !== apiKeyId) return null;
    const [playback] = await deps.playbackIdRepo.byAsset(asset.id);
    const renditions = await deps.renditionRepo.byAsset(asset.id);
    const jobs = await deps.jobRepo.byAsset(asset.id);
    return {
      ...serializeAsset(asset, playback?.id ?? null),
      renditions: renditions.map((r) => ({
        id: r.id,
        resolution: r.resolution,
        codec: r.codec,
        bitrate_kbps: r.bitrateKbps,
        storage_key: r.storageKey ?? null,
        status: r.status,
        duration_sec: r.durationSec ?? null,
        completed_at: r.completedAt?.toISOString() ?? null,
      })),
      jobs: jobs.map((j) => ({
        id: j.id,
        kind: j.kind,
        status: j.status,
        worker_url: j.workerUrl ?? null,
        error_message: j.errorMessage ?? null,
        started_at: j.startedAt?.toISOString() ?? null,
        completed_at: j.completedAt?.toISOString() ?? null,
      })),
    };
  }

  app.get("/v1/vod/:asset_id", { preHandler: auth }, async (req, reply) => {
    const parsed = assetIdParam.safeParse(req.params);
    if (!parsed.success) {
      reply.code(400).send({ status: "error", message: "Invalid id." });
      return;
    }
    const bundle = await fetchAssetBundle(parsed.data.asset_id, req.apiKey!.id);
    if (!bundle) {
      reply.code(404).send({ status: "error", message: "Asset not found." });
      return;
    }
    return bundle;
  });

  app.get("/v1/videos/assets/:id", { preHandler: auth }, async (req, reply) => {
    const parsed = idParam.safeParse(req.params);
    if (!parsed.success) {
      reply.code(400).send({ status: "error", message: "Invalid id." });
      return;
    }
    const bundle = await fetchAssetBundle(parsed.data.id, req.apiKey!.id);
    if (!bundle) {
      reply.code(404).send({ status: "error", message: "Asset not found." });
      return;
    }
    return bundle;
  });

  // GET /v1/videos/assets  — paginated list scoped by api_key_id
  app.get("/v1/videos/assets", { preHandler: auth }, async (req, reply) => {
    const parsed = listQuery.safeParse(req.query);
    if (!parsed.success) {
      reply.code(400).send({ status: "error", message: "Invalid query." });
      return;
    }
    const apiKey = req.apiKey!;
    const { items, nextCursor } = await deps.assetRepo.list({
      apiKeyId: apiKey.id,
      limit: parsed.data.limit,
      ...(parsed.data.cursor !== undefined ? { cursor: parsed.data.cursor } : {}),
      includeDeleted: parsed.data.include_deleted,
    });
    return {
      items: items.map((a) => ({
        id: a.id,
        api_key_id: a.apiKeyId,
        status: a.status,
        source_type: a.sourceType,
        encoding_tier: a.encodingTier,
        duration_sec: a.durationSec ?? null,
        created_at: a.createdAt.toISOString(),
        ready_at: a.readyAt?.toISOString() ?? null,
        deleted_at: a.deletedAt?.toISOString() ?? null,
      })),
      pagination: {
        limit: parsed.data.limit,
        next_cursor: nextCursor ?? null,
      },
      include_deleted: parsed.data.include_deleted,
    };
  });

  // DELETE /v1/videos/assets/:id  — soft-delete
  app.delete("/v1/videos/assets/:id", { preHandler: auth }, async (req, reply) => {
    const parsed = idParam.safeParse(req.params);
    if (!parsed.success) {
      reply.code(400).send({ status: "error", message: "Invalid id." });
      return;
    }
    const apiKey = req.apiKey!;
    const asset = await deps.assetRepo.byId(parsed.data.id);
    if (!asset || asset.apiKeyId !== apiKey.id) {
      reply.code(404).send({ status: "error", message: "Asset not found." });
      return;
    }
    await deps.assetRepo.softDelete(parsed.data.id, new Date());
    reply.code(204).send();
  });
}
