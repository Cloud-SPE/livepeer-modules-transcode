import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Config } from "../config.js";
import type { DbPool } from "../db/pool.js";
import type { LocTransport } from "../engine/interfaces/index.js";
import { createLocHttpTransport } from "../livepeer/locHttpTransport.js";
import { makeUserAuth } from "../middleware/userAuth.js";
import { makeAdminAuth } from "../middleware/adminAuth.js";

// LOC /v1/capabilities, as consumed by LOC and OpenAI demo catalogs.
// Explicit projection strips opaque extra metadata, internal addresses and keys.
const integer = z.string().regex(/^\d+$/);
export const catalogWire = z.object({ items: z.array(z.object({
  name: z.string(), work_unit: z.string().nullable().optional(),
  offerings: z.array(z.object({
    id: z.string(), protocol: z.string(),
    work_unit: z.string().nullable().optional(),
    price_per_work_unit_wei: integer.nullable(),
    units_per_price: integer.refine(value => BigInt(value) > 0n),
    job: z.object({ transports: z.array(z.string()).optional() }).nullable().optional(),
    session: z.object({ descriptor_schema: z.string().optional(), attachment: z.string().optional(), metering: z.string().optional() }).nullable().optional(),
  })),
})) });

export function registerCatalog(app: FastifyInstance, deps: { config: Config; pool: DbPool; transport?: LocTransport }): void {
  const config = deps.config;
  const transport = deps.transport ?? (config.LIVEPEER_LOC_URL && config.LIVEPEER_LOC_API_KEY ? createLocHttpTransport({
    baseUrl: config.LIVEPEER_LOC_URL, apiKey: config.LIVEPEER_LOC_API_KEY,
    clientId: config.LIVEPEER_LOC_CLIENT_ID, timeoutMs: config.LIVEPEER_LOC_TIMEOUT_MS,
  }) : null);
  const handler = async (_req: unknown, reply: import("fastify").FastifyReply) => {
    reply.header("Cache-Control", "no-store");
    if (!transport) return reply.code(503).send({ message: "LOC is not configured for this gateway." });
    try {
      const data = await transport.request({ method: "GET", path: "/v1/capabilities", schema: catalogWire });
      return {
        source: "LOC", price_basis: "network_wholesale", fetched_at: new Date().toISOString(),
        items: data.items.map(cap => ({ ...cap, offerings: cap.offerings.map(off => ({
          ...off,
          configured_for_gateway: (cap.name === "video:transcode.abr" && off.id === config.LIVEPEER_VOD_OFFERING_DEFAULT && off.protocol === "paid-job/v1") ||
            (cap.name === "video:transcode.live" && off.id === config.LIVEPEER_LIVE_OFFERING_DEFAULT && off.protocol === "paid-session/v1"),
        })) })),
      };
    } catch {
      return reply.code(503).send({ message: "LOC catalog is currently unavailable. Retry to fetch current capabilities and prices." });
    }
  };
  app.get("/api/v1/user/catalog", { preHandler: makeUserAuth(deps) }, handler);
  app.get("/api/v1/admin/catalog", { preHandler: makeAdminAuth(config.ADMIN_TOKEN) }, handler);
}
