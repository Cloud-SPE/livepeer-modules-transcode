import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Config } from "../../config.js";
import type { DbPool } from "../../db/pool.js";
import type { EmailClient } from "../../email/client.js";
import type { RateLimiter } from "../../auth/rateLimit.js";
import { pepperedHash } from "../../auth/crypto.js";
import { insertSignup, verifyEmail } from "../../auth/waitlist.js";
import { profileByApiKeyId } from "../../auth/approval.js";
import { createSession } from "../../auth/sessions.js";
import { lookupActiveByCandidates } from "../../auth/apiKeys.js";
import { verificationEmail, verifiedEmail } from "../../email/templates.js";

interface Deps {
  pool: DbPool;
  config: Config;
  email: EmailClient;
  rateLimiter: RateLimiter;
}

const waitlistInput = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email().max(320),
});

const verifyQuery = z.object({ token: z.string().min(1).max(256) });
const loginInput = z.object({ api_key: z.string().min(1).max(128) });

function clientIp(req: { ip: string; headers: Record<string, string | string[] | undefined> }): string {
  return req.ip;
}

export function registerPublicAuth(app: FastifyInstance, deps: Deps): void {
  // POST /api/v1/waitlist
  app.post("/api/v1/waitlist", async (req, reply) => {
    const ip = clientIp(req);
    if (!deps.rateLimiter.check(`waitlist:${ip}`, 5, 60)) {
      reply.code(429).send({ status: "error", message: "Too many requests." });
      return;
    }

    const parsed = waitlistInput.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400).send({ status: "error", message: parsed.error.issues[0]?.message ?? "Invalid input." });
      return;
    }

    const name = parsed.data.name.trim();
    const email = parsed.data.email.trim().toLowerCase();
    const ipHash = pepperedHash(ip, deps.config.IP_HASH_PEPPER);

    const result = await insertSignup(
      deps.pool,
      { name, email, ipHash },
      deps.config.VERIFICATION_TOKEN_TTL_HOURS,
    );

    if (result.inserted && result.rawVerificationToken) {
      const verifyUrl = `${deps.config.SITE_URL.replace(/\/$/, "")}/verify.html?token=${result.rawVerificationToken}`;
      const tpl = verificationEmail({ name, verifyUrl });
      void deps.email.send({ to: email, subject: tpl.subject, html: tpl.html }).catch((err) => {
        req.log.error({ err: err.message, to: email }, "email.verification.failed");
      });
    }

    // Same response shape regardless of branch — prevents email enumeration.
    return {
      status: "ok",
      message: "If that email isn't already registered, we just sent a verification link.",
    };
  });

  // GET /api/v1/waitlist/verify?token=...
  app.get("/api/v1/waitlist/verify", async (req, reply) => {
    const parsed = verifyQuery.safeParse(req.query);
    if (!parsed.success) {
      reply.code(400).send({ status: "error", message: "Invalid verification link." });
      return;
    }

    const result = await verifyEmail(deps.pool, parsed.data.token.trim());

    if (result) {
      const tpl = verifiedEmail({ name: result.name });
      void deps.email.send({ to: result.email, subject: tpl.subject, html: tpl.html }).catch((err) => {
        req.log.error({ err: err.message, to: result.email }, "email.verified.failed");
      });
    }

    // Return verified regardless of hit/miss — don't leak which.
    return { status: "verified" };
  });

  // POST /api/v1/user/login
  app.post("/api/v1/user/login", async (req, reply) => {
    const ip = clientIp(req);
    if (!deps.rateLimiter.check(`login:${ip}`, 5, 60)) {
      reply.code(429).send({ status: "error", message: "Too many requests." });
      return;
    }

    const parsed = loginInput.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400).send({ status: "error", message: "Invalid API key format." });
      return;
    }

    const apiKey = parsed.data.api_key.trim();
    if (!apiKey.startsWith("tc_")) {
      reply.code(401).send({ status: "error", message: "Unauthorized." });
      return;
    }

    const record = await lookupActiveByCandidates(deps.pool, apiKey, deps.config.API_KEY_HASH_PEPPER);
    if (!record) {
      reply.code(401).send({ status: "error", message: "Unauthorized." });
      return;
    }

    const profile = await profileByApiKeyId(deps.pool, record.id);
    if (!profile || profile.accountStatus !== "approved") {
      reply.code(401).send({ status: "error", message: "Unauthorized." });
      return;
    }

    const session = await createSession(deps.pool, record.id, deps.config.SESSION_TTL_HOURS);

    return {
      session_token: session.rawToken,
      expires_at: session.expiresAt.toISOString(),
      user: {
        name: profile.name,
        email: profile.email,
        key_prefix: profile.keyPrefix,
        key_created_at: profile.keyCreatedAt.toISOString(),
        account_status: profile.accountStatus,
        member_since: profile.memberSince.toISOString(),
      },
    };
  });
}
