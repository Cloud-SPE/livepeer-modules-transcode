import { LitElement, html, nothing } from "lit";
import { getApiKey } from "../lib/session.js";
import { toast } from "./lmt-toast.js";

// Modeled on blue-claw-network/web-platform/portal/components/portal-key-display.js.
// Shows the raw API key (cached in sessionStorage) with a copy-to-clipboard
// button. Click-to-reveal hidden by default.

export class PortalKeyDisplay extends LitElement {
  static properties = {
    revealed: { state: true },
    key: { state: true },
  };
  createRenderRoot() { return this; }
  constructor() {
    super();
    this.revealed = false;
    this.key = getApiKey();
  }
  refresh() { this.key = getApiKey(); }
  _mask(k) {
    if (!k) return "(no key cached)";
    return `${k.slice(0, 6)}…${k.slice(-4)}`;
  }
  async _copy() {
    if (!this.key) return;
    try {
      await navigator.clipboard.writeText(this.key);
      toast("API key copied to clipboard.");
    } catch {
      toast("Could not copy automatically; select the text manually.");
    }
  }
  render() {
    return html`
      <div>
        <div class="key-display">${this.revealed ? (this.key || "(no key cached)") : this._mask(this.key)}</div>
        <div class="lmt-actions lmt-space-top">
          <button type="button" class="secondary" @click=${() => { this.revealed = !this.revealed; }}>
            ${this.revealed ? "Hide" : "Reveal"}
          </button>
          <button type="button" class="secondary" ?disabled=${!this.key} @click=${() => this._copy()}>
            Copy
          </button>
        </div>
        ${!this.key
          ? html`<p class="muted lmt-space-top">
              The raw key is only cached in this browser tab after login or
              key rotation. If you switched tabs, sign out and sign in again
              (or rotate your key).
            </p>`
          : nothing}
      </div>
    `;
  }
}
customElements.define("portal-key-display", PortalKeyDisplay);
