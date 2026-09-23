import { siteUrl } from "../../frontend/links.js";
import { LitElement, html, nothing } from "lit";
import { login } from "../lib/api.js";

// Modeled on blue-claw-network/web-platform/portal/components/portal-login.js.
// API-key input → POST /api/v1/user/login. On success, dispatches the
// lmt-authenticated event so portal-app can flip to authenticated UI.

export class PortalLogin extends LitElement {
  static properties = {
    inFlight: { state: true },
    error: { state: true },
  };
  createRenderRoot() { return this; }
  constructor() {
    super();
    this.inFlight = false;
    this.error = "";
  }
  async _onSubmit(e) {
    e.preventDefault();
    if (this.inFlight) return;
    const data = new FormData(e.currentTarget);
    const key = String(data.get("api_key") || "").trim();
    if (!key.startsWith("tc_")) {
      this.error = "API keys start with tc_. Check the email we sent.";
      return;
    }
    this.inFlight = true;
    this.error = "";
    try {
      await login(key);
      window.dispatchEvent(new CustomEvent("lmt-authenticated"));
    } catch (err) {
      this.error = err.message || "Login failed.";
    } finally {
      this.inFlight = false;
    }
  }
  render() {
    return html`
      <section class="page">
        <header class="header"><span class="brand">Livepeer Transcode</span><nav class="nav" aria-label="Account"><a href=${siteUrl}>Request access</a><lmt-theme-toggle></lmt-theme-toggle></nav></header>
        <main class="card">
          <h1>Sign in</h1>
          <p class="muted">Paste the API key we emailed you when your waitlist signup was approved.</p>
          <form class="form" @submit=${(e) => this._onSubmit(e)}>
            <label>
              API key
              <input name="api_key" type="password" required autocomplete="off"
                placeholder="tc_..." minlength="4" maxlength="128">
            </label>
            <button class="primary" type="submit" ?disabled=${this.inFlight}>
              ${this.inFlight ? "Signing in…" : "Sign in"}
            </button>
            ${this.error ? html`<div class="error" role="alert">${this.error}</div>` : nothing}
          </form>
        </main>

      </section>
    `;
  }
}
customElements.define("portal-login", PortalLogin);
