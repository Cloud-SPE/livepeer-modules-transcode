import { LitElement, html, nothing } from "lit";
import { getAsset, deleteAsset } from "../lib/api.js";
import { toast } from "./lmt-toast.js";
import { operationSummary, operationTone, shouldPollOperation } from "../lib/paid-operation-view.js";

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
    this._pollTimer = null;
  }
  async connectedCallback() {
    super.connectedCallback();
    await this._load();
  }
  async _load() {
    this.loading = this.asset === null;
    this.error = "";
    try {
      this.asset = await getAsset(this.id);
      this._schedulePoll();
    } catch (err) {
      this.error = err.message || "Asset not found.";
    } finally {
      this.loading = false;
    }
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    clearTimeout(this._pollTimer);
  }
  _schedulePoll() {
    clearTimeout(this._pollTimer);
    if (this.asset?.status === "queued" || shouldPollOperation(this.asset?.paid_operation ?? null)) {
      this._pollTimer = setTimeout(() => this._load(), 5000);
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
    if (this.error) return html`<section class="portal-main"><div class="msg error" role="alert">${this.error}</div></section>`;
    const a = this.asset;
    if (!a) return nothing;
    return html`
      <section class="portal-main">
        <p><a href="#assets">← Back to asset library</a></p>
        <h1>Asset ${a.asset_id.slice(0, 14)}…</h1>
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
        ${a.paid_operation ? html`
          <div class="card" aria-live="polite">
            <h3>Paid job</h3>
            <p>Status: <span class="badge ${operationTone(a.paid_operation)}">${a.paid_operation.state}</span></p>
            <p>${operationSummary(a.paid_operation)}</p>
            <p>Usage: <strong>${a.paid_operation.claimed_units ?? "pending"}</strong> ${a.paid_operation.work_unit}</p>
            ${a.paid_operation.warnings.map((warning) => html`<p class="warn">${warning.replaceAll("_", " ")}</p>`)}
            ${a.paid_operation.error_code ? html`<p class="error">${a.paid_operation.error_code}</p>` : nothing}
            <p class="muted">Request <code>${a.paid_operation.request_id}</code>${a.paid_operation.recovered ? "; recovered" : ""}</p>
          </div>
        ` : nothing}
        <div class="card">
          <h3>Renditions (${a.renditions?.length ?? 0})</h3>
          ${a.renditions?.length
            ? html`
              <div class="table-wrap"><table>
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
              </table></div>`
            : html`<p class="muted">No renditions yet.</p>`}
        </div>
        <div class="card">
          <h3>Jobs (${a.jobs?.length ?? 0})</h3>
          ${a.jobs?.length
            ? html`
              <div class="table-wrap"><table>
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
              </table></div>`
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
