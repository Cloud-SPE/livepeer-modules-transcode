// Thin wrapper around node-media-server v4. Disables HTTP/FLV, recording,
// and notify-server features so the gateway only acts as an RTMP termination
// + relay (per plan 0007). Custom prePublish/donePublish dispatch lives in
// `./dispatcher.ts`.

// node-media-server has no published types for v4 yet; treat the constructor
// + the .on/.run/.stop methods as the small typed surface we use.
import NodeMediaServerCtor from "node-media-server";

import type { Logger } from "../../engine/interfaces/index.js";

interface NmsSession {
  readonly id: string;
  readonly streamApp?: string;
  readonly streamName?: string;
  readonly streamPath?: string;
  // node-media-server v4 sessions expose the underlying TCP socket; we expose
  // it here only to allow the dispatcher to forcibly close on rejection.
  readonly socket?: { destroy(): void };
}

export interface NmsHandle {
  on(event: "prePublish" | "postPublish" | "donePublish", listener: (session: NmsSession) => void): void;
  stop(): Promise<void>;
}

export interface RtmpServerConfig {
  host: string;
  port: number;
  logger?: Logger;
}

interface NmsConstructorConfig {
  bind: string;
  rtmp: { port: number };
}

interface NmsInstance {
  on(eventName: string, listener: (session: NmsSession) => void): void;
  run(): void;
  // v4 has no public `.stop()`; teardown done by closing the inner TCP server.
  rtmpServer?: { tcpServer?: { close(cb?: () => void): void } };
}

type NmsCtor = new (config: NmsConstructorConfig) => NmsInstance;
const NodeMediaServer = NodeMediaServerCtor as unknown as NmsCtor;

export function createRtmpServer(cfg: RtmpServerConfig): NmsHandle {
  const nms = new NodeMediaServer({
    bind: cfg.host,
    rtmp: { port: cfg.port },
    // No `http`, no `record`, no `notify` — we don't want NMS doing HLS,
    // FLV-over-HTTP, recording, or webhook notifications. The dispatcher
    // handles broker-relay separately.
  });
  nms.run();
  cfg.logger?.info("rtmp.server.listening", { host: cfg.host, port: cfg.port });

  return {
    on(event, listener) {
      nms.on(event, listener);
    },
    async stop() {
      const inner = nms.rtmpServer?.tcpServer;
      if (!inner) return;
      await new Promise<void>((resolve) => {
        inner.close(() => resolve());
      });
      cfg.logger?.info("rtmp.server.stopped", { port: cfg.port });
    },
  };
}

export type { NmsSession };
