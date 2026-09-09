import { LitElement, html, nothing } from "lit";
import { listOperations } from "../lib/api.js";

export class AdminOperations extends LitElement {
  static properties = {
    items: { state: true }, loading: { state: true }, error: { state: true },
    kind: { state: true }, status: { state: true },
  };
  createRenderRoot() { return this; }
  constructor() {
    super();
    this.items = [];
    this.loading = true;
    this.error = "";
    this.kind = "";
    this.status = "";
    this._pollTimer = null;
  }
  connectedCallback() { super.connectedCallback(); void this._load(); }
  disconnectedCallback() { super.disconnectedCallback(); clearTimeout(this._pollTimer); }
  async _load() {
    clearTimeout(this._pollTimer);
    try {
      const result = await listOperations({ kind: this.kind, status: this.status, limit: 100 });
      this.items = result.items;
      this.error = "";
    } catch (error) {
      this.error = error.message || "Could not load operations.";
    } finally {
      this.loading = false;
      this._pollTimer = setTimeout(() => this._load(), 5000);
    }
  }
  render() {
    return html`<section class="admin-main">
      <h2>Paid operations</h2>
      <div class="toolbar">
        <label>Kind <select .value=${this.kind} @change=${(event) => { this.kind = event.target.value; void this._load(); }}>
          <option value="">all</option><option value="job">job</option><option value="session">session</option>
        </select></label>
        <label>Status <input .value=${this.status} @change=${(event) => { this.status = event.target.value.trim(); void this._load(); }}></label>
      </div>
      ${this.error ? html`<div class="error">${this.error}</div>` : nothing}
      ${this.loading ? html`<p class="muted">Loading…</p>` : html`
        <div class="card"><table><thead><tr><th>Protocol</th><th>Product</th><th>State</th><th>Usage</th><th>Correlation</th><th>Warning / error</th></tr></thead>
        <tbody>${this.items.map((item) => html`<tr>
          <td><code>${item.protocol}</code><br><span class="muted">${item.kind}</span></td>
          <td><code>${item.asset_id ?? item.live_stream_id ?? "—"}</code></td>
          <td><span class="badge ${item.state === "settled" && item.output_status !== "output_failed" ? "ok" : item.terminal_at || item.output_status === "stalled" || item.output_status === "output_failed" ? "error" : "warn"}">${item.state}</span>${item.recovered ? html`<br><span class="muted">recovered</span>` : nothing}${item.output_status ? html`<br><span class="muted">output: ${item.output_status.replaceAll("_", " ")}</span>` : nothing}</td>
          <td>${item.claimed_units ?? item.delivered_units ?? "pending"} ${item.work_unit}</td>
          <td><code>${item.operation_id}</code><br><code>${item.request_id}</code></td>
          <td>${item.last_failure_code ?? item.error_code ?? item.winddown_reason ?? (item.warnings.join(", ") || html`<span class="muted">—</span>`)}</td>
        </tr>`)}</tbody></table></div>`}
    </section>`;
  }
}
customElements.define("admin-operations", AdminOperations);
