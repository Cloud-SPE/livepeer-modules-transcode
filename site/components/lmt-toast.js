import { LitElement, html, nothing } from "lit";

// Modeled on blue-claw-network/web-platform/site/components/cc-toast.js.
// Listens for `lmt-toast-message` CustomEvent on window; shows a transient
// banner for 4s.

const EVENT = "lmt-toast-message";
const DURATION_MS = 4000;

export class LmtToast extends LitElement {
  static properties = { message: { state: true } };

  createRenderRoot() { return this; }

  constructor() {
    super();
    this.message = "";
    this._timer = null;
    this._listener = (e) => this._show(e.detail);
  }

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener(EVENT, this._listener);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener(EVENT, this._listener);
    if (this._timer) clearTimeout(this._timer);
  }

  _show(detail) {
    this.message = typeof detail === "string" ? detail : detail?.message ?? "";
    if (this._timer) clearTimeout(this._timer);
    this._timer = setTimeout(() => { this.message = ""; }, DURATION_MS);
  }

  render() {
    return this.message
      ? html`<div class="toast" role="status">${this.message}</div>`
      : nothing;
  }
}

customElements.define("lmt-toast", LmtToast);
