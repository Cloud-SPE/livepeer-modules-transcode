// Brand-neutral HTML templates. Product branding (logo, palette, copy
// polish) is a phase-2 swap once naming is locked. Modeled in shape on
// blue-claw-network/web-platform/backend/src/email.rs but with no
// Blueclaw-specific copy or colors.

const SHELL_STYLE =
  'font-family: system-ui, -apple-system, "Segoe UI", sans-serif; ' +
  "max-width: 600px; margin: 0 auto; padding: 40px 20px; color: #111; background: #fff;";
const CTA_STYLE =
  "display: inline-block; padding: 14px 28px; background: #111; color: #fff; " +
  "text-decoration: none; border-radius: 6px; font-weight: 600;";
const KEY_BLOCK_STYLE =
  "background: #f3f4f6; border: 1px solid #d1d5db; border-radius: 6px; " +
  "padding: 16px; font-family: ui-monospace, monospace; font-size: 13px; word-break: break-all;";
const FOOTER_STYLE = "font-size: 12px; color: #6b7280; margin-top: 32px;";

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function verificationEmail(input: { name: string; verifyUrl: string }): {
  subject: string;
  html: string;
} {
  const name = escapeHtml(input.name);
  const url = escapeHtml(input.verifyUrl);
  return {
    subject: "Verify your email — Livepeer Transcode",
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="${SHELL_STYLE}">
  <h1 style="font-size: 22px; margin-bottom: 16px;">Verify your email</h1>
  <p>Hi ${name},</p>
  <p>Thanks for signing up for Livepeer Transcode. Confirm your email to join the waitlist:</p>
  <p style="text-align: center; margin: 32px 0;">
    <a href="${url}" style="${CTA_STYLE}">Verify Email</a>
  </p>
  <p style="font-size: 13px; color: #6b7280;">Or copy this link:<br><a href="${url}">${url}</a></p>
  <p style="${FOOTER_STYLE}">If you didn't sign up, you can ignore this email.</p>
</body></html>`,
  };
}

export function verifiedEmail(input: { name: string }): { subject: string; html: string } {
  const name = escapeHtml(input.name);
  return {
    subject: "You're on the waitlist — Livepeer Transcode",
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="${SHELL_STYLE}">
  <h1 style="font-size: 22px; margin-bottom: 16px;">You're on the waitlist</h1>
  <p>Hi ${name},</p>
  <p>Your email is confirmed. We review signups on a rolling basis and you'll get an email with your API key once you're approved.</p>
  <p>No action needed from you for now.</p>
  <p style="${FOOTER_STYLE}">Livepeer Transcode</p>
</body></html>`,
  };
}

export function apiKeyEmail(input: {
  name: string;
  apiKey: string;
  portalUrl: string;
}): { subject: string; html: string } {
  const name = escapeHtml(input.name);
  const key = escapeHtml(input.apiKey);
  const portal = escapeHtml(input.portalUrl);
  return {
    subject: "Your Livepeer Transcode API key is ready",
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="${SHELL_STYLE}">
  <h1 style="font-size: 22px; margin-bottom: 16px;">You're approved</h1>
  <p>Hi ${name},</p>
  <p>Here's your API key. <strong>Keep it safe — it won't be shown again.</strong></p>
  <div style="${KEY_BLOCK_STYLE}">${key}</div>

  <h2 style="font-size: 16px; margin-top: 28px;">Quick start</h2>
  <p>Submit a VOD transcode job with curl:</p>
  <div style="${KEY_BLOCK_STYLE}">curl -X POST https://api.example.com/v1/uploads \\
  -H "Authorization: Bearer ${key}"</div>

  <p>Or push an RTMP live stream — see <a href="${portal}">the portal</a> for the full guide and to manage your key.</p>

  <p style="text-align: center; margin: 32px 0;">
    <a href="${portal}" style="${CTA_STYLE}">Open the Portal</a>
  </p>

  <p style="${FOOTER_STYLE}">Livepeer Transcode</p>
</body></html>`,
  };
}
