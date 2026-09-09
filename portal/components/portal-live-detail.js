import { LitElement, html, nothing } from "lit";
import { getLiveStream } from "../lib/api.js";
import { operationSummary, operationTone, shouldPollOperation } from "../lib/paid-operation-view.js";

// Per-live-stream view. GET /v1/live/streams/:id (plan 0006).

export class PortalLiveDetail extends LitElement {
  static properties = {
    id: { type: String },
    stream: { state: true },
    loading: { state: true },
    error: { state: true },
  };
  createRenderRoot() { return this; }
  constructor() {
    super();
    this.id = "";
    this.stream = null;
    this.loading = true;
    this.error = "";
    this._pollTimer = null;
  }
  async connectedCallback() {
    super.connectedCallback();
    await this._load();
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    clearTimeout(this._pollTimer);
  }
  async _load() {
    try {
      this.stream = await getLiveStream(this.id);
      clearTimeout(this._pollTimer);
      if (this.stream.status !== "ended" && shouldPollOperation(this.stream.paid_operation)) {
        this._pollTimer = setTimeout(() => this._load(), 5000);
      }
    } catch (err) {
      this.error = err.message || "Not found.";
    } finally {
      this.loading = false;
    }
  }
  render() {
    if (this.loading) return html`<section class="portal-main"><p class="muted">Loading…</p></section>`;
    if (this.error) return html`<section class="portal-main"><div class="error">${this.error}</div></section>`;
    const s = this.stream;
    if (!s) return nothing;
    return html`
      <section class="portal-main">
        <p><a href="#live">← Back to live streams</a></p>
        <h2>${s.name || s.stream_id}</h2>
        <div class="card">
          <p>Status: <span class="badge ${s.status === "live" ? "live" : ""}">${s.status}</span></p>
          ${s.session_id ? html`<p>Session: <code>${s.session_id}</code></p>` : nothing}
          ${s.playback_url ? html`<p>Playback: <a href=${s.playback_url}><code>${s.playback_url}</code></a></p>` : nothing}
          <p class="muted">Created ${new Date(s.created_at).toLocaleString()}${s.ended_at ? `; ended ${new Date(s.ended_at).toLocaleString()}` : ""}</p>
        </div>
        ${s.paid_operation ? html`
          <div class="card" aria-live="polite">
            <h3>Paid session</h3>
            <p>Status: <span class="badge ${operationTone(s.paid_operation)}">${s.paid_operation.state}</span></p>
            <p>${operationSummary(s.paid_operation)}</p>
            ${s.paid_operation.output_status ? html`<p>Output: <strong>${s.paid_operation.output_status.replaceAll("_", " ")}</strong>${s.paid_operation.output_state_since ? ` since ${new Date(s.paid_operation.output_state_since).toLocaleString()}` : ""}</p>` : nothing}
            ${s.paid_operation.last_failure_code ? html`<p class="error">Runner failure: ${s.paid_operation.last_failure_code.replaceAll("_", " ")}</p>` : nothing}
            <p>Delivered: <strong>${s.paid_operation.delivered_units ?? s.paid_operation.claimed_units ?? "0"}</strong> ${s.paid_operation.work_unit}</p>
            ${s.paid_operation.balance_units !== null ? html`<p>Funded balance: ${s.paid_operation.balance_units} ${s.paid_operation.work_unit}</p>` : nothing}
            ${s.paid_operation.lease_expires_at ? html`<p>Lease: ${new Date(s.paid_operation.lease_expires_at).toLocaleString()}</p>` : nothing}
            ${s.paid_operation.warnings.map((warning) => html`<p class="warn">${warning.replaceAll("_", " ")}</p>`)}
            ${s.paid_operation.error_code ? html`<p class="error">${s.paid_operation.error_code}</p>` : nothing}
          </div>
        ` : nothing}
      </section>
    `;
  }
}
customElements.define("portal-live-detail", PortalLiveDetail);
