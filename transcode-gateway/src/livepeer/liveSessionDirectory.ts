// Modeled on livepeer-network-modules/video-gateway/src/livepeer/liveSessionDirectory.ts.
// In-memory streamId/sessionId → route map. Single-instance v0; multi-instance
// would need an external store (deferred).

export interface LiveSessionRoute {
  streamId: string;
  sessionId: string;
  brokerUrl: string;
  brokerRtmpUrl: string;
  streamKey: string;
  hlsPlaybackUrl: string;
}

export interface LiveSessionDirectory {
  record(route: LiveSessionRoute): void;
  get(sessionId: string): LiveSessionRoute | null;
  getByStreamId(streamId: string): LiveSessionRoute | null;
  remove(sessionId: string): void;
}

export function createLiveSessionDirectory(): LiveSessionDirectory {
  const routesBySessionId = new Map<string, LiveSessionRoute>();
  const routesByStreamId = new Map<string, LiveSessionRoute>();
  return {
    record(route) {
      routesBySessionId.set(route.sessionId, route);
      routesByStreamId.set(route.streamId, route);
    },
    get(sessionId) {
      return routesBySessionId.get(sessionId) ?? null;
    },
    getByStreamId(streamId) {
      return routesByStreamId.get(streamId) ?? null;
    },
    remove(sessionId) {
      const route = routesBySessionId.get(sessionId);
      if (route) {
        routesBySessionId.delete(sessionId);
        routesByStreamId.delete(route.streamId);
      }
    },
  };
}
