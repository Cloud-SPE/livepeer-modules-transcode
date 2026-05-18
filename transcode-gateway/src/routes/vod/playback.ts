import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Config } from "../../config.js";
import type { StorageProvider } from "../../engine/interfaces/index.js";
import type { AssetRepo, PlaybackIdRepo } from "../../engine/repo/index.js";
import type { LiveSessionDirectory } from "../../livepeer/liveSessionDirectory.js";

// Playback router. VOD half (plan 0005) returns a signed HLS URL from
// storage. Live half (plan 0006) returns the broker's LL-HLS URL from
// the in-memory session directory. `/_hls/*` strict-proxy is a sibling
// route registered separately (src/routes/live/hlsProxy.ts).

export interface PlaybackDeps {
  config: Config;
  storage: StorageProvider | null;
  assetRepo: AssetRepo;
  playbackIdRepo: PlaybackIdRepo;
  liveSessions: LiveSessionDirectory;
}

const idParam = z.object({ id: z.string().min(1) });

export function registerVodPlayback(app: FastifyInstance, deps: PlaybackDeps): void {
  app.get("/v1/playback/:id", async (req, reply) => {
    const parsed = idParam.safeParse(req.params);
    if (!parsed.success) {
      reply.code(400).send({ status: "error", message: "Invalid playback id." });
      return;
    }

    const playback = await deps.playbackIdRepo.byId(parsed.data.id);
    if (!playback) {
      reply.code(404).send({ status: "error", message: "Playback id not found." });
      return;
    }

    if (playback.liveStreamId && !playback.assetId) {
      const session = deps.liveSessions.getByStreamId(playback.liveStreamId);
      if (!session) {
        reply.code(404).send({
          status: "error",
          error: "live_session_not_active",
          message: "live stream is not currently active",
        });
        return;
      }
      return {
        playback_id: playback.id,
        live_stream_id: playback.liveStreamId,
        hls_url: session.hlsPlaybackUrl,
        policy: playback.policy,
      };
    }

    if (!playback.assetId || !deps.storage) {
      reply.code(503).send({
        status: "error",
        error: deps.storage ? "asset_missing" : "s3_not_configured",
      });
      return;
    }

    const asset = await deps.assetRepo.byId(playback.assetId);
    if (!asset || asset.deletedAt) {
      reply.code(404).send({ status: "error", message: "Asset not found." });
      return;
    }
    if (asset.status !== "ready") {
      reply.code(409).send({
        status: "error",
        error: "asset_not_ready",
        asset_status: asset.status,
      });
      return;
    }

    const masterKey = deps.storage.pathFor({
      assetId: asset.id,
      kind: "manifest",
      filename: "master.m3u8",
    });
    const hlsUrl = await deps.storage.getSignedDownloadUrl({
      storageKey: masterKey,
      expiresInSec: deps.config.VOD_PLAYBACK_URL_TTL_SEC,
    });

    return {
      playback_id: playback.id,
      asset_id: asset.id,
      hls_url: hlsUrl,
      policy: playback.policy,
    };
  });
}
