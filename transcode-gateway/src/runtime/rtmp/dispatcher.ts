import { createHash } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import type { Config } from "../../config.js";
import type { Logger } from "../../engine/interfaces/index.js";
import type { LiveStreamRepo } from "../../engine/repo/index.js";
import type { LiveSessionDirectory } from "../../livepeer/liveSessionDirectory.js";
import type { NmsHandle, NmsSession } from "./server.js";

// Per-stream broker relay. NMS terminates the RTMP from the customer; for each
// successful prePublish we look up media.live_streams by stream-key hash, find
// the assigned worker's RTMP URL (recorded in liveSessionDirectory when the
// live route called openRtmpSession in plan 0006), and spawn an ffmpeg
// subprocess that pulls from our local NMS and pushes to the broker.

// Stream path convention: `/{app}/{streamKey}`. App is configurable so a
// future plan can use a different name without code changes; default "live".

export interface DispatcherDeps {
  config: Config;
  liveStreamRepo: LiveStreamRepo;
  liveSessions: LiveSessionDirectory;
  logger?: Logger;
  expectedApp?: string;             // default "live"
  ffmpegBin?: string;               // default config.RTMP_RELAY_FFMPEG_BIN
}

interface ActiveRelay {
  streamId: string;
  child: ChildProcess;
}

const STREAM_PATH_RE = /^\/([^/]+)\/([^/]+)$/;

function hashStreamKey(streamKey: string): string {
  return createHash("sha256").update(streamKey).digest("hex");
}

export interface DispatchResult {
  parsed: boolean;
  app?: string;
  streamKey?: string;
  reject?: { reason: string };
  accept?: {
    streamId: string;
    brokerRtmpUrl: string;
  };
}

// Pure-function part: given a stream path + a lookup result, decide whether
// to accept the publish and where to relay. Extracted so the dispatcher is
// testable without spawning ffmpeg or wiring NMS.
export async function decideDispatch(
  streamPath: string,
  expectedApp: string,
  lookups: {
    byStreamKeyHash: (hash: string) => Promise<{ id: string; status: string; sessionId?: string } | null>;
    sessionDir: { get: (sessionId: string) => { brokerRtmpUrl: string } | null };
  },
): Promise<DispatchResult> {
  const match = STREAM_PATH_RE.exec(streamPath);
  if (!match) return { parsed: false, reject: { reason: "stream_path_unparseable" } };

  const [, app, streamKey] = match;
  if (!app || !streamKey) return { parsed: false, reject: { reason: "stream_path_empty_segments" } };
  if (app !== expectedApp) {
    return { parsed: true, app, streamKey, reject: { reason: "unknown_app" } };
  }

  const stream = await lookups.byStreamKeyHash(hashStreamKey(streamKey));
  if (!stream) {
    return { parsed: true, app, streamKey, reject: { reason: "stream_not_found" } };
  }
  if (stream.status === "ended" || stream.status === "errored") {
    return { parsed: true, app, streamKey, reject: { reason: `stream_${stream.status}` } };
  }
  if (!stream.sessionId) {
    return { parsed: true, app, streamKey, reject: { reason: "session_missing" } };
  }

  const session = lookups.sessionDir.get(stream.sessionId);
  if (!session) {
    return { parsed: true, app, streamKey, reject: { reason: "session_directory_miss" } };
  }

  return {
    parsed: true,
    app,
    streamKey,
    accept: { streamId: stream.id, brokerRtmpUrl: session.brokerRtmpUrl },
  };
}

// Hook NMS events to the dispatcher. Returns a stop() that tears down active
// relays.
export function attachDispatcher(nms: NmsHandle, deps: DispatcherDeps): { stop(): Promise<void> } {
  const expectedApp = deps.expectedApp ?? "live";
  const ffmpegBin = deps.ffmpegBin ?? deps.config.RTMP_RELAY_FFMPEG_BIN;
  const localBase = `rtmp://127.0.0.1:${deps.config.RTMP_LISTEN_PORT}`;
  const active = new Map<string, ActiveRelay>();

  nms.on("postPublish", (session: NmsSession) => {
    const streamPath = session.streamPath ?? "";
    void (async () => {
      const decision = await decideDispatch(streamPath, expectedApp, {
        byStreamKeyHash: (hash) => deps.liveStreamRepo.byStreamKeyHash(hash),
        sessionDir: deps.liveSessions,
      });

      if (decision.reject || !decision.accept) {
        deps.logger?.warn("rtmp.publish.rejected", {
          stream_path: streamPath,
          reason: decision.reject?.reason ?? "no_accept",
          session_id: session.id,
        });
        session.socket?.destroy();
        return;
      }

      const accept = decision.accept;
      const localUrl = `${localBase}${streamPath}`;
      const child = spawn(
        ffmpegBin,
        ["-loglevel", "error", "-i", localUrl, "-c", "copy", "-f", "flv", accept.brokerRtmpUrl],
        { stdio: ["ignore", "ignore", "pipe"] },
      );
      child.stderr?.on("data", (data: Buffer) => {
        deps.logger?.warn("rtmp.relay.ffmpeg_stderr", {
          stream_id: accept.streamId,
          line: data.toString().trim().slice(0, 200),
        });
      });
      child.on("exit", (code, signal) => {
        deps.logger?.info("rtmp.relay.exited", {
          stream_id: accept.streamId,
          code,
          signal,
        });
        active.delete(session.id);
      });
      active.set(session.id, { streamId: accept.streamId, child });
      deps.logger?.info("rtmp.relay.started", {
        stream_id: accept.streamId,
        local_url: localUrl,
        broker_rtmp_url: accept.brokerRtmpUrl,
      });
    })().catch((err) => {
      deps.logger?.error("rtmp.dispatch.failed", {
        stream_path: streamPath,
        error: err instanceof Error ? err.message : String(err),
      });
      session.socket?.destroy();
    });
  });

  nms.on("donePublish", (session: NmsSession) => {
    const relay = active.get(session.id);
    if (!relay) return;
    relay.child.kill("SIGTERM");
    active.delete(session.id);
    deps.logger?.info("rtmp.relay.torn_down", { stream_id: relay.streamId });
  });

  return {
    async stop() {
      for (const relay of active.values()) {
        relay.child.kill("SIGTERM");
      }
      active.clear();
    },
  };
}

export { hashStreamKey };
