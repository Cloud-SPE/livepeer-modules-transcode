import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Config } from "../../config.js";
import type { DbPool } from "../../db/pool.js";
import type { EmailClient } from "../../email/client.js";
import { makeAdminAuth } from "../../middleware/adminAuth.js";
import {
  countAll,
  exportRows,
  listForAdmin,
  stats,
} from "../../auth/waitlist.js";
import { approveBatch, deleteOne, rejectBatch } from "../../auth/approval.js";
import { apiKeyEmail } from "../../email/templates.js";

interface Deps {
  pool: DbPool;
  config: Config;
  email: EmailClient;
}

const listQuery = z.object({
  page: z.coerce.number().int().positive().optional(),
  per_page: z.coerce.number().int().positive().max(200).optional(),
  sort: z.enum(["name", "email", "status", "created_at"]).optional(),
  order: z.enum(["asc", "desc"]).optional(),
  search: z.string().max(200).optional(),
  status: z.enum(["pending", "approved", "rejected"]).optional(),
  verified: z.coerce.boolean().optional(),
});

const idsBody = z.object({
  ids: z.array(z.string().uuid()).min(1),
  send_emails: z.boolean().optional(),
});

const rejectBody = z.object({ ids: z.array(z.string().uuid()).min(1) });

const idParam = z.object({ id: z.string().uuid() });

export function registerAdminAuth(app: FastifyInstance, deps: Deps): void {
  const admin = makeAdminAuth(deps.config.ADMIN_TOKEN);

  // GET /api/v1/admin/waitlist
  app.get("/api/v1/admin/waitlist", { preHandler: admin }, async (req, reply) => {
    const parsed = listQuery.safeParse(req.query);
    if (!parsed.success) {
      reply.code(400).send({ status: "error", message: "Invalid query." });
      return;
    }
    const result = await listForAdmin(deps.pool, {
      page: parsed.data.page,
      perPage: parsed.data.per_page,
      sort: parsed.data.sort,
      order: parsed.data.order,
      search: parsed.data.search,
      status: parsed.data.status,
      verified: parsed.data.verified,
    });
    return {
      data: result.data.map((r) => ({
        id: r.id,
        name: r.name,
        email: r.email,
        ip_hash: r.ipHash,
        status: r.status,
        email_verified: r.emailVerified,
        created_at: r.createdAt.toISOString(),
      })),
      pagination: {
        page: result.page,
        per_page: result.perPage,
        total: result.total,
        total_pages: result.totalPages,
      },
    };
  });

  // GET /api/v1/admin/waitlist/count
  app.get("/api/v1/admin/waitlist/count", { preHandler: admin }, async () => ({
    count: await countAll(deps.pool),
  }));

  // GET /api/v1/admin/waitlist/export
  app.get("/api/v1/admin/waitlist/export", { preHandler: admin }, async (_req, reply) => {
    const rows = await exportRows(deps.pool);
    const header = "id,name,email,status,email_verified,created_at\n";
    const body = rows
      .map((r) =>
        [
          r.id,
          csvEscape(r.name),
          csvEscape(r.email),
          r.status,
          String(r.emailVerified),
          r.createdAt.toISOString(),
        ].join(","),
      )
      .join("\n");
    reply.header("content-type", "text/csv");
    reply.header("content-disposition", 'attachment; filename="waitlist.csv"');
    return header + body + "\n";
  });

  // POST /api/v1/admin/waitlist/approve
  app.post("/api/v1/admin/waitlist/approve", { preHandler: admin }, async (req, reply) => {
    const parsed = idsBody.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400).send({ status: "error", message: "Invalid request body." });
      return;
    }
    const sendEmails = parsed.data.send_emails ?? true;
    const result = await approveBatch(deps.pool, parsed.data.ids, deps.config.API_KEY_HASH_PEPPER);

    let emailsSent = 0;
    const emailErrors: string[] = [];

    if (sendEmails) {
      for (const row of result.approved) {
        const tpl = apiKeyEmail({
          name: row.name,
          apiKey: row.rawKey,
          portalUrl: deps.config.PORTAL_URL,
        });
        try {
          await deps.email.send({ to: row.email, subject: tpl.subject, html: tpl.html });
          emailsSent++;
        } catch (err) {
          emailErrors.push(`${row.email}: ${(err as Error).message}`);
          req.log.error({ err: (err as Error).message, to: row.email }, "email.apiKey.failed");
        }
      }
    }

    return {
      status: "ok",
      approved: result.approved.length,
      skipped: result.skipped,
      emails_sent: emailsSent,
      email_errors: emailErrors,
      keys: result.approved.map((r) => ({
        waitlist_id: r.waitlistId,
        user_id: r.userId,
        name: r.name,
        email: r.email,
        key: r.rawKey,
        key_prefix: r.keyPrefix,
      })),
    };
  });

  // POST /api/v1/admin/waitlist/reject
  app.post("/api/v1/admin/waitlist/reject", { preHandler: admin }, async (req, reply) => {
    const parsed = rejectBody.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400).send({ status: "error", message: "Invalid request body." });
      return;
    }
    const result = await rejectBatch(deps.pool, parsed.data.ids);
    return { status: "ok", rejected: result.rejected };
  });

  // DELETE /api/v1/admin/waitlist/:id
  app.delete("/api/v1/admin/waitlist/:id", { preHandler: admin }, async (req, reply) => {
    const parsed = idParam.safeParse(req.params);
    if (!parsed.success) {
      reply.code(400).send({ status: "error", message: "Invalid id." });
      return;
    }
    const deleted = await deleteOne(deps.pool, parsed.data.id);
    if (!deleted) {
      reply.code(404).send({ status: "error", message: "Entry not found." });
      return;
    }
    return { status: "ok", message: "Entry deleted." };
  });

  // GET /api/v1/admin/stats
  app.get("/api/v1/admin/stats", { preHandler: admin }, async () => {
    const s = await stats(deps.pool);
    return {
      total_signups: s.totalSignups,
      today: s.today,
      this_week: s.thisWeek,
      this_month: s.thisMonth,
      daily_counts: s.dailyCounts,
    };
  });
}

function csvEscape(s: string): string {
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replaceAll('"', '""')}"`;
  }
  return s;
}
