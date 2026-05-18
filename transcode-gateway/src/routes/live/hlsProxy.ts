import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { LiveSessionDirectory } from "../../livepeer/liveSessionDirectory.js";

// Strict-proxy LL-HLS playlist + segment requests to the broker. No caching,
// no rewrites, no cache-control mutation. CDN concerns are operator add-ons.
// Modeled on the `/_hls/*` half of
// livepeer-network-modules/video-gateway/src/routes/playback.ts.

export interface HlsProxyDeps {
  liveSessions: LiveSessionDirectory;
}

export function registerHlsProxy(app: FastifyInstance, deps: HlsProxyDeps): void {
  app.get("/_hls/*", async (req: FastifyRequest, reply: FastifyReply) => {
    const suffix = (req.params as { "*": string })["*"] ?? "";
    const sessionId = suffix.split("/", 1)[0] ?? "";
    const session = deps.liveSessions.get(sessionId);
    if (!session) {
      reply.code(404).send({ status: "error", error: "playback_session_not_found" });
      return;
    }
    const upstream = `${session.brokerUrl.replace(/\/$/, "")}/_hls/${suffix}`;
    try {
      const res = await fetch(upstream, { method: "GET" });
      const buf = Buffer.from(await res.arrayBuffer());
      reply.code(res.status);
      res.headers.forEach((v, k) => {
        reply.header(k, v);
      });
      await reply.send(buf);
    } catch (err) {
      req.log.error(
        { err: err instanceof Error ? err.message : String(err), upstream },
        "hls.proxy.upstream_unavailable",
      );
      reply.code(502).send({ status: "error", error: "upstream_unavailable" });
    }
  });
}
