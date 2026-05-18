import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.js";
import { createPool } from "./db/pool.js";
import { runMigrations } from "./db/migrate.js";
import { createRateLimiter } from "./auth/rateLimit.js";
import { createEmailClient } from "./email/client.js";
import { createServer } from "./server.js";
import type { StorageProvider, WorkerClient, WorkerResolver } from "./engine/interfaces/index.js";
import {
  createStubWorkerClient,
  createStubWorkerResolver,
  createUnixSocketPayerDaemonClient,
  createHttpWorkerClient,
  createResolverWorkerResolver,
  createLiveSessionDirectory,
  type PayerDaemonClient,
  type VideoRouteSelector,
} from "./livepeer/index.js";
import { createS3StorageProvider, loadS3ConfigFromEnv } from "./storage/index.js";
import { createAssetRepo } from "./repo/assets.js";
import { createUploadRepo } from "./repo/uploads.js";
import { createRenditionRepo } from "./repo/renditions.js";
import { createEncodingJobRepo } from "./repo/encodingJobs.js";
import { createLiveStreamRepo } from "./repo/liveStreams.js";
import { createPlaybackIdRepo } from "./repo/playbackIds.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, "..", "migrations");

async function main(): Promise<void> {
  const config = loadConfig();
  const migrateOnly = process.argv.includes("--migrate-only");

  const pool = createPool(config.DATABASE_URL);
  const consoleLogger = {
    info: (msg: string, ctx?: Record<string, unknown>) =>
      console.log(JSON.stringify({ level: "info", msg, ...ctx })),
    warn: (msg: string, ctx?: Record<string, unknown>) =>
      console.warn(JSON.stringify({ level: "warn", msg, ...ctx })),
    error: (msg: string, ctx?: Record<string, unknown> | Error) =>
      console.error(
        JSON.stringify({
          level: "error",
          msg,
          ...(ctx instanceof Error ? { error: ctx.message } : ctx),
        }),
      ),
  };

  consoleLogger.info("migrations.starting", { dir: MIGRATIONS_DIR });
  const applied = await runMigrations(pool, MIGRATIONS_DIR);
  consoleLogger.info("migrations.done", { applied });

  if (migrateOnly) {
    await pool.end();
    return;
  }

  const email = createEmailClient(config, consoleLogger);
  const rateLimiter = createRateLimiter();

  // Wire layer — real impls when env vars set, stubs otherwise.
  let payerDaemon: PayerDaemonClient | null = null;
  let workerClient: WorkerClient = createStubWorkerClient();
  let workerResolver: WorkerResolver = createStubWorkerResolver();
  let routeSelector: VideoRouteSelector | null = null;
  let resolverHandle: { close(): Promise<void> } | null = null;

  if (config.LIVEPEER_PAYER_SOCKET && config.LIVEPEER_NODE_ID) {
    payerDaemon = createUnixSocketPayerDaemonClient({
      socketPath: config.LIVEPEER_PAYER_SOCKET,
    });
    workerClient = createHttpWorkerClient({
      payerDaemon,
      nodeId: config.LIVEPEER_NODE_ID,
      faceValueWei: config.LIVEPEER_FACE_VALUE_WEI,
    });
    consoleLogger.info("wire.payerDaemon.connected", { socket: config.LIVEPEER_PAYER_SOCKET });
  } else {
    consoleLogger.info("wire.payerDaemon.stub", {
      reason: "LIVEPEER_PAYER_SOCKET or LIVEPEER_NODE_ID unset",
    });
  }

  if (config.LIVEPEER_RESOLVER_SOCKET) {
    const handle = createResolverWorkerResolver({
      resolverSocket: config.LIVEPEER_RESOLVER_SOCKET,
      resolverProtoRoot: config.LIVEPEER_RESOLVER_PROTO_ROOT,
      resolverSnapshotTtlMs: config.LIVEPEER_RESOLVER_SNAPSHOT_TTL_MS,
      routeFailureThreshold: config.LIVEPEER_ROUTE_FAILURE_THRESHOLD,
      routeCooldownMs: config.LIVEPEER_ROUTE_COOLDOWN_MS,
    });
    workerResolver = handle.resolver;
    routeSelector = handle.selector;
    resolverHandle = handle;
    consoleLogger.info("wire.resolver.connected", { socket: config.LIVEPEER_RESOLVER_SOCKET });
  } else {
    consoleLogger.info("wire.resolver.stub", { reason: "LIVEPEER_RESOLVER_SOCKET unset" });
  }
  // S3-compat storage. Routes return 503 s3_not_configured when null.
  let storage: StorageProvider | null = null;
  const s3Cfg = loadS3ConfigFromEnv(process.env);
  if (s3Cfg) {
    storage = createS3StorageProvider(s3Cfg);
    consoleLogger.info("storage.s3.connected", { region: s3Cfg.region, bucket: s3Cfg.bucket });
  } else {
    consoleLogger.info("storage.s3.unconfigured", {
      reason: "S3_REGION/BUCKET/ACCESS_KEY_ID/SECRET_ACCESS_KEY not all set",
    });
  }

  const assetRepo = createAssetRepo(pool);
  const uploadRepo = createUploadRepo(pool);
  const renditionRepo = createRenditionRepo(pool);
  const jobRepo = createEncodingJobRepo(pool);
  const liveStreamRepo = createLiveStreamRepo(pool);
  const playbackIdRepo = createPlaybackIdRepo(pool);
  const liveSessions = createLiveSessionDirectory();

  const app = await createServer({
    config,
    pool,
    email,
    rateLimiter,
    storage,
    workerResolver,
    workerClient,
    routeSelector,
    liveSessions,
    assetRepo,
    uploadRepo,
    renditionRepo,
    jobRepo,
    liveStreamRepo,
    playbackIdRepo,
    engineLogger: consoleLogger,
  });

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, "shutdown.starting");
    rateLimiter.stop();
    await app.close();
    if (resolverHandle) await resolverHandle.close();
    if (payerDaemon) await payerDaemon.close();
    await pool.end();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  await app.listen({ host: "0.0.0.0", port: config.PORT });
  app.log.info({ port: config.PORT }, "listening");
}

main().catch((err) => {
  console.error("fatal:", err);
  process.exit(1);
});
