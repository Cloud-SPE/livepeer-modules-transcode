import { createHash } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import type { Config } from "../../config.js";
import type { Logger } from "../../engine/interfaces/index.js";
import type { LiveStreamRepo } from "../../engine/repo/index.js";
import type { PaidSessionRuntimeState } from "../../engine/types/index.js";
import type { OwnedPaidSession, PaidSessionStore } from "../../livepeer/paidSessionStore.js";
import type { NmsHandle, NmsSession } from "./server.js";

export interface DispatcherDeps {
  config: Config;
  liveStreamRepo: LiveStreamRepo;
  paidSessionStore: PaidSessionStore;
  logger?: Logger;
  expectedApp?: string;
  ffmpegBin?: string;
  spawnRelay?: (command: string, args: string[]) => ChildProcess;
}

interface ActiveRelay {
  streamId: string;
  child: ChildProcess;
  intentionalStop: boolean;
}

const STREAM_PATH_RE = /^\/([^/]+)\/([^/]+)$/;

function hashStreamKey(streamKey: string): string {
  return createHash("sha256").update(streamKey).digest("hex");
}

export interface DispatchResult {
  parsed: boolean;
  reject?: { reason: string };
  accept?: {
    streamId: string;
    targetUrl: string;
    owned: OwnedPaidSession;
    relayGeneration: number;
  };
}

export async function decideDispatch(
  streamPath: string,
  expectedApp: string,
  lookups: {
    byStreamKeyHash: (hash: string) => Promise<{ id: string; status: string } | null>;
    claimByLiveStreamId: (streamId: string) => Promise<OwnedPaidSession | null>;
    readSecrets: PaidSessionStore["readSecrets"];
    release: PaidSessionStore["release"];
  },
): Promise<DispatchResult> {
  const match = STREAM_PATH_RE.exec(streamPath);
  if (!match) return { parsed: false, reject: { reason: "stream_path_unparseable" } };

  const [, app, streamKey] = match;
  if (!app || !streamKey) return { parsed: false, reject: { reason: "stream_path_empty_segments" } };
  if (app !== expectedApp) return { parsed: true, reject: { reason: "unknown_app" } };

  const stream = await lookups.byStreamKeyHash(hashStreamKey(streamKey));
  if (!stream) return { parsed: true, reject: { reason: "stream_not_found" } };
  if (stream.status === "ended" || stream.status === "errored") {
    return { parsed: true, reject: { reason: `stream_${stream.status}` } };
  }

  const owned = await lookups.claimByLiveStreamId(stream.id);
  if (!owned) return { parsed: true, reject: { reason: "session_claim_unavailable" } };
  const secrets = await lookups.readSecrets(owned);
  if (!secrets?.runnerIngestUrl || !secrets.runnerIngestKey) {
    await lookups.release(owned);
    return { parsed: true, reject: { reason: "runner_ingest_missing" } };
  }
  return {
    parsed: true,
    accept: {
      streamId: stream.id,
      targetUrl: `${secrets.runnerIngestUrl.replace(/\/$/, "")}/${secrets.runnerIngestKey}`,
      owned,
      relayGeneration: (owned.operation.sessionRuntime?.relayGeneration ?? 0) + 1,
    },
  };
}

