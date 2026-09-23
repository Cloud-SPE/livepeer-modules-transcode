import type { Config } from "../config.js";
import { emailEnabled } from "../config.js";

// Resend REST client. Uses native fetch (Node 24). When RESEND_API_KEY is
// unset, log the email body instead of sending — matches the
// blue-claw-network/web-platform/backend/src/email.rs::is_enabled() fallback.

export interface EmailClient {
  send(input: { to: string; subject: string; html: string }): Promise<void>;
}

export interface Logger {
  info(msg: string, ctx?: Record<string, unknown>): void;
  error(msg: string, ctx?: Record<string, unknown>): void;
}

export function createEmailClient(config: Config, logger: Logger): EmailClient {
  const enabled = emailEnabled(config);

  return {
    async send({ to, subject, html }) {
      if (!enabled) {
        // Full HTML logged when RESEND_API_KEY is unset so smoke scripts
        // can recover URLs / tokens from the dryrun output.
        logger.info("email.dryrun", { to, subject, html });
        return;
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);

      try {
        const res = await fetch(`${config.RESEND_BASE_URL.replace(/\/+$/, "")}/emails`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${config.RESEND_API_KEY}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            from: config.FROM_EMAIL,
            to: [to],
            subject,
            html,
          }),
          signal: controller.signal,
          redirect: "error",
        });

        if (!res.ok) {
          const body = await res.text().catch(() => "");
          throw new Error(`Resend ${res.status}: ${body}`);
        }
        const receipt = await res.json().catch(() => ({})) as { id?: string };
        logger.info("email.accepted", { to, subject, provider_id: receipt.id });
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
