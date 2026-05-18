import { LitElement, html, nothing } from "lit";
import { listAssets } from "../lib/api.js";

// VOD asset library: paginated list scoped by api_key_id. Calls GET
// /v1/videos/assets (plan 0005).

export class PortalAssets extends LitElement {
  static properties = {
    items: { state: true },
    nextCursor: { state: true },
    loading: { state: true },
    error: { state: true },
  };
  createRenderRoot() { return this; }
  constructor() {
    super();
    this.items = [];
    this.nextCursor = null;
    this.loading = true;
    this.error = "";
  }
  async connectedCallback() {
    super.connectedCallback();
    await this._load();
  }
  async _load(cursor) {
    this.loading = true;
    this.error = "";
    try {
      const res = await listAssets(cursor ? { cursor, limit: 50 } : { limit: 50 });
      this.items = cursor ? [...this.items, ...res.items] : res.items;
      this.nextCursor = res.pagination?.next_cursor ?? null;
    } catch (err) {
      this.error = err.message || "Could not load assets.";
    } finally {
      this.loading = false;
    }
  }
  _statusBadge(status) {
    if (status === "ready") return html`<span class="badge ok">ready</span>`;
    if (status === "errored") return html`<span class="badge error">errored</span>`;
    if (status === "deleted") return html`<span class="badge">deleted</span>`;
    return html`<span class="badge warn">${status}</span>`;
  }
  render() {
    return html`
      <section class="portal-main">
        <h2>Asset library</h2>
        <p class="muted">
          VOD assets you've uploaded. <a href="#upload">Upload a new one</a>.
        </p>
        ${this.error ? html`<div class="error">${this.error}</div>` : nothing}
        ${this.loading && this.items.length === 0
          ? html`<p class="muted">Loading…</p>`
          : this.items.length === 0
          ? html`
              <div class="card">
                <p>No assets yet. <a href="#upload">Upload one</a> to get started.</p>
              </div>
            `
          : html`
              <table>
                <thead>
                  <tr><th>ID</th><th>Status</th><th>Tier</th><th>Created</th><th></th></tr>
                </thead>
                <tbody>
                  ${this.items.map((a) => html`
                    <tr>
                      <td><a href=${"#assets/" + a.id}>${a.id.slice(0, 14)}…</a></td>
                      <td>${this._statusBadge(a.status)}</td>
                      <td>${a.encoding_tier}</td>
                      <td>${new Date(a.created_at).toLocaleString()}</td>
                      <td><a href=${"#assets/" + a.id}>View →</a></td>
                    </tr>
                  `)}
                </tbody>
              </table>
              ${this.nextCursor
                ? html`<button type="button" class="secondary" @click=${() => this._load(this.nextCursor)}>
                    Load more
                  </button>`
                : nothing}
            `}
      </section>
    `;
  }
}
customElements.define("portal-assets", PortalAssets);
