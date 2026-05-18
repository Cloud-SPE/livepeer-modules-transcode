import { LitElement, html } from "lit";
import { verifyEmail } from "../lib/api.js";

// Modeled on blue-claw-network/web-platform/site/components/cc-email-verify.js.
// Reads ?token=... from the URL, hits /api/v1/waitlist/verify, renders the
// result. The gateway returns the same "verified" status whether the token
// is new or already used (no enumeration leak) — we mirror that.

export class LmtEmailVerify extends LitElement {
  static properties = {
    state: { state: true },        // "loading" | "verified" | "invalid" | "error"
    message: { state: true },
  };

  createRenderRoot() { return this; }

  constructor() {
    super();
    this.state = "loading";
    this.message = "";
  }

  async connectedCallback() {
    super.connectedCallback();
    const token = new URL(window.location.href).searchParams.get("token");
    if (!token) {
      this.state = "invalid";
      this.message = "No verification token in this link.";
      return;
    }
    try {
      const res = await verifyEmail(token);
      if (res.status === "verified") {
        this.state = "verified";
        this.message =
          "Email verified. We'll email you an API key when your account is approved.";
      } else {
        this.state = "invalid";
        this.message = "This verification link is invalid or expired.";
      }
    } catch (err) {
      this.state = "error";
      this.message = err.message || "Something went wrong. Please try again.";
    }
  }

  render() {
    if (this.state === "loading") {
      return html`<p>Checking your verification link…</p>`;
    }
    const kind = this.state === "verified" ? "ok" : "error";
    return html`<div class="verify-result ${kind}" role="status">${this.message}</div>`;
  }
}

customElements.define("lmt-email-verify", LmtEmailVerify);
