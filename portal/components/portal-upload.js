import { LitElement, html, nothing } from "lit";
import { createUpload, completeUpload, submitVod, putToPresignedUrl } from "../lib/api.js";
import { toast } from "./lmt-toast.js";

// Presigned-S3-PUT upload widget (plan 0005). Flow:
//   1. file pick
//   2. POST /v1/uploads -> presigned PUT URL + asset_id
//   3. XHR PUT bytes directly to S3 with upload-progress events
//   4. POST /v1/uploads/:id/complete
//   5. POST /v1/vod/submit { asset_id, encoding_tier: 'standard' }

export class PortalUpload extends LitElement {
  static properties = {
    phase: { state: true },          // idle | preparing | uploading | submitting | done | error
    progress: { state: true },
    file: { state: true },
    assetId: { state: true },
    error: { state: true },
  };
  createRenderRoot() { return this; }
  constructor() {
    super();
    this.phase = "idle";
    this.progress = 0;
    this.file = null;
    this.assetId = null;
    this.error = "";
  }
  _onFile(e) {
    const f = e.target.files?.[0];
    this.file = f || null;
  }
  async _start() {
    if (!this.file) return;
    this.phase = "preparing";
    this.error = "";
    this.progress = 0;
    try {
      const init = await createUpload({
        filename: this.file.name,
        content_type: this.file.type || "application/octet-stream",
      });
      this.assetId = init.asset_id;
      this.phase = "uploading";
      await putToPresignedUrl(init.upload_url, this.file, (p) => { this.progress = p; });
      this.phase = "submitting";
      await completeUpload(init.upload_id);
      await submitVod({ asset_id: init.asset_id, encoding_tier: "standard" });
      this.phase = "done";
      toast("Upload submitted for transcoding.");
    } catch (err) {
      this.phase = "error";
      this.error = err.message || "Upload failed.";
    }
  }
  _reset() {
    this.phase = "idle";
    this.progress = 0;
    this.file = null;
    this.assetId = null;
    this.error = "";
  }
  render() {
    return html`
      <section class="portal-main">
        <h2>Upload a VOD file</h2>
        ${this.phase === "done"
          ? html`
              <div class="card">
                <p class="success">Upload submitted. Transcoding in progress.</p>
                <p><a href=${"#assets/" + this.assetId}>View asset →</a></p>
                <button type="button" class="secondary" @click=${() => this._reset()}>Upload another</button>
              </div>
            `
          : html`
              <div class="card">
                <p class="muted">
                  Files upload directly to S3 via a presigned URL — the
                  gateway only orchestrates. Default encoding tier is
                  <code>standard</code> (h264 + hevc).
                </p>
                <form @submit=${(e) => { e.preventDefault(); this._start(); }}>
                  <label>
                    File
                    <input type="file" accept="video/*" required @change=${(e) => this._onFile(e)} ?disabled=${this.phase !== "idle"}>
                  </label>
                  ${this.phase !== "idle"
                    ? html`
                        <div>
                          <div class="muted">Phase: ${this.phase}</div>
                          <div class="progress" style=${"--pct: " + Math.round(this.progress * 100) + "%"}><span></span></div>
                          <div class="muted">${Math.round(this.progress * 100)}%</div>
                        </div>
                      `
                    : nothing}
                  ${this.error ? html`<div class="error" role="alert">${this.error}</div>` : nothing}
                  <button type="submit" ?disabled=${!this.file || this.phase !== "idle"}>
                    ${this.phase === "idle" ? "Upload + submit" : "In progress…"}
                  </button>
                </form>
              </div>
            `}
      </section>
    `;
  }
}
customElements.define("portal-upload", PortalUpload);
