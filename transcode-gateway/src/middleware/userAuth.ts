import type { FastifyReply, FastifyRequest } from "fastify";
import type { Config } from "../config.js";
import type { DbPool } from "../db/pool.js";
import { lookupSession } from "../auth/sessions.js";
import { extractBearer } from "./bearerAuth.js";

declare module "fastify" {
  interface FastifyRequest {
    session?: { apiKeyId: string; userId: string; rawToken: string };
  }
}

export function makeUserAuth(deps: { pool: DbPool; config: Config }) {
  return async function userAuth(req: FastifyRequest, reply: FastifyReply) {
    const token = extractBearer(req.headers.authorization);
    if (!token || !token.startsWith("sess_")) {
      reply.code(401).send({ status: "error", message: "Unauthorized." });
      return;
    }

    const session = await lookupSession(deps.pool, token, deps.config.SESSION_TTL_HOURS);
    if (!session) {
      reply.code(401).send({ status: "error", message: "Unauthorized." });
      return;
    }

    req.session = { ...session, rawToken: token };
  };
}
