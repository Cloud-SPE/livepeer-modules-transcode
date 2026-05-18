import { LitElement, html, nothing } from "lit";
import { rotateKey } from "../lib/api.js";
import { toast } from "./lmt-toast.js";

// Modeled on blue-claw-network/web-platform/portal/components/portal-account.js.
// View + rotate API key. Rotation revokes the old key and returns a new raw
// key + new session token.

export class PortalAccount extends LitElement {
  static properties = {
    inFlight: { state: true },
    confirming: { state: true },
    error: { state: true },
  };
  createRenderRoot() { return this; }
  constructor() {
    super();
    this.inFlight = false;
    this.confirming = false;
    this.error = "";
  }
  async _doRotate() {
    if (this.inFlight) return;
    this.inFlight = true;
    this.error = "";
    try {
      await rotateKey();
      toast("API key rotated. New key cached in this tab.");
      this.confirming = false;
      // Re-render key-display
      this.querySelector("portal-key-display")?.refresh();
    } catch (err) {
      this.error = err.message || "Key rotation failed.";
    } finally {
      this.inFlight = false;
    }
  }
  render() {
    return html`
      <section class="portal-main">
        <h2>Account</h2>
        <div class="card">
          <h3>Current API key</h3>
          <portal-key-display></portal-key-display>
        </div>
        <div class="card">
          <h3>Rotate API key</h3>
          <p class="muted">
            Rotating revokes your current key and issues a new one. Existing
            scripts using the old key will start returning 401. All other
            browser tabs signed in with this key will be logged out.
          </p>
          ${this.confirming
            ? html`
                <div class="warn" style="margin-bottom: var(--gap-md);">
                  Are you sure? This action cannot be undone.
                </div>
                <div style="display: flex; gap: var(--gap-sm);">
                  <button type="button" class="danger" ?disabled=${this.inFlight} @click=${() => this._doRotate()}>
                    ${this.inFlight ? "Rotating…" : "Yes, rotate now"}
                  </button>
                  <button type="button" class="secondary" @click=${() => { this.confirming = false; }}>
                    Cancel
                  </button>
                </div>
              `
            : html`<button type="button" class="danger" @click=${() => { this.confirming = true; this.error = ""; }}>
                Rotate API key…
              </button>`}
          ${this.error ? html`<div class="error" role="alert">${this.error}</div>` : nothing}
        </div>
      </section>
    `;
  }
}
customElements.define("portal-account", PortalAccount);
