import { LitElement, html, nothing } from "lit";
import { hasSession, clearAll } from "../lib/session.js";
import { logout } from "../lib/api.js";
import { HashRouter } from "../lib/router.js";

// App shell. Routes via HashRouter; views are child components per the
// hash segment.

export class PortalApp extends LitElement {
  static properties = {
    authenticated: { state: true },
    view: { state: true },
    param: { state: true },
  };
  createRenderRoot() { return this; }
  constructor() {
    super();
    this.authenticated = hasSession();
    this.router = new HashRouter();
    const r = this.router.current();
    this.view = r.view;
    this.param = r.param;
  }
  connectedCallback() {
    super.connectedCallback();
    this._onRoute = (e) => { this.view = e.detail.view; this.param = e.detail.param; };
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
  async _logout() {
    await logout();
    clearAll();
    this.authenticated = false;
    location.hash = "";
  }
  _isActive(v) { return this.view === v ? "active" : ""; }
  render() {
    if (!this.authenticated) return html`<portal-login></portal-login>`;
    return html`
      <div class="portal-shell">
        <header class="portal-header">
          <strong>Livepeer Transcode</strong>
          <nav class="portal-nav">
            <a href="#dashboard" class=${this._isActive("dashboard")}>Dashboard</a>
            <a href="#account" class=${this._isActive("account")}>Account</a>
            <a href="#assets" class=${this._isActive("assets")}>Assets</a>
            <a href="#upload" class=${this._isActive("upload")}>Upload</a>
            <a href="#live" class=${this._isActive("live")}>Live</a>
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
      case "dashboard": return html`<portal-dashboard></portal-dashboard>`;
      case "account":   return html`<portal-account></portal-account>`;
      case "assets":
        return this.param
          ? html`<portal-asset-detail id=${this.param}></portal-asset-detail>`
          : html`<portal-assets></portal-assets>`;
      case "upload":    return html`<portal-upload></portal-upload>`;
      case "live":
        return this.param
          ? html`<portal-live-detail id=${this.param}></portal-live-detail>`
          : html`<portal-live-streams></portal-live-streams>`;
      default:
        return html`<section class="portal-main"><p class="muted">Unknown view: ${this.view}</p></section>`;
    }
  }
}
customElements.define("portal-app", PortalApp);
