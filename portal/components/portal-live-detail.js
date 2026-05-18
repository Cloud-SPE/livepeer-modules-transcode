import { LitElement, html, nothing } from "lit";
import { getLiveStream } from "../lib/api.js";

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
  }
  async connectedCallback() {
    super.connectedCallback();
    try {
      this.stream = await getLiveStream(this.id);
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
      </section>
    `;
  }
}
customElements.define("portal-live-detail", PortalLiveDetail);
