import { resendVerification } from "../lib/api.js";
import { LitElement, html, nothing } from "lit";
import { listWaitlist, approveBatch, rejectBatch, deleteOne, exportUrl } from "../lib/api.js";
import { toast } from "./lmt-toast.js";

// Modeled on blue-claw-network/web-platform/admin/components/admin-signups.js.
// Paginated waitlist list with filters + batch approve/reject + delete.

const STATUSES = ["", "pending", "approved", "rejected"];

export class AdminSignups extends LitElement {
  static properties = {
    actionMessage: { state: true },
    resending: { state: true },
    rows: { state: true },
    page: { state: true },
    perPage: { state: true },
    totalPages: { state: true },
    status: { state: true },
    search: { state: true },
    selected: { state: true },         // Set of row ids
    sendEmails: { state: true },
    loading: { state: true },
    error: { state: true },
    issuedKeys: { state: true },       // one-time approval results, independent of list filters
  };
  createRenderRoot() { return this; }
  constructor() {
    super();
    this.actionMessage = "";
    this.resending = null;
    this.rows = [];
    this.page = 1;
    this.perPage = 50;
    this.totalPages = 1;
    this.status = "pending";
    this.search = "";
    this.selected = new Set();
    this.sendEmails = true;
    this.loading = true;
    this.error = "";
    this.issuedKeys = [];
  }
  async connectedCallback() {
    super.connectedCallback();
    await this._load();
  }
  async _load() {
    this.loading = true;
    this.error = "";
    try {
      const opts = {
        page: this.page,
        perPage: this.perPage,
        sort: "created_at",
        order: "desc",
      };
      if (this.status) opts.status = this.status;
      if (this.search) opts.search = this.search;
      const res = await listWaitlist(opts);
      this.rows = res.data;
      this.totalPages = res.pagination.total_pages || 1;
    } catch (err) {
      this.error = err.message || "Could not load waitlist.";
    } finally {
      this.loading = false;
    }
  }
  _toggle(id) {
    const next = new Set(this.selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    this.selected = next;
  }
  _toggleAll() {
    if (this.selected.size === this.rows.length) {
      this.selected = new Set();
    } else {
      this.selected = new Set(this.rows.map((r) => r.id));
    }
  }
  async _approve() {
    if (this.selected.size === 0) return;
    if (!confirm(`Approve ${this.selected.size} signup(s)?${this.sendEmails ? " Emails will be sent." : ""}`)) return;
    try {
      const res = await approveBatch([...this.selected], this.sendEmails);
      this.issuedKeys = [...(res.keys || []), ...this.issuedKeys];
      const skipped = res.skipped || [];
      this.selected = new Set(skipped.map(row => row.id));
      const reasons = skipped.map(row => {
        const email = this.rows.find(r => r.id === row.id)?.email || row.id;
        return `${email}: ${row.reason === "email_not_verified" ? "Verify email first; use Resend verification below." : row.reason === "not_pending" ? "This signup is no longer pending." : row.reason}`;
      });
      this.actionMessage = [
        `Approved ${res.approved}. Emails accepted by provider: ${res.emails_sent}.`,
        ...(res.emails_dryrun ? ["Email is in dry-run mode; nothing was delivered."] : []),
        ...reasons, ...(res.email_errors || []).map(e => `Email failed: ${e}`),
      ].join(" ");
      await this._load();
    } catch (err) {
      toast(err.message || "Approve failed.");
    }
  }
  async _resend(row) {
    if (this.resending) return;
    this.resending = row.id;
    this.actionMessage = "";
    try {
      const result = await resendVerification(row.id);
      this.actionMessage = result.delivery === "accepted"
        ? `Verification email accepted by the provider for ${row.email}. Open that link, then refresh and approve the signup.`
        : "Email is in dry-run mode; no email was sent.";
    } catch (error) { this.actionMessage = error.message || "Resend failed."; }
    finally { this.resending = null; }
  }
  async _reject() {
    if (this.selected.size === 0) return;
    if (!confirm(`Reject ${this.selected.size} signup(s)?`)) return;
    try {
      const res = await rejectBatch([...this.selected]);
      this.selected = new Set();
      toast(`Rejected ${res.rejected}.`);
      await this._load();
    } catch (err) {
      toast(err.message || "Reject failed.");
    }
  }
  async _delete(id) {
    if (!confirm("Delete this signup entirely?")) return;
    try {
      await deleteOne(id);
      toast("Deleted.");
      await this._load();
    } catch (err) {
      toast(err.message || "Delete failed.");
    }
  }
  _badge(row) {
    if (row.status === "approved") return html`<span class="badge ok">approved</span>`;
    if (row.status === "rejected") return html`<span class="badge error">rejected</span>`;
    return row.email_verified
      ? html`<span class="badge warn">pending (verified)</span>`
      : html`<span class="badge">pending (unverified)</span>`;
  }
  render() {
    return html`
      <section class="admin-main">
        <h1>Waitlist</h1>
        ${this.actionMessage ? html`<div class="msg mb-2" role="status">${this.actionMessage}</div>` : nothing}

        ${this.issuedKeys.length ? html`<div class="card">
          <div class="page-heading"><h3>New API keys — save now</h3><button type="button" class="ghost small" @click=${() => { this.issuedKeys = []; }}>Dismiss keys</button></div>
          <p class="muted">These keys are shown only for this approval response. Save them before leaving this page.</p>
          ${this.issuedKeys.map(key => html`<p>${key.email}</p><div class="key-display mb-2">${key.key}</div>`)}
        </div>` : nothing}
        <div class="card">
          <div class="toolbar">
            <label>
              Status
              <select .value=${this.status} @change=${(e) => { this.status = e.target.value; this.page = 1; this._load(); }}>
                ${STATUSES.map((s) => html`<option value=${s}>${s || "all"}</option>`)}
              </select>
            </label>
            <label>
              Search
              <input type="search" placeholder="name or email"
                .value=${this.search}
                @change=${(e) => { this.search = e.target.value; this.page = 1; this._load(); }}>
            </label>
            <button type="button" class="secondary" @click=${() => this._load()}>Refresh</button>
            <a href=${exportUrl()} target="_blank" rel="noopener" class="badge">Export CSV</a>
          </div>

          ${this.error ? html`<div class="msg error" role="alert">${this.error}</div>` : nothing}

          ${this.loading
            ? html`<p class="muted">Loading…</p>`
            : this.rows.length === 0
            ? html`<p class="muted">No signups match.</p>`
            : html`
              <div class="table-wrap"><table>
                <thead>
                  <tr>
                    <th><input type="checkbox" aria-label="Select all signups" ?checked=${this.selected.size === this.rows.length && this.rows.length > 0} @change=${() => this._toggleAll()}></th>
                    <th>Email</th>
                    <th>Name</th>
                    <th>Status</th>
                    <th>Created</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  ${this.rows.map((r) => html`
                    <tr>
                      <td><input type="checkbox" aria-label=${`Select ${r.email}`} ?checked=${this.selected.has(r.id)} @change=${() => this._toggle(r.id)}></td>
                      <td>${r.email}</td>
                      <td>${r.name}</td>
                      <td>${this._badge(r)}</td>
                      <td>${new Date(r.created_at).toLocaleString()}</td>
                      <td><div class="lmt-actions">
                        ${r.status === "pending" && !r.email_verified ? html`<button type="button" class="ghost" ?disabled=${this.resending !== null} @click=${() => this._resend(r)}>${this.resending === r.id ? "Sending…" : "Resend verification"}</button>` : nothing}
                        <button type="button" class="danger" @click=${() => this._delete(r.id)}>Delete</button></div></td>
                    </tr>

                  `)}
                </tbody>
              </table></div>
              <admin-pagination .page=${this.page} .totalPages=${this.totalPages}
                @page-change=${(e) => { this.page = e.detail.page; this._load(); }}></admin-pagination>
            `}
        </div>

        <div class="card">
          <h3>Batch actions on ${this.selected.size} selected</h3>
          <label>
            <input type="checkbox" ?checked=${this.sendEmails}
              @change=${(e) => { this.sendEmails = e.target.checked; }}>
            Email API keys on approve
          </label>
          <div class="lmt-actions lmt-space-top">
            <button type="button" class="success" ?disabled=${this.selected.size === 0} @click=${() => this._approve()}>Approve</button>
            <button type="button" class="danger"  ?disabled=${this.selected.size === 0} @click=${() => this._reject()}>Reject</button>
          </div>
        </div>
      </section>
    `;
  }
}
customElements.define("admin-signups", AdminSignups);
