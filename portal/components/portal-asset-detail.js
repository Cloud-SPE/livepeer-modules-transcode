import { LitElement, html, nothing } from "lit";
import { getAsset, deleteAsset } from "../lib/api.js";
import { toast } from "./lmt-toast.js";

// Per-asset view: status + renditions + jobs + playback URL.
// Calls GET /v1/videos/assets/:id (plan 0005).

export class PortalAssetDetail extends LitElement {
  static properties = {
    id: { type: String },
    asset: { state: true },
    loading: { state: true },
    error: { state: true },
  };
  createRenderRoot() { return this; }
  constructor() {
    super();
    this.id = "";
    this.asset = null;
    this.loading = true;
    this.error = "";
  }
  async connectedCallback() {
    super.connectedCallback();
    await this._load();
  }
  async _load() {
    this.loading = true;
    this.error = "";
    try {
      this.asset = await getAsset(this.id);
    } catch (err) {
      this.error = err.message || "Asset not found.";
    } finally {
      this.loading = false;
    }
  }
  async _delete() {
    if (!confirm("Delete this asset? This is a soft-delete; the bytes stay in storage.")) return;
    try {
      await deleteAsset(this.id);
      toast("Asset deleted.");
      location.hash = "#assets";
    } catch (err) {
      toast(err.message || "Delete failed.");
    }
  }
  render() {
    if (this.loading) return html`<section class="portal-main"><p class="muted">Loading…</p></section>`;
    if (this.error) return html`<section class="portal-main"><div class="error">${this.error}</div></section>`;
    const a = this.asset;
    if (!a) return nothing;
    return html`
      <section class="portal-main">
        <p><a href="#assets">← Back to asset library</a></p>
        <h2>Asset ${a.asset_id.slice(0, 14)}…</h2>
        <div class="card">
          <p>Status: <span class="badge ${a.status === "ready" ? "ok" : a.status === "errored" ? "error" : "warn"}">${a.status}</span></p>
          <p>Encoding tier: <strong>${a.encoding_tier}</strong></p>
          ${a.duration_sec ? html`<p>Duration: ${Math.round(a.duration_sec)}s</p>` : nothing}
          ${a.width && a.height ? html`<p>Resolution: ${a.width}×${a.height}</p>` : nothing}
          ${a.error_message ? html`<p class="error">Error: ${a.error_message}</p>` : nothing}
          ${a.playback_id
            ? html`<p>Playback: <a href=${a.playback_url}><code>${a.playback_id}</code></a></p>`
            : nothing}
          <p class="muted">Created ${new Date(a.created_at).toLocaleString()}${a.ready_at ? `; ready ${new Date(a.ready_at).toLocaleString()}` : ""}</p>
        </div>
        <div class="card">
          <h3>Renditions (${a.renditions?.length ?? 0})</h3>
          ${a.renditions?.length
            ? html`
              <table>
                <thead><tr><th>Codec</th><th>Resolution</th><th>Bitrate</th><th>Status</th></tr></thead>
                <tbody>
                  ${a.renditions.map((r) => html`
                    <tr>
                      <td><code>${r.codec}</code></td>
                      <td>${r.resolution}</td>
                      <td>${r.bitrate_kbps} kbps</td>
                      <td><span class="badge ${r.status === "completed" ? "ok" : r.status === "failed" ? "error" : "warn"}">${r.status}</span></td>
                    </tr>
                  `)}
                </tbody>
              </table>`
            : html`<p class="muted">No renditions yet.</p>`}
        </div>
        <div class="card">
          <h3>Jobs (${a.jobs?.length ?? 0})</h3>
          ${a.jobs?.length
            ? html`
              <table>
                <thead><tr><th>Kind</th><th>Status</th><th>Error</th></tr></thead>
                <tbody>
                  ${a.jobs.map((j) => html`
                    <tr>
                      <td><code>${j.kind}</code></td>
                      <td><span class="badge ${j.status === "completed" ? "ok" : j.status === "failed" ? "error" : "warn"}">${j.status}</span></td>
                      <td>${j.error_message ?? html`<span class="muted">—</span>`}</td>
                    </tr>
                  `)}
                </tbody>
              </table>`
            : html`<p class="muted">No jobs yet.</p>`}
        </div>
        ${a.status !== "deleted"
          ? html`<button type="button" class="danger" @click=${() => this._delete()}>Delete asset (soft)</button>`
          : nothing}
      </section>
    `;
  }
}
customElements.define("portal-asset-detail", PortalAssetDetail);
