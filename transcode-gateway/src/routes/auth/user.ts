import type { FastifyInstance } from "fastify";
import type { Config } from "../../config.js";
import type { DbPool } from "../../db/pool.js";
import { makeUserAuth } from "../../middleware/userAuth.js";
import { profileByApiKeyId } from "../../auth/approval.js";
import { createApiKey, revokeApiKey } from "../../auth/apiKeys.js";
import {
  createSession,
  revokeAllSessionsForApiKey,
  revokeSession,
} from "../../auth/sessions.js";

interface Deps {
  pool: DbPool;
  config: Config;
}

export function registerUserAuth(app: FastifyInstance, deps: Deps): void {
  const userAuth = makeUserAuth(deps);

  // GET /api/v1/user/profile
  app.get("/api/v1/user/profile", { preHandler: userAuth }, async (req, reply) => {
    const session = req.session!;
    const profile = await profileByApiKeyId(deps.pool, session.apiKeyId);
    if (!profile) {
      reply.code(404).send({ status: "error", message: "User not found." });
      return;
    }
    return {
      name: profile.name,
      email: profile.email,
      key_prefix: profile.keyPrefix,
      key_created_at: profile.keyCreatedAt.toISOString(),
      account_status: profile.accountStatus,
      member_since: profile.memberSince.toISOString(),
    };
  });

  // POST /api/v1/user/rotate-key
  app.post("/api/v1/user/rotate-key", { preHandler: userAuth }, async (req, reply) => {
    const session = req.session!;
    const client = await deps.pool.connect();
    try {
      await client.query("BEGIN");
      await revokeApiKey(client, session.apiKeyId);
      await revokeAllSessionsForApiKey(deps.pool, session.apiKeyId);
      const newKey = await createApiKey(client, session.userId, deps.config.API_KEY_HASH_PEPPER);
      await client.query("COMMIT");

      const newSession = await createSession(deps.pool, newKey.id, deps.config.SESSION_TTL_HOURS);

      return {
        api_key: newKey.rawKey,
        key_prefix: newKey.prefix,
        session_token: newSession.rawToken,
        expires_at: newSession.expiresAt.toISOString(),
      };
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      req.log.error({ err: (err as Error).message }, "rotate-key.failed");
      reply.code(500).send({ status: "error", message: "Could not rotate key." });
    } finally {
      client.release();
    }
  });

  // POST /api/v1/user/logout
  app.post("/api/v1/user/logout", { preHandler: userAuth }, async (req) => {
    const session = req.session!;
    await revokeSession(deps.pool, session.rawToken);
    return { status: "ok", message: "Logged out." };
  });
}
