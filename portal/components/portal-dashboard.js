import { LitElement, html, nothing } from "lit";
import { fetchProfile, listAssets } from "../lib/api.js";
import { getProfile } from "../lib/session.js";
import { icon } from "../lib/icons.js";

// Screen hierarchy adapted from LOC web/portal/components/cc-dashboard.js.
export class PortalDashboard extends LitElement {
  static properties = { profile: { state: true }, assets: { state: true }, loading: { state: true }, error: { state: true } };
  createRenderRoot() { return this; }
  constructor() { super(); this.profile = getProfile(); this.assets = []; this.loading = true; this.error = ""; }
  connectedCallback() { super.connectedCallback(); this._load(); }
  async _load() {
    this.loading = true; this.error = "";
    const [profile, assets] = await Promise.allSettled([fetchProfile(), listAssets({ limit: 5 })]);
    if (profile.status === "fulfilled") this.profile = profile.value;
    if (assets.status === "fulfilled") this.assets = assets.value.items;
    this.error = [profile, assets].filter(r => r.status === "rejected").map(r => r.reason.message).join("; ");
    this.loading = false;
  }
  render() {
    const p = this.profile;
    return html`<section class="portal-main">
      <div class="page-heading"><h1>Dashboard</h1><button class="ghost small" ?disabled=${this.loading} @click=${() => this._load()}>${icon.refresh()} Refresh</button></div>
      <p class="muted mb-2">${p?.email || "Your transcode workspace"}</p>
      ${this.error ? html`<div class="msg error" role="alert">${this.error}</div>` : nothing}
      <div class="metric-grid">
        <div class="metric accent"><div class="label">Account status</div><div class="value">${p?.account_status || "—"}</div><div class="sub">Transcode access</div></div>
        <div class="metric"><div class="label">API key</div><div class="value mono">${p?.key_prefix || "—"}</div><div class="sub"><a href="#account">Manage your key</a></div></div>
        <div class="metric"><div class="label">Member since</div><div class="value">${p?.member_since ? new Date(p.member_since).toLocaleDateString() : "—"}</div><div class="sub">Account created</div></div>
      </div>
      <div class="card"><div class="page-heading"><h3>Recent assets</h3><a href="#assets">View all →</a></div>
        ${this.loading ? html`<p class="muted" role="status">Loading assets…</p>` : this.assets.length ? html`
        <div class="table-wrap"><table><thead><tr><th>Asset</th><th>Status</th><th>Tier</th><th>Created</th></tr></thead><tbody>
          ${this.assets.map(a => html`<tr><td><a href=${`#assets/${a.id}`}>${a.id.slice(0,14)}…</a></td><td><span class="badge ${a.status === "ready" ? "ok" : a.status === "errored" ? "error" : "warn"}">${a.status}</span></td><td>${a.encoding_tier}</td><td>${new Date(a.created_at).toLocaleDateString()}</td></tr>`)}
        </tbody></table></div>` : html`<p class="muted">${this.error ? "Assets could not be loaded." : "No assets yet. Upload a video to get started."}</p>`}
      </div>
      <div class="card"><h3>Next steps</h3><ul class="next-steps">
        <li><a href="#upload">Upload a video</a> to create an adaptive streaming asset.</li>
        <li><a href="#live">Start a live stream</a> and get your ingest and playback details.</li>
        <li><a href="#account">Manage your API key</a> to connect your application.</li>
      </ul></div>
    </section>`;
  }
}
customElements.define("portal-dashboard", PortalDashboard);
