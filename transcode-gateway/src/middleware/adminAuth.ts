import type { FastifyReply, FastifyRequest } from "fastify";
import { constantTimeEqual } from "../auth/crypto.js";
import { extractBearer } from "./bearerAuth.js";

export function makeAdminAuth(adminToken: string) {
  return async function adminAuth(req: FastifyRequest, reply: FastifyReply) {
    const presented = extractBearer(req.headers.authorization);
    if (!presented || !constantTimeEqual(presented, adminToken)) {
      reply.code(401).send({ status: "error", message: "Unauthorized." });
    }
  };
}
