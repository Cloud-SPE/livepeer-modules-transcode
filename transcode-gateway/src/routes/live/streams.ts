import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Config } from "../../config.js";
import type { DbPool } from "../../db/pool.js";
import type { Logger, PaidSessionClient, WorkerResolver } from "../../engine/interfaces/index.js";
import type { LiveStreamRepo, PlaybackIdRepo } from "../../engine/repo/index.js";
import type { LiveSessionDirectory } from "../../livepeer/liveSessionDirectory.js";
import type { PaidSessionStore } from "../../livepeer/paidSessionStore.js";
import { openPaidLiveStream } from "../../engine/service/paidLiveOpen.js";
import { makeUserApiKeyAuth } from "../../middleware/userApiKeyAuth.js";

// Breaking v2 live surface: the gateway is always public ingest and opens one
// runner-owned paid-session/v1 session behind its private relay boundary.

export interface LiveStreamsDeps {
  pool: DbPool;
  config: Config;
  workerResolver: WorkerResolver;
  paidSessionClient: PaidSessionClient | null;
  paidSessionStore: PaidSessionStore | null;
  liveSessions: LiveSessionDirectory;
  liveStreamRepo: LiveStreamRepo;
  playbackIdRepo: PlaybackIdRepo;
  logger?: Logger;
}

const createBody = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  encoding_tier: z.enum(["baseline", "standard", "premium"]).default("standard"),
  offering: z.string().optional(),
});

const idParam = z.object({ id: z.string().min(1) });

function newStreamId(): string {
  return `live_${randomBytes(8).toString("hex")}`;
}

function publicStatus(status: string): string {
  if (status === "active" || status === "reconnecting") return "live";
  return status;
}

export function registerLiveStreams(app: FastifyInstance, deps: LiveStreamsDeps): void {
  const auth = makeUserApiKeyAuth({ pool: deps.pool, config: deps.config });

  // POST /v1/live/streams
  app.post("/v1/live/streams", { preHandler: auth }, async (req, reply) => {
    if (
      !deps.paidSessionClient ||
      !deps.paidSessionStore ||
      !deps.config.LIVEPEER_GATEWAY_EXTERNAL_RTMP_URL ||
      !deps.config.RTMP_RELAY_ENABLED
    ) {
      reply.code(503).send({
        status: "error",
        error: "paid_session_not_configured",
        message: "live streaming requires resolver, LOC, encrypted operation storage, and gateway RTMP relay",
      });
      return;
    }

    const parsed = createBody.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400).send({
        status: "error",
        message: parsed.error.issues[0]?.message ?? "Invalid body.",
      });
      return;
    }

    const apiKey = req.apiKey!;
    const streamId = newStreamId();
    const offering = parsed.data.offering ?? deps.config.LIVEPEER_LIVE_OFFERING_DEFAULT;
    const name = parsed.data.name?.trim() || streamId;

    const route = await deps.workerResolver.selectWorker({
      capability: "video:live.rtmp",
      offering,
      tier: parsed.data.encoding_tier,
    });
    if (!route) {
      reply.code(503).send({ status: "error", error: "no_live_route", message: "no video:live.rtmp route is currently available" });
      return;
    }
    let session;
    try {
      session = await openPaidLiveStream({
        liveStreamRepo: deps.liveStreamRepo,
        playbackIdRepo: deps.playbackIdRepo,
        paidSessionStore: deps.paidSessionStore,
        paidSessionClient: deps.paidSessionClient,
        liveSessions: deps.liveSessions,
        gatewayRtmpUrl: deps.config.LIVEPEER_GATEWAY_EXTERNAL_RTMP_URL,
        estimatedRunwayUnits: deps.config.LIVEPEER_LIVE_INITIAL_RUNWAY_UNITS,
        maxTotalUnits: deps.config.LIVEPEER_LIVE_MAX_TOTAL_UNITS,
        logger: deps.logger,
      }, {
        streamId,
        apiKeyId: apiKey.id,
        name,
        encodingTier: parsed.data.encoding_tier,
        route,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "live_session_open_failed";
      reply.code(502).send({
        status: "error",
        error: "live_session_open_failed",
        message: "the paid live session could not be opened",
      });
      deps.logger?.error("live.open_failed", { stream_id: streamId, error: message });
      return;
    }

    reply.code(201).send({
      stream_id: session.streamId,
      api_key_id: apiKey.id,
      name,
      session_id: session.brokerSessionId,
      rtmp_push_url: session.rtmpPushUrl,
      rtmp_push_url_kind: "gateway_relay",
      stream_key: session.streamKey,
      hls_playback_url: session.hlsPlaybackUrl,
      playback_id: session.playbackId,
      encoding_tier: parsed.data.encoding_tier,
      expires_at: session.expiresAt,
      request_id: session.requestId,
    });
  });

  // GET /v1/live/streams/:id
  app.get("/v1/live/streams/:id", { preHandler: auth }, async (req, reply) => {
    const parsed = idParam.safeParse(req.params);
    if (!parsed.success) {
      reply.code(400).send({ status: "error", message: "Invalid id." });
      return;
    }
    const apiKey = req.apiKey!;
    const stream = await deps.liveStreamRepo.byId(parsed.data.id);
    if (!stream || stream.apiKeyId !== apiKey.id) {
      reply.code(404).send({ status: "error", message: "Stream not found." });
      return;
    }
    const session = stream.sessionId
      ? deps.liveSessions.get(stream.sessionId)
      : deps.liveSessions.getByStreamId(stream.id);

    return {
      stream_id: stream.id,
      api_key_id: stream.apiKeyId,
      name: stream.name ?? stream.id,
      status: publicStatus(stream.status),
      session_id: stream.sessionId ?? null,
      playback_url: session?.hlsPlaybackUrl ?? null,
      created_at: stream.createdAt.toISOString(),
      ended_at: stream.endedAt?.toISOString() ?? null,
    };
  });

  // POST /v1/live/streams/:id/end
  app.post("/v1/live/streams/:id/end", { preHandler: auth }, async (req, reply) => {
    const parsed = idParam.safeParse(req.params);
    if (!parsed.success) {
      reply.code(400).send({ status: "error", message: "Invalid id." });
      return;
    }
    const apiKey = req.apiKey!;
    const stream = await deps.liveStreamRepo.byId(parsed.data.id);
    if (!stream || stream.apiKeyId !== apiKey.id) {
      reply.code(404).send({ status: "error", message: "Stream not found." });
      return;
    }
    if (stream.endedAt) {
      return {
        stream_id: stream.id,
        status: "ended",
        ended_at: stream.endedAt.toISOString(),
      };
    }
    if (!deps.paidSessionStore) {
      reply.code(503).send({ status: "error", error: "paid_session_not_configured" });
      return;
    }
    const operation = await deps.paidSessionStore.requestWinddown(stream.id, "customer_end");
    if (!operation) {
      reply.code(409).send({
        status: "error",
        error: "paid_session_winddown_unavailable",
        message: "the paid session has no recoverable winddown state",
      });
      return;
    }
    reply.code(202);
    return {
      stream_id: stream.id,
      status: "ending",
      ended_at: null,
    };
  });
}