export function attachDispatcher(nms: NmsHandle, deps: DispatcherDeps): { stop(): Promise<void> } {
  const expectedApp = deps.expectedApp ?? "live";
  const ffmpegBin = deps.ffmpegBin ?? deps.config.RTMP_RELAY_FFMPEG_BIN;
  const localBase = `rtmp://127.0.0.1:${deps.config.RTMP_LISTEN_PORT}`;
  const spawnProcess = deps.spawnRelay ?? ((command, args) =>
    spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] }));
  const activeByNmsSession = new Map<string, ActiveRelay>();
  const activeByStream = new Map<string, string>();
  const pendingPaths = new Set<string>();

  const persistRelayState = async (
    streamId: string,
    relayStatus: PaidSessionRuntimeState["relayStatus"],
    status: string,
    relayGeneration?: number,
    relayDisconnectedAt?: string,
  ): Promise<boolean> => {
    const owned = await deps.paidSessionStore.claimByLiveStreamId(streamId);
    if (!owned?.operation.sessionRuntime) return false;
    const progressed = await deps.paidSessionStore.recordProgress(owned, {
      status,
      sessionRuntime: {
        ...owned.operation.sessionRuntime,
        relayStatus,
        relayGeneration: relayGeneration ?? owned.operation.sessionRuntime.relayGeneration,
        relayDisconnectedAt,
      },
    });
    if (!progressed) return false;
    await deps.paidSessionStore.release(progressed);
    return true;
  };

  const scheduleAuthoritativeReconcile = async (
    streamId: string,
    relayStatus: "reconnecting" | "failed",
    reason: string,
  ): Promise<void> => {
    await persistRelayState(streamId, relayStatus, "reconcile_pending", undefined, new Date().toISOString());
    await deps.liveStreamRepo.updateStatus(streamId, "reconnecting", { lastSeenAt: new Date() });
    deps.logger?.info("rtmp.relay.reconcile_scheduled", { stream_id: streamId, reason });
  };

  nms.on("postPublish", (session: NmsSession) => {
    const streamPath = session.streamPath ?? "";
    if (pendingPaths.has(streamPath)) {
      deps.logger?.warn("rtmp.publish.rejected", { reason: "stream_already_publishing", session_id: session.id });
      session.socket?.destroy();
      return;
    }
    pendingPaths.add(streamPath);
    void (async () => {
      const decision = await decideDispatch(streamPath, expectedApp, {
        byStreamKeyHash: (hash) => deps.liveStreamRepo.byStreamKeyHash(hash),
        claimByLiveStreamId: (streamId) => deps.paidSessionStore.claimByLiveStreamId(streamId),
        readSecrets: (owned) => deps.paidSessionStore.readSecrets(owned),
        release: (owned) => deps.paidSessionStore.release(owned),
      });
      if (decision.reject || !decision.accept) {
        deps.logger?.warn("rtmp.publish.rejected", {
          reason: decision.reject?.reason ?? "no_accept",
          session_id: session.id,
        });
        session.socket?.destroy();
        return;
      }

      const accept = decision.accept;
      if (activeByStream.has(accept.streamId)) {
        await deps.paidSessionStore.release(accept.owned);
        deps.logger?.warn("rtmp.publish.rejected", { reason: "stream_already_publishing", session_id: session.id });
        session.socket?.destroy();
        return;
      }
      const starting = await deps.paidSessionStore.recordProgress(accept.owned, {
        status: "relay_starting",
        sessionRuntime: {
          ...accept.owned.operation.sessionRuntime!,
          relayStatus: "starting",
          relayGeneration: accept.relayGeneration,
        },
      });
      if (!starting) throw new Error("relay lifecycle fence lost");
      await deps.paidSessionStore.release(starting);

      const child = spawnProcess(ffmpegBin, [
        "-loglevel", "error", "-i", `${localBase}${streamPath}`,
        "-c", "copy", "-f", "flv", accept.targetUrl,
      ]);
      const relay: ActiveRelay = { streamId: accept.streamId, child, intentionalStop: false };
      activeByNmsSession.set(session.id, relay);
      activeByStream.set(accept.streamId, session.id);
      child.stderr?.on("data", (data: Buffer) => {
        deps.logger?.warn("rtmp.relay.ffmpeg_stderr", { stream_id: accept.streamId, bytes: data.byteLength });
      });
      child.on("error", () => {
        void scheduleAuthoritativeReconcile(accept.streamId, "failed", "process_error");
      });
      child.on("exit", (code, signal) => {
        activeByNmsSession.delete(session.id);
        activeByStream.delete(accept.streamId);
        deps.logger?.info("rtmp.relay.exited", { stream_id: accept.streamId, code, signal });
        if (!relay.intentionalStop) void scheduleAuthoritativeReconcile(accept.streamId, "failed", "unexpected_exit");
      });
      await persistRelayState(accept.streamId, "active", "active", accept.relayGeneration);
      await deps.liveStreamRepo.updateStatus(accept.streamId, "active", { lastSeenAt: new Date() });
      deps.logger?.info("rtmp.relay.started", { stream_id: accept.streamId });
    })().catch(() => {
      deps.logger?.error("rtmp.dispatch.failed", { reason: "relay_setup_failed", session_id: session.id });
      session.socket?.destroy();
    }).finally(() => pendingPaths.delete(streamPath));
  });

  nms.on("donePublish", (session: NmsSession) => {
    const relay = activeByNmsSession.get(session.id);
    if (!relay) return;
    relay.intentionalStop = true;
    relay.child.kill("SIGTERM");
    activeByNmsSession.delete(session.id);
    activeByStream.delete(relay.streamId);
    void scheduleAuthoritativeReconcile(relay.streamId, "reconnecting", "publisher_disconnect");
    deps.logger?.info("rtmp.relay.torn_down", { stream_id: relay.streamId });
  });

  return {
    async stop() {
      for (const relay of activeByNmsSession.values()) {
        relay.intentionalStop = true;
        relay.child.kill("SIGTERM");
      }
      activeByNmsSession.clear();
      activeByStream.clear();
      pendingPaths.clear();
    },
  };
}

export { hashStreamKey };
