import { LitElement, html, nothing } from "lit";
import { createLiveStream, endLiveStream, listLiveStreamsByApi } from "../lib/api.js";
import { toast } from "./lmt-toast.js";

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
    this.items = [];
    this.inFlight = false;
    this.name = "";
    this.encodingTier = "standard";
    this.error = "";
  }
  connectedCallback() {
    super.connectedCallback();
    this._load();
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    clearTimeout(this._pollTimer);
  }
  async _load() {
    try {
      this.items = await listLiveStreamsByApi();
    } catch (err) {
      this.error = err.message || "Could not load streams.";
    } finally {
      clearTimeout(this._pollTimer);
      if (this.isConnected) this._pollTimer = setTimeout(() => this._load(), 5000);
    }
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

      this.name = "";
      toast(body.status === "opening" ? "Stream setup is pending. It will update automatically." : "Stream ready. Open its details for publishing instructions.");
      await this._load();
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
      this.items = this.items.map((s) => s.stream_id === id ? { ...s, status: "ending" } : s);
      toast("Ending stream. Waiting for the network to confirm closure.");
      await this._load();
    } catch (err) {
      toast(err.message || "End failed.");
    }
  }
  render() {
    return html`
      <section class="portal-main">
        <h1>Live streams</h1>
        <div class="card">
          <h3>Start a new stream</h3>
          <form class="form" @submit=${(e) => this._create(e)}>
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
            <button type="submit" ?disabled=${this.inFlight || this.items.some((s) => s.status === "opening")}>
              ${this.inFlight ? "Creating…" : "Create"}
            </button>
            ${this.error ? html`<div class="error" role="alert">${this.error}</div>` : nothing}
          </form>
        </div>
        <div class="card">
          <h3>Your streams (${this.items.length})</h3>
          <p class="muted">
            The latest 100 streams for your API key appear here. Status updates automatically.
          </p>
          ${this.items.length === 0
            ? html`<p class="muted">No streams yet.</p>`
            : html`
              <div class="table-wrap"><table>
                <thead><tr><th>Name</th><th>Setup</th><th>Status</th><th></th></tr></thead>
                <tbody>
                  ${this.items.map((s) => html`
                    <tr>
                      <td><a href=${"#live/" + s.stream_id}>${s.name || s.stream_id.slice(0, 14)}…</a></td>
                      <td><a href=${"#live/" + s.stream_id}>View details</a></td>
                      <td>${html`<span class="badge ${s.status === "live" ? "live" : ""}">${s.status}</span>`}</td>
                      <td>${["ready", "live"].includes(s.status)
                        ? html`<button type="button" class="danger" @click=${() => this._end(s.stream_id)}>End</button>`
                        : nothing}</td>
                    </tr>
                  `)}
                </tbody>
              </table></div>
            `}
        </div>
      </section>
    `;
  }
}
customElements.define("portal-live-streams", PortalLiveStreams);
