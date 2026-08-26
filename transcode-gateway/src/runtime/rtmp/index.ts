import type { Config } from "../../config.js";
import type { Logger } from "../../engine/interfaces/index.js";
import type { LiveStreamRepo } from "../../engine/repo/index.js";
import type { PaidSessionStore } from "../../livepeer/paidSessionStore.js";
import { createRtmpServer } from "./server.js";
import { attachDispatcher } from "./dispatcher.js";

export interface RtmpListenerDeps {
  config: Config;
  liveStreamRepo: LiveStreamRepo;
  paidSessionStore: PaidSessionStore;
  logger?: Logger;
}

export interface RtmpListenerHandle {
  stop(): Promise<void>;
}

export function createRtmpListener(deps: RtmpListenerDeps): RtmpListenerHandle {
  const server = createRtmpServer({
    host: deps.config.RTMP_LISTEN_HOST,
    port: deps.config.RTMP_LISTEN_PORT,
    ...(deps.logger !== undefined ? { logger: deps.logger } : {}),
  });
  const dispatcher = attachDispatcher(server, {
    config: deps.config,
    liveStreamRepo: deps.liveStreamRepo,
    paidSessionStore: deps.paidSessionStore,
    ...(deps.logger !== undefined ? { logger: deps.logger } : {}),
  });
  return {
    async stop() {
      await dispatcher.stop();
      await server.stop();
    },
  };
}

export { decideDispatch, hashStreamKey } from "./dispatcher.js";
