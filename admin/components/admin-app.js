import { LitElement, html, nothing } from "lit";
import { hasAdminToken, clearAdminToken } from "../lib/session.js";
import { HashRouter } from "../lib/router.js";

export class AdminApp extends LitElement {
  static properties = {
    authenticated: { state: true },
    view: { state: true },
  };
  createRenderRoot() { return this; }
  constructor() {
    super();
    this.authenticated = hasAdminToken();
    this.router = new HashRouter();
    this.view = this.router.current().view;
  }
  connectedCallback() {
    super.connectedCallback();
    this._onRoute = (e) => { this.view = e.detail.view; };
    this._onUnauth = () => { this.authenticated = false; };
    this._onAuth = () => { this.authenticated = true; location.hash = "dashboard"; };
    this.router.addEventListener("change", this._onRoute);
    window.addEventListener("lmt-unauthorized", this._onUnauth);
    window.addEventListener("lmt-authenticated", this._onAuth);
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    this.router.removeEventListener("change", this._onRoute);
    window.removeEventListener("lmt-unauthorized", this._onUnauth);
    window.removeEventListener("lmt-authenticated", this._onAuth);
    this.router.dispose();
  }
  _logout() {
    clearAdminToken();
    this.authenticated = false;
    location.hash = "";
  }
  _isActive(v) { return this.view === v ? "active" : ""; }
  render() {
    if (!this.authenticated) return html`<admin-login></admin-login>`;
    return html`
      <div class="admin-shell">
        <header class="admin-header">
          <strong>Livepeer Transcode — Admin</strong>
          <nav class="admin-nav">
            <a href="#dashboard" class=${this._isActive("dashboard")}>Dashboard</a>
            <a href="#signups"   class=${this._isActive("signups")}>Signups</a>
            <lmt-theme-toggle></lmt-theme-toggle>
            <button type="button" class="secondary" @click=${() => this._logout()}>Sign out</button>
          </nav>
        </header>
        ${this._renderView()}
      </div>
    `;
  }
  _renderView() {
    switch (this.view) {
      case "dashboard": return html`<admin-dashboard></admin-dashboard>`;
      case "signups":   return html`<admin-signups></admin-signups>`;
      default:          return html`<section class="admin-main"><p class="muted">Unknown view.</p></section>`;
    }
  }
}
customElements.define("admin-app", AdminApp);
