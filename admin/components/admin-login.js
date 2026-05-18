import { LitElement, html, nothing } from "lit";
import { setAdminToken } from "../lib/session.js";
import { verifyAdminToken } from "../lib/api.js";

// Modeled on blue-claw-network/web-platform/admin/components/admin-login.js.
// Operator pastes ADMIN_TOKEN env value; we verify against the cheapest
// admin route (count) before flipping authenticated.

export class AdminLogin extends LitElement {
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
    const token = String(new FormData(e.currentTarget).get("token") || "").trim();
    if (!token) {
      this.error = "Paste your admin token.";
      return;
    }
    this.inFlight = true;
    this.error = "";
    setAdminToken(token);
    try {
      await verifyAdminToken();
      window.dispatchEvent(new CustomEvent("lmt-authenticated"));
    } catch (err) {
      this.error = err.message === "Unauthorized"
        ? "That admin token was rejected by the gateway."
        : (err.message || "Login failed.");
    } finally {
      this.inFlight = false;
    }
  }
  render() {
    return html`
      <section class="admin-main">
        <div class="card" style="max-width: 480px; margin: 4rem auto;">
          <h2>Admin sign in</h2>
          <p class="muted">Paste the value of the gateway's <code>ADMIN_TOKEN</code> env variable.</p>
          <form @submit=${(e) => this._onSubmit(e)}>
            <label>
              Admin token
              <input name="token" type="password" required autocomplete="off">
            </label>
            <button type="submit" ?disabled=${this.inFlight}>
              ${this.inFlight ? "Verifying…" : "Sign in"}
            </button>
            ${this.error ? html`<div class="error" role="alert">${this.error}</div>` : nothing}
          </form>
        </div>
      </section>
    `;
  }
}
customElements.define("admin-login", AdminLogin);
