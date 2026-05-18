import { createHash, randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Config } from "../../config.js";
import type { DbPool } from "../../db/pool.js";
import type { Logger } from "../../engine/interfaces/index.js";
import type { LiveStreamRepo, PlaybackIdRepo } from "../../engine/repo/index.js";
import type { LiveSessionDirectory } from "../../livepeer/liveSessionDirectory.js";
import type { VideoRouteSelector } from "../../livepeer/routeSelector.js";
import { openRtmpSession } from "../../livepeer/rtmpAdapter.js";
import { buildLiveSelectionHints } from "../../livepeer/selectionPolicy.js";
import { makeUserApiKeyAuth } from "../../middleware/userApiKeyAuth.js";

// Live streams routes (plan 0006 §4.4).
//
// NOTE: `rtmp_push_url` returned to the customer is the BROKER's URL in v0.
// Plan 0007 adds the gateway-side RTMP listener + per-stream relay and flips
// this to a gateway-hosted URL. See docs/design-docs/live-pipeline.md for
// the two-plan transition.

export interface LiveStreamsDeps {
  pool: DbPool;
  config: Config;
  routeSelector: VideoRouteSelector | null;
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

function newPlaybackId(): string {
  return `pb_${randomBytes(12).toString("hex")}`;
}

function parseStreamKey(rtmpUrl: string): string {
  const segments = rtmpUrl.split("/");
  return segments[segments.length - 1] ?? "";
}

function hashStreamKey(streamKey: string): string {
  return createHash("sha256").update(streamKey).digest("hex");
}

function publicStatus(status: string): string {
  if (status === "active" || status === "reconnecting") return "live";
  return status;
}

export function registerLiveStreams(app: FastifyInstance, deps: LiveStreamsDeps): void {
  const auth = makeUserApiKeyAuth({ pool: deps.pool, config: deps.config });

  // POST /v1/live/streams
  app.post("/v1/live/streams", { preHandler: auth }, async (req, reply) => {
    if (!deps.routeSelector) {
      reply.code(503).send({
        status: "error",
        error: "resolver_not_configured",
        message: "LIVEPEER_RESOLVER_SOCKET must be set for live streaming",
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
    const offering = parsed.data.offering ?? deps.config.LIVEPEER_VOD_OFFERING_DEFAULT;
    const name = parsed.data.name?.trim() || streamId;

    const hints = buildLiveSelectionHints({ encodingTier: parsed.data.encoding_tier });

    let session;
    try {
      session = await openRtmpSession({
        routeSelector: deps.routeSelector,
        callerId: apiKey.id,
        offering,
        streamId,
        ...(req.headers !== undefined
          ? { requestHeaders: req.headers as Record<string, string | string[] | undefined> }
          : {}),
        selectionHints: hints,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "live_session_open_failed";
      if (message.includes("no video:live.rtmp route available")) {
        reply.code(503).send({
          status: "error",
          error: "no_live_route",
          message: "no video:live.rtmp route is currently available",
        });
        return;
      }
      reply.code(502).send({
        status: "error",
        error: "live_session_open_failed",
        message,
      });
      return;
    }

    const streamKey = parseStreamKey(session.brokerRtmpUrl);
    const streamKeyHash = hashStreamKey(streamKey);
    const createdAt = new Date();

    deps.liveSessions.record({
      streamId,
      sessionId: session.sessionId,
      brokerUrl: session.brokerUrl,
      brokerRtmpUrl: session.brokerRtmpUrl,
      streamKey,
      hlsPlaybackUrl: session.hlsUrl,
    });

    await deps.liveStreamRepo.insert({
      id: streamId,
      apiKeyId: apiKey.id,
      name,
      streamKeyHash,
      status: "active",
      ingestProtocol: "rtmp",
      sessionId: session.sessionId,
      workerUrl: session.brokerUrl,
      selectedCapability: "video:live.rtmp",
      selectedOffering: offering,
      lastSeenAt: createdAt,
    });

    const playbackIdRow = await deps.playbackIdRepo.insert({
      id: newPlaybackId(),
      apiKeyId: apiKey.id,
      liveStreamId: streamId,
      policy: "public",
      tokenRequired: false,
    });

    // Plan-0007 swap point: gateway-hosted URL replaces brokerRtmpUrl here.
    reply.code(201).send({
      stream_id: streamId,
      api_key_id: apiKey.id,
      name,
      session_id: session.sessionId,
      rtmp_push_url: session.brokerRtmpUrl,
      rtmp_push_url_kind: "broker_direct",
      stream_key: streamKey,
      hls_playback_url: session.hlsUrl,
      playback_id: playbackIdRow.id,
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
    const endedAt = new Date();
    await deps.liveStreamRepo.updateStatus(stream.id, "ended", {
      lastSeenAt: endedAt,
      endedAt,
    });
    if (stream.sessionId) deps.liveSessions.remove(stream.sessionId);
    return {
      stream_id: stream.id,
      status: "ended",
      ended_at: endedAt.toISOString(),
    };
  });
}
