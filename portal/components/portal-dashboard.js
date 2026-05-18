import { LitElement, html, nothing } from "lit";
import { fetchProfile } from "../lib/api.js";
import { getProfile } from "../lib/session.js";

// Modeled on blue-claw-network/web-platform/portal/components/portal-dashboard.js.
// Welcome + profile summary + quick links to account / assets / live.

export class PortalDashboard extends LitElement {
  static properties = { profile: { state: true } };
  createRenderRoot() { return this; }
  constructor() {
    super();
    this.profile = getProfile();
  }
  async connectedCallback() {
    super.connectedCallback();
    try {
      this.profile = await fetchProfile();
    } catch {
      // 401 handler in api.js will dispatch lmt-unauthorized
    }
  }
  render() {
    const p = this.profile;
    return html`
      <section class="portal-main">
        <h2>Welcome${p?.name ? `, ${p.name}` : ""}</h2>
        <div class="card">
          <h3>Your account</h3>
          ${p
            ? html`
                <p>Email: <strong>${p.email}</strong></p>
                <p>API key prefix: <code>${p.key_prefix}</code></p>
                <p>Account status: <span class="badge ok">${p.account_status}</span></p>
                <p class="muted">Member since ${new Date(p.member_since).toLocaleDateString()}</p>
              `
            : html`<p class="muted">Loading…</p>`}
        </div>
        <div class="card">
          <h3>Quick links</h3>
          <ul>
            <li><a href="#account">View / rotate API key</a></li>
            <li><a href="#assets">Asset library</a></li>
            <li><a href="#upload">Upload a VOD file</a></li>
            <li><a href="#live">Start a live stream</a></li>
          </ul>
        </div>
        ${!p ? nothing : nothing}
      </section>
    `;
  }
}
customElements.define("portal-dashboard", PortalDashboard);
