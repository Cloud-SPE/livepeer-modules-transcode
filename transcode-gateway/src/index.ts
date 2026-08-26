import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.js";
import { createPool } from "./db/pool.js";
import { runMigrations } from "./db/migrate.js";
import { createRateLimiter } from "./auth/rateLimit.js";
import { createEmailClient } from "./email/client.js";
import { createServer } from "./server.js";
import type { PaidJobClient, PaidSessionClient, StorageProvider, WorkerResolver } from "./engine/interfaces/index.js";
import type { PaidOperationRepo } from "./engine/repo/index.js";
import {
  createStubWorkerResolver,
  createResolverWorkerResolver,
  createLiveSessionDirectory,
  createLocClient,
  createLocHttpTransport,
  createOperationSecretCipher,
  createPaidJobClient,
  createPaidSessionClient,
  decodeWrappingKey,
} from "./livepeer/index.js";
import { createS3StorageProvider, loadS3ConfigFromEnv } from "./storage/index.js";
import { createAssetRepo } from "./repo/assets.js";
import { createUploadRepo } from "./repo/uploads.js";
import { createRenditionRepo } from "./repo/renditions.js";
import { createEncodingJobRepo } from "./repo/encodingJobs.js";
import { createLiveStreamRepo } from "./repo/liveStreams.js";
import { createPlaybackIdRepo } from "./repo/playbackIds.js";
import { createPaidOperationRepo } from "./repo/paidOperations.js";
import { createSourceProbe } from "./runtime/sourceProbe.js";
import { recoverPaidAbrOperations } from "./engine/service/paidAbrRecovery.js";
import { createPaidSessionStore, type PaidSessionStore } from "./livepeer/paidSessionStore.js";
import { createRtmpListener, type RtmpListenerHandle } from "./runtime/rtmp/index.js";
import { reconcilePaidLiveSessions } from "./engine/service/paidLiveReconciler.js";
import { createPaidSessionControlSource } from "./livepeer/paidSessionControlSource.js";

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
  let workerResolver: WorkerResolver = createStubWorkerResolver();
  let resolverHandle: { close(): Promise<void> } | null = null;

  if (config.LIVEPEER_RESOLVER_SOCKET) {
    const handle = createResolverWorkerResolver({
      resolverSocket: config.LIVEPEER_RESOLVER_SOCKET,
      resolverProtoRoot: config.LIVEPEER_RESOLVER_PROTO_ROOT,
      resolverSnapshotTtlMs: config.LIVEPEER_RESOLVER_SNAPSHOT_TTL_MS,
      routeFailureThreshold: config.LIVEPEER_ROUTE_FAILURE_THRESHOLD,
      routeCooldownMs: config.LIVEPEER_ROUTE_COOLDOWN_MS,
    });
    workerResolver = handle.resolver;
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
  const sourceProbe = createSourceProbe({
    ffprobeBin: config.VOD_FFPROBE_BIN,
    timeoutMs: config.VOD_SOURCE_PROBE_TIMEOUT_MS,
  });
  const recoveryOwner = `gateway:${process.pid}:${randomUUID()}`;
  let paidJobClient: PaidJobClient | null = null;
  let paidSessionClient: PaidSessionClient | null = null;
  let paidOperationRepo: PaidOperationRepo | null = null;
  let paidSessionStore: PaidSessionStore | null = null;
  if (config.LIVEPEER_LOC_URL && config.LIVEPEER_LOC_API_KEY) {
    const loc = createLocClient(createLocHttpTransport({
      baseUrl: config.LIVEPEER_LOC_URL,
      apiKey: config.LIVEPEER_LOC_API_KEY,
      clientId: config.LIVEPEER_LOC_CLIENT_ID,
      timeoutMs: config.LIVEPEER_LOC_TIMEOUT_MS,
    }));
    paidJobClient = createPaidJobClient(loc);
    paidSessionClient = createPaidSessionClient(loc);
    if (config.LIVEPEER_OPERATION_SECRETS_KEK) {
      const cipher = createOperationSecretCipher(
        config.LIVEPEER_OPERATION_SECRETS_KEY_ID,
        decodeWrappingKey(config.LIVEPEER_OPERATION_SECRETS_KEK),
      );
      paidOperationRepo = createPaidOperationRepo(pool, cipher);
      paidSessionStore = createPaidSessionStore({
        repo: paidOperationRepo,
        owner: recoveryOwner,
        leaseDurationMs: config.LIVEPEER_SESSION_RECOVERY_LEASE_MS,
      });
    }
  }

  const app = await createServer({
    config,
    pool,
    email,
    rateLimiter,
    storage,
    workerResolver,
    paidJobClient,
    paidOperationRepo,
    paidSessionClient,
    paidSessionStore,
    sourceProbe,
    recoveryOwner,
    liveSessions,
    assetRepo,
    uploadRepo,
    renditionRepo,
    jobRepo,
    liveStreamRepo,
    playbackIdRepo,
    engineLogger: consoleLogger,
  });

  let vodRecoveryTimer: NodeJS.Timeout | null = null;
  let liveRecoveryTimer: NodeJS.Timeout | null = null;
  if (paidJobClient && paidOperationRepo) {
    let recovering = false;
    const recoverVod = async () => {
      if (recovering) return;
      recovering = true;
      try {
        await recoverPaidAbrOperations({
          assetRepo,
          jobRepo,
          renditionRepo,
          paidOperationRepo,
          paidJobClient,
          owner: recoveryOwner,
          leaseMs: config.VOD_RECOVERY_LEASE_MS,
          retryMs: config.VOD_RECOVERY_RETRY_MS,
          logger: consoleLogger,
        });
      } catch (error) {
        consoleLogger.error("orchestrator.vod_recovery_scan_failed", {
          error: error instanceof Error ? error.message : "unknown",
        });
      } finally {
        recovering = false;
      }
    };
    void recoverVod();
    vodRecoveryTimer = setInterval(() => void recoverVod(), config.VOD_RECOVERY_INTERVAL_MS);
    vodRecoveryTimer.unref();
  }

  if (paidSessionClient && paidSessionStore) {
    const controlSource = createPaidSessionControlSource(config.LIVEPEER_LIVE_CONTROL_WINDOW_MS);
    let reconcilingLive = false;
    const reconcileLive = async () => {
      if (reconcilingLive) return;
      reconcilingLive = true;
      try {
        await reconcilePaidLiveSessions({
          paidSessionStore,
          paidSessionClient,
          controlSource,
          refillThresholdUnits: config.LIVEPEER_LIVE_REFILL_THRESHOLD_UNITS,
          maxTotalUnits: config.LIVEPEER_LIVE_MAX_TOTAL_UNITS,
          maxRefills: config.LIVEPEER_LIVE_MAX_REFILLS,
          disconnectGraceMs: config.LIVEPEER_LIVE_DISCONNECT_GRACE_MS,
          liveSessions,
          liveStreamRepo,
          playbackIdRepo,
          logger: consoleLogger,
        });
      } catch {
        consoleLogger.error("orchestrator.live_recovery_scan_failed", { code: "scan_failed" });
      } finally {
        reconcilingLive = false;
      }
    };
    void reconcileLive();
    liveRecoveryTimer = setInterval(() => void reconcileLive(), config.LIVEPEER_LIVE_RECONCILE_INTERVAL_MS);
    liveRecoveryTimer.unref();
  }

  // Gateway RTMP listener (plan 0007). Opt-in via
  // LIVEPEER_GATEWAY_EXTERNAL_RTMP_URL. Disabled by default — plan-0006
  // behavior preserved when env unset.
  let rtmpHandle: RtmpListenerHandle | null = null;
  if (config.LIVEPEER_GATEWAY_EXTERNAL_RTMP_URL && config.RTMP_RELAY_ENABLED && paidSessionStore) {
    rtmpHandle = createRtmpListener({
      config,
      liveStreamRepo,
      paidSessionStore,
      logger: consoleLogger,
    });
    consoleLogger.info("rtmp.listener.started", {
      port: config.RTMP_LISTEN_PORT,
      external_url: config.LIVEPEER_GATEWAY_EXTERNAL_RTMP_URL,
    });
  } else {
    consoleLogger.info("rtmp.listener.disabled", {
      reason: config.LIVEPEER_GATEWAY_EXTERNAL_RTMP_URL
        ? paidSessionStore ? "RTMP_RELAY_ENABLED=false" : "paid session store unavailable"
        : "LIVEPEER_GATEWAY_EXTERNAL_RTMP_URL unset",
    });
  }

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, "shutdown.starting");
    rateLimiter.stop();
    if (vodRecoveryTimer) clearInterval(vodRecoveryTimer);
    if (liveRecoveryTimer) clearInterval(liveRecoveryTimer);
    if (rtmpHandle) await rtmpHandle.stop();
    await app.close();
    if (resolverHandle) await resolverHandle.close();
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
