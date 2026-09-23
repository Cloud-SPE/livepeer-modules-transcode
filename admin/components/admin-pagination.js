import { LitElement, html, nothing } from "lit";

// Modeled on blue-claw-network/web-platform/admin/components/admin-pagination.js.
// Tiny page-prev / page-next control. Emits `page-change` with detail.page.

export class AdminPagination extends LitElement {
  static properties = {
    page: { type: Number },
    totalPages: { type: Number, attribute: "total-pages" },
  };
  createRenderRoot() { return this; }
  constructor() {
    super();
    this.page = 1;
    this.totalPages = 1;
  }
  _go(p) {
    if (p < 1 || p > this.totalPages || p === this.page) return;
    this.dispatchEvent(new CustomEvent("page-change", { detail: { page: p } }));
  }
  render() {
    if (this.totalPages <= 1) return nothing;
    return html`
      <nav class="lmt-actions lmt-space-top">
        <button type="button" class="secondary" ?disabled=${this.page <= 1} @click=${() => this._go(this.page - 1)}>← Prev</button>
        <span class="muted">Page ${this.page} of ${this.totalPages}</span>
        <button type="button" class="secondary" ?disabled=${this.page >= this.totalPages} @click=${() => this._go(this.page + 1)}>Next →</button>
      </nav>
    `;
  }
}
customElements.define("admin-pagination", AdminPagination);
