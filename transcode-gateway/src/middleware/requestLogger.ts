import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";

declare module "fastify" {
  interface FastifyRequest {
    requestId?: string;
    startedAt?: number;
  }
}

export function registerRequestLogger(app: FastifyInstance): void {
  app.addHook("onRequest", async (req) => {
    req.requestId = randomUUID();
    req.startedAt = Date.now();
  });

  app.addHook("onResponse", async (req, reply) => {
    const durationMs = Date.now() - (req.startedAt ?? Date.now());
    req.log.info(
      {
        request_id: req.requestId,
        method: req.method,
        path: req.url,
        status: reply.statusCode,
        duration_ms: durationMs,
      },
      "request",
    );
  });
}
