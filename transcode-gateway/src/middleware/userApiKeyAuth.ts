import type { FastifyReply, FastifyRequest } from "fastify";
import type { Config } from "../config.js";
import type { DbPool } from "../db/pool.js";
import { lookupActiveByCandidates } from "../auth/apiKeys.js";
import { profileByApiKeyId } from "../auth/approval.js";
import { extractBearer } from "./bearerAuth.js";

// API-key bearer middleware. Used by the customer-facing product API
// (/v1/uploads, /v1/vod/*, /v1/videos/assets, etc.) — distinct from
// userAuth (session bearer for /api/v1/user/*) and adminAuth (admin
// bearer for /api/v1/admin/*).

declare module "fastify" {
  interface FastifyRequest {
    apiKey?: { id: string; userId: string };
  }
}

export function makeUserApiKeyAuth(deps: { pool: DbPool; config: Config }) {
  return async function userApiKeyAuth(req: FastifyRequest, reply: FastifyReply) {
    const token = extractBearer(req.headers.authorization);
    if (!token || !token.startsWith("tc_")) {
      reply.code(401).send({ status: "error", message: "Unauthorized." });
      return;
    }

    const record = await lookupActiveByCandidates(
      deps.pool,
      token,
      deps.config.API_KEY_HASH_PEPPER,
    );
    if (!record) {
      reply.code(401).send({ status: "error", message: "Unauthorized." });
      return;
    }

    const profile = await profileByApiKeyId(deps.pool, record.id);
    if (!profile || profile.accountStatus !== "approved") {
      reply.code(401).send({ status: "error", message: "Unauthorized." });
      return;
    }

    req.apiKey = { id: record.id, userId: record.userId };
  };
}
