import { LitElement, html, nothing } from "lit";
import { createLiveStream, endLiveStream } from "../lib/api.js";
import { toast } from "./lmt-toast.js";

// Live streams (plan 0006). Lists streams created in this session
// (sessionStorage-backed; gateway has no list-live-streams endpoint
// in v0). POST /v1/live/streams creates; POST :id/end ends.

const STORE = "lmt-live-streams";

function readSessionStreams() {
  try {
    const raw = sessionStorage.getItem(STORE);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeSessionStreams(items) {
  sessionStorage.setItem(STORE, JSON.stringify(items));
}

export class PortalLiveStreams extends LitElement {
  static properties = {
    items: { state: true },
    inFlight: { state: true },
    name: { state: true },
    encodingTier: { state: true },
    error: { state: true },
  };
  createRenderRoot() { return this; }
  constructor() {
    super();
    this.items = readSessionStreams();
    this.inFlight = false;
    this.name = "";
    this.encodingTier = "standard";
    this.error = "";
  }
  async _create(e) {
    e.preventDefault();
    if (this.inFlight) return;
    this.inFlight = true;
    this.error = "";
    try {
      const body = await createLiveStream({
        ...(this.name ? { name: this.name } : {}),
        encoding_tier: this.encodingTier,
      });
      this.items = [body, ...this.items];
      writeSessionStreams(this.items);
      this.name = "";
      toast("Live stream created.");
    } catch (err) {
      this.error = err.message || "Could not create stream.";
    } finally {
      this.inFlight = false;
    }
  }
  async _end(id) {
    if (!confirm("End this live stream?")) return;
    try {
      await endLiveStream(id);
      this.items = this.items.map((s) => s.stream_id === id ? { ...s, _ended: true } : s);
      writeSessionStreams(this.items);
      toast("Stream ended.");
    } catch (err) {
      toast(err.message || "End failed.");
    }
  }
  render() {
    return html`
      <section class="portal-main">
        <h2>Live streams</h2>
        <div class="card">
          <h3>Start a new stream</h3>
          <form @submit=${(e) => this._create(e)}>
            <label>
              Name (optional)
              <input maxlength="160" .value=${this.name} @input=${(e) => { this.name = e.target.value; }}>
            </label>
            <label>
              Encoding tier
              <select .value=${this.encodingTier} @change=${(e) => { this.encodingTier = e.target.value; }}>
                <option value="baseline">baseline (h264)</option>
                <option value="standard" selected>standard (h264 + hevc)</option>
                <option value="premium">premium (h264 + hevc + av1)</option>
              </select>
            </label>
            <button type="submit" ?disabled=${this.inFlight}>
              ${this.inFlight ? "Creating…" : "Create"}
            </button>
            ${this.error ? html`<div class="error" role="alert">${this.error}</div>` : nothing}
          </form>
        </div>
        <div class="card">
          <h3>Created in this tab (${this.items.length})</h3>
          <p class="muted">
            Live streams aren't listed server-side in v0 (no list route
            yet). This view holds streams created in this browser tab.
          </p>
          ${this.items.length === 0
            ? html`<p class="muted">No streams yet.</p>`
            : html`
              <table>
                <thead><tr><th>Name</th><th>RTMP URL</th><th>Kind</th><th>Status</th><th></th></tr></thead>
                <tbody>
                  ${this.items.map((s) => html`
                    <tr>
                      <td><a href=${"#live/" + s.stream_id}>${s.name || s.stream_id.slice(0, 14)}…</a></td>
                      <td><code>${s.rtmp_push_url}</code></td>
                      <td><span class="badge ${s.rtmp_push_url_kind === "gateway_relay" ? "live" : ""}">${s.rtmp_push_url_kind}</span></td>
                      <td>${s._ended ? html`<span class="badge">ended</span>` : html`<span class="badge live">active</span>`}</td>
                      <td>${!s._ended
                        ? html`<button type="button" class="danger" @click=${() => this._end(s.stream_id)}>End</button>`
                        : nothing}</td>
                    </tr>
                  `)}
                </tbody>
              </table>
            `}
        </div>
      </section>
    `;
  }
}
customElements.define("portal-live-streams", PortalLiveStreams);
