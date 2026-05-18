import { LitElement, html, nothing } from "lit";
import { submitWaitlist } from "../lib/api.js";

// Modeled on blue-claw-network/web-platform/site/components/cc-signup-form.js.
// Submits to POST /api/v1/waitlist. Same response shape for new + duplicate
// (no enumeration leak) — UI doesn't distinguish either.

export class LmtSignupForm extends LitElement {
  static properties = {
    inFlight: { state: true },
    message: { state: true },
    kind: { state: true },     // "ok" | "error" | null
  };

  createRenderRoot() { return this; }

  constructor() {
    super();
    this.inFlight = false;
    this.message = null;
    this.kind = null;
  }

  async _onSubmit(e) {
    e.preventDefault();
    if (this.inFlight) return;
    const form = e.currentTarget;
    const data = new FormData(form);
    const name = String(data.get("name") || "").trim();
    const email = String(data.get("email") || "").trim();
    if (!name || !email) {
      this.message = "Please provide both name and email.";
      this.kind = "error";
      return;
    }
    this.inFlight = true;
    this.message = null;
    this.kind = null;
    try {
      const res = await submitWaitlist({ name, email });
      this.message = res.message || "Check your inbox for a verification link.";
      this.kind = "ok";
      form.reset();
    } catch (err) {
      this.message = err.message || "Something went wrong. Please try again.";
      this.kind = "error";
    } finally {
      this.inFlight = false;
    }
  }

  render() {
    return html`
      <form class="signup-form" @submit=${(e) => this._onSubmit(e)}>
        <label>
          Name
          <input name="name" required minlength="1" maxlength="200" autocomplete="name">
        </label>
        <label>
          Email
          <input type="email" name="email" required maxlength="320" autocomplete="email">
        </label>
        <button type="submit" ?disabled=${this.inFlight}>
          ${this.inFlight ? "Submitting…" : "Join the waitlist"}
        </button>
        ${this.message
          ? html`<div class="message ${this.kind || ""}" role="status">${this.message}</div>`
          : nothing}
      </form>
    `;
  }
}

customElements.define("lmt-signup-form", LmtSignupForm);
