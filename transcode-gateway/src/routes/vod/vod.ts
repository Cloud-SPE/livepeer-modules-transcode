import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Config } from "../../config.js";
import type { DbPool } from "../../db/pool.js";
import type { Logger, StorageProvider, WorkerClient, WorkerResolver } from "../../engine/interfaces/index.js";
import type {
  AssetRepo,
  EncodingJobRepo,
  PlaybackIdRepo,
  RenditionRepo,
} from "../../engine/repo/index.js";
import { defaultEncodingLadder } from "../../engine/config/encodingLadder.js";
import { probeAndSchedule } from "../../engine/service/jobOrchestrator.js";
import { buildVodSelectionHints } from "../../livepeer/selectionPolicy.js";
import { makeUserApiKeyAuth } from "../../middleware/userApiKeyAuth.js";

// VOD routes (plan 0005 §3.6). Submit calls probeAndSchedule fire-and-forget
// (single-instance v0). All asset reads are scoped by api_key_id to prevent
// cross-tenant enumeration.

export interface VodDeps {
  pool: DbPool;
  config: Config;
  storage: StorageProvider | null;
  workerResolver: WorkerResolver;
  workerClient: WorkerClient;
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

function newPlaybackId(): string {
  return `pb_${randomBytes(12).toString("hex")}`;
}

async function createPlaybackIdForAsset(
  deps: Pick<VodDeps, "playbackIdRepo">,
  asset: { id: string; apiKeyId: string },
): Promise<void> {
  const existing = await deps.playbackIdRepo.byAsset(asset.id);
  if (existing.length > 0) return;
  await deps.playbackIdRepo.insert({
    id: newPlaybackId(),
    apiKeyId: asset.apiKeyId,
    assetId: asset.id,
    policy: "public",
    tokenRequired: false,
  });
}

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
  const ladder = defaultEncodingLadder();

  // POST /v1/vod/submit
  app.post("/v1/vod/submit", { preHandler: auth }, async (req, reply) => {
    const parsed = submitBody.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400).send({ status: "error", message: parsed.error.issues[0]?.message ?? "Invalid body." });
      return;
    }

    const apiKey = req.apiKey!;
    const asset = await deps.assetRepo.byId(parsed.data.asset_id);
    if (!asset || asset.deletedAt || asset.apiKeyId !== apiKey.id) {
      reply.code(404).send({ status: "error", message: "Asset not found." });
      return;
    }

    const hints = buildVodSelectionHints({ encodingTier: parsed.data.encoding_tier });
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

    await deps.assetRepo.updateStatus(asset.id, "queued", {
      encodingTier: parsed.data.encoding_tier,
      selectedOffering: route.offering,
    });

    // Fire-and-forget orchestrator. Logger captures any background failures.
    void probeAndSchedule({
      asset: { ...asset, encodingTier: parsed.data.encoding_tier },
      assetRepo: deps.assetRepo,
      jobRepo: deps.jobRepo,
      renditionRepo: deps.renditionRepo,
      storage: deps.storage as StorageProvider,
      workerResolver: deps.workerResolver,
      workerClient: deps.workerClient,
      ladder,
      logger: deps.logger,
      apiKeyId: apiKey.id,
      callerTier: parsed.data.encoding_tier,
      workerOffering: route.offering,
      onAssetReady: async (assetId) => {
        await createPlaybackIdForAsset(deps, { id: assetId, apiKeyId: apiKey.id });
      },
    }).catch((err) => {
      deps.logger?.error("vod.submit.background_failed", {
        asset_id: asset.id,
        error: err instanceof Error ? err.message : String(err),
      });
    });

    // Used to silence "hints unused when supportFilter is not threaded".
    // selectionPolicy hints feed into a future route-selector call once
    // the engine's WorkerResolver is parameterized; for now the resolver
    // selects without hints. See plan 0005 §3.6 step 4.
    void hints;

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
