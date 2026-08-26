import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import type { Config } from "./config.js";
import type { DbPool } from "./db/pool.js";
import type { EmailClient } from "./email/client.js";
import type { RateLimiter } from "./auth/rateLimit.js";
import type { Logger, PaidJobClient, PaidSessionClient, SourceProbe, StorageProvider, WorkerResolver } from "./engine/interfaces/index.js";
import type {
  AssetRepo,
  EncodingJobRepo,
  PlaybackIdRepo,
  RenditionRepo,
  UploadRepo,
  PaidOperationRepo,
} from "./engine/repo/index.js";
import { registerRequestLogger } from "./middleware/requestLogger.js";
import { registerHealth } from "./routes/health.js";
import { registerPublicAuth } from "./routes/auth/public.js";
import { registerUserAuth } from "./routes/auth/user.js";
import { registerAdminAuth } from "./routes/auth/admin.js";
import { registerVodUploads } from "./routes/vod/uploads.js";
import { registerVod } from "./routes/vod/vod.js";
import { registerVodPlayback } from "./routes/vod/playback.js";
import { registerLiveStreams } from "./routes/live/streams.js";
import { registerHlsProxy } from "./routes/live/hlsProxy.js";
import type { LiveSessionDirectory } from "./livepeer/liveSessionDirectory.js";
import type { PaidSessionStore } from "./livepeer/paidSessionStore.js";
import type { LiveStreamRepo } from "./engine/repo/index.js";

export interface ServerDeps {
  config: Config;
  pool: DbPool;
  email: EmailClient;
  rateLimiter: RateLimiter;
  storage: StorageProvider | null;
  workerResolver: WorkerResolver;
  paidJobClient: PaidJobClient | null;
  paidOperationRepo: PaidOperationRepo | null;
  paidSessionClient: PaidSessionClient | null;
  paidSessionStore: PaidSessionStore | null;
  sourceProbe: SourceProbe;
  recoveryOwner: string;
  liveSessions: LiveSessionDirectory;
  assetRepo: AssetRepo;
  uploadRepo: UploadRepo;
  renditionRepo: RenditionRepo;
  jobRepo: EncodingJobRepo;
  liveStreamRepo: LiveStreamRepo;
  playbackIdRepo: PlaybackIdRepo;
  engineLogger?: Logger;
}

export async function createServer(deps: ServerDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: deps.config.LOG_LEVEL },
    trustProxy: true,
    disableRequestLogging: true,
  });

  await app.register(cors, {
    origin: deps.config.ALLOWED_ORIGINS === "*" ? true : deps.config.ALLOWED_ORIGINS.split(","),
    credentials: false,
  });

  registerRequestLogger(app);

  // Auth surface (plan 0002).
  registerHealth(app);
  registerPublicAuth(app, deps);
  registerUserAuth(app, { pool: deps.pool, config: deps.config });
  registerAdminAuth(app, { pool: deps.pool, config: deps.config, email: deps.email });

  // VOD surface (plan 0005).
  const vodCommon = {
    pool: deps.pool,
    config: deps.config,
    storage: deps.storage,
    assetRepo: deps.assetRepo,
    uploadRepo: deps.uploadRepo,
    ...(deps.engineLogger !== undefined ? { logger: deps.engineLogger } : {}),
  };
  registerVodUploads(app, vodCommon);
  registerVod(app, {
    pool: deps.pool,
    config: deps.config,
    storage: deps.storage,
    workerResolver: deps.workerResolver,
    paidJobClient: deps.paidJobClient,
    paidOperationRepo: deps.paidOperationRepo,
    sourceProbe: deps.sourceProbe,
    recoveryOwner: deps.recoveryOwner,
    assetRepo: deps.assetRepo,
    jobRepo: deps.jobRepo,
    renditionRepo: deps.renditionRepo,
    playbackIdRepo: deps.playbackIdRepo,
    ...(deps.engineLogger !== undefined ? { logger: deps.engineLogger } : {}),
  });
  registerVodPlayback(app, {
    config: deps.config,
    storage: deps.storage,
    assetRepo: deps.assetRepo,
    playbackIdRepo: deps.playbackIdRepo,
    liveSessions: deps.liveSessions,
  });

  // Live surface (plan 0006). `/_hls/*` is intentionally not API-key-gated.
  registerLiveStreams(app, {
    pool: deps.pool,
    config: deps.config,
    workerResolver: deps.workerResolver,
    paidSessionClient: deps.paidSessionClient,
    paidSessionStore: deps.paidSessionStore,
    liveSessions: deps.liveSessions,
    liveStreamRepo: deps.liveStreamRepo,
    playbackIdRepo: deps.playbackIdRepo,
    ...(deps.engineLogger !== undefined ? { logger: deps.engineLogger } : {}),
  });
  registerHlsProxy(app, { liveSessions: deps.liveSessions });

  app.setErrorHandler((err: Error, req, reply) => {
    req.log.error({ err: err.message, stack: err.stack }, "request.error");
    if (!reply.sent) {
      reply.code(500).send({ status: "error", message: "Internal server error." });
    }
  });

  return app;
}
