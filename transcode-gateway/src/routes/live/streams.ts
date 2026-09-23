import { LocTransportError } from "../../engine/interfaces/index.js";
import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Config } from "../../config.js";
import type { DbPool } from "../../db/pool.js";
import type { LiveStream, PaidOperation } from "../../engine/types/index.js";
import type { Logger, PaidSessionClient, WorkerResolver } from "../../engine/interfaces/index.js";
import type { LiveStreamRepo, PlaybackIdRepo } from "../../engine/repo/index.js";
import type { LiveSessionDirectory } from "../../livepeer/liveSessionDirectory.js";
import type { PaidSessionStore } from "../../livepeer/paidSessionStore.js";
import { openPaidLiveStream } from "../../engine/service/paidLiveOpen.js";
import { makeUserApiKeyAuth } from "../../middleware/userApiKeyAuth.js";
import { customerOperationStatus } from "../paidOperationStatus.js";

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

function publicStatus(stream: LiveStream, operation: PaidOperation | null): string {
  if (operation?.status === "failed") return "failed";
  if (stream.endedAt || operation?.terminalAt) return "ended";
  if (operation?.status.startsWith("winddown") || operation?.sessionRuntime?.winddownReason) return "ending";
  if (operation?.status === "opening" || operation?.status === "issuing_key") return "opening";
  if (operation?.sessionRuntime?.outputState === "producing") return "live";
  if (stream.status === "active" || stream.status === "reconnecting") return "ready";
  return stream.status;
}

export function registerLiveStreams(app: FastifyInstance, deps: LiveStreamsDeps): void {
  const auth = makeUserApiKeyAuth({ pool: deps.pool, config: deps.config });

  // POST /v1/live/streams
  app.post("/v1/live/streams", { preHandler: auth }, async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    if (
      !deps.paidSessionClient ||
      !deps.paidSessionStore ||
      !deps.config.LIVEPEER_GATEWAY_EXTERNAL_RTMP_URL ||
      !deps.config.RTMP_RELAY_ENABLED
    ) {
      reply.code(503).send({
        status: "error",
        error: "paid_session_not_configured",
        message: "live streaming requires LOC discovery, encrypted operation storage, and gateway RTMP relay",
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

    let route: Awaited<ReturnType<WorkerResolver["selectWorker"]>>;
    try {
      route = await deps.workerResolver.selectWorker({
        capability: "video:transcode.live",
        offering,
        tier: parsed.data.encoding_tier,
      });
    } catch (error) {
      if (!(error instanceof LocTransportError)) throw error;
      const requestId = req.requestId ?? req.id;
      const authFailure = error.status === 401 || error.status === 403;
      const status = error.code === "loc_timeout" ? 504 : error.retryable ? 503 : 502;
      req.log.warn({
        request_id: requestId, loc_code: error.code, upstream_status: error.status,
        remote_code: error.remoteCode, retryable: error.retryable,
        capability: "video:transcode.live", offering,
      }, "live.discovery_failed");
      if (error.retryAfterSeconds !== undefined) reply.header("Retry-After", error.retryAfterSeconds);
      return reply.code(status).send({
        status: "error", error: authFailure ? "loc_auth_failed" : error.code,
        message: authFailure
          ? "LOC rejected this gateway's credentials. Ask the operator to check LOC configuration. No live stream was created."
          : error.code === "loc_timeout"
            ? "LOC route discovery timed out. No live stream was created. Please try again."
            : error.retryable
              ? "LOC route discovery is temporarily unavailable. No live stream was created. Please try again."
              : "LOC could not provide a valid live route. No live stream was created. Ask the operator to check gateway logs.",
        retryable: error.retryable, request_id: requestId,
      });
    }
    if (!route) {
      reply.code(503).send({ status: "error", error: "no_live_route", message: "no video:transcode.live route is currently available" });
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
      const operation = await deps.paidSessionStore.byLiveStreamId(streamId);
      if (operation) {
        reply.header("Location", `/v1/live/streams/${streamId}`).header("Retry-After", "5").code(202).send({
          stream_id: streamId, name, status: "opening", paid_operation: customerOperationStatus(operation),
          message: "Stream setup is pending. This request will be recovered automatically; do not submit another stream.",
        });
      } else {
        reply.code(502).send({ status: "error", error: "live_session_open_failed", message: "Stream setup failed before a recoverable operation was saved." });
      }
      deps.logger?.error("live.open_failed", { stream_id: streamId, error: message,
        ...(err instanceof LocTransportError ? { loc_code: err.code, loc_operation: err.operation, upstream_status: err.status, remote_code: err.remoteCode } : {}),
      });
      return;
    }

    reply.code(201).send({
      status: "ready",
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

  app.get("/v1/live/streams", { preHandler: auth }, async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    const streams = await deps.liveStreamRepo.listForApiKey(req.apiKey!.id);
    return { streams: await Promise.all(streams.map(async (stream) => {
      const operation = await deps.paidSessionStore?.byLiveStreamId(stream.id) ?? null;
      return { stream_id: stream.id, name: stream.name ?? stream.id, status: publicStatus(stream, operation),
        paid_operation: customerOperationStatus(operation), created_at: stream.createdAt.toISOString(), ended_at: stream.endedAt?.toISOString() ?? null };
    })) };
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
    const operation = await deps.paidSessionStore?.byLiveStreamId(stream.id) ?? null;

    reply.header("Cache-Control", "no-store");
    const status = publicStatus(stream, operation);
    const ready = status === "ready" || status === "live";
    return {
      stream_id: stream.id,
      api_key_id: stream.apiKeyId,
      name: stream.name ?? stream.id,
      status,
      rtmp_push_url: ready && session ? deps.config.LIVEPEER_GATEWAY_EXTERNAL_RTMP_URL : null,
      stream_key: ready ? session?.streamKey ?? null : null,
      rtmp_push_url_kind: "gateway_relay",
      paid_operation: customerOperationStatus(operation),
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
