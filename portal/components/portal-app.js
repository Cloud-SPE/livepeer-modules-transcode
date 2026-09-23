import { icon } from "../lib/icons.js";
import { LitElement, html, nothing } from "lit";
import { hasSession, clearAll, getProfile } from "../lib/session.js";
import { logout } from "../lib/api.js";
import { HashRouter } from "../lib/router.js";

// App shell. Routes via HashRouter; views are child components per the
// hash segment.

export class PortalApp extends LitElement {
  static properties = {
    authenticated: { state: true },
    menuOpen: { state: true },
    view: { state: true },
    param: { state: true },
  };
  createRenderRoot() { return this; }
  constructor() {
    super();
    this.menuOpen = false;
    this.authenticated = hasSession();
    this.router = new HashRouter();
    const r = this.router.current();
    this.view = r.view;
    this.param = r.param;
  }
  connectedCallback() {
    super.connectedCallback();
    this._drawerKey = (e) => {
      if (!this.menuOpen) return;
      if (e.key === "Escape") { e.preventDefault(); this._closeMenu(); }
      if (e.key === "Tab") {
        const items = [...this.querySelectorAll(".shell-sidebar button, .shell-sidebar a")];
        const first = items[0], last = items.at(-1);
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    };
    window.addEventListener("keydown", this._drawerKey);
    this._desktop = window.matchMedia("(min-width: 761px)");
    this._resize = () => { if (this._desktop.matches) this._closeMenu(false); };
    this._desktop.addEventListener("change", this._resize);
    this._onRoute = (e) => { this._closeMenu(); this.view = e.detail.view; this.param = e.detail.param; };
    this._onUnauth = () => { this.menuOpen = false; this.authenticated = false; };
    this._onAuth = () => { this.authenticated = true; location.hash = "dashboard"; };
    this.router.addEventListener("change", this._onRoute);
    window.addEventListener("lmt-unauthorized", this._onUnauth);
    window.addEventListener("lmt-authenticated", this._onAuth);
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("keydown", this._drawerKey);
    this._desktop.removeEventListener("change", this._resize);
    this.router.removeEventListener("change", this._onRoute);
    window.removeEventListener("lmt-unauthorized", this._onUnauth);
    window.removeEventListener("lmt-authenticated", this._onAuth);
    this.router.dispose();
  }
  async _logout() {
    await logout();
    clearAll();
    this.menuOpen = false;
    this.authenticated = false;
    location.hash = "";
  }
  _isActive(v) { return this.view === v ? "active" : ""; }
  async _openMenu() {
    this.menuOpen = true;
    await this.updateComplete;
    this.querySelector(".drawer-close")?.focus();
  }
  async _closeMenu(restore = true) {
    const wasOpen = this.menuOpen;
    this.menuOpen = false;
    await this.updateComplete;
    if (wasOpen && restore) this.querySelector(".hamburger")?.focus();
  }
  render() {
    if (!this.authenticated) return html`<portal-login></portal-login>`;
    return html`
      <div class="shell">
        <header class="shell-topbar" ?inert=${this.menuOpen}>
          <div class="row">
            <button class="hamburger ghost" aria-label="Open navigation" aria-controls="portal-navigation" aria-expanded=${this.menuOpen} @click=${() => this._openMenu()}>${icon.menu()}</button>
            <a href="#dashboard" class="brand">Livepeer Transcode</a>
          </div>
          <div class="row">${getProfile()?.email ? html`<span class="muted user-email">${getProfile().email}</span>` : nothing}<lmt-theme-toggle></lmt-theme-toggle><button class="ghost signout" aria-label="Sign out" @click=${() => this._logout()}>${icon.logout()}<span>Sign out</span></button></div>
        </header>
        ${this.menuOpen ? html`<button class="shell-sidebar-backdrop" aria-label="Close navigation" tabindex="-1" @click=${() => this._closeMenu()}></button>` : nothing}
        <aside class="shell-sidebar ${this.menuOpen ? "open" : ""}" id="portal-navigation" aria-label="Account navigation">
          <button class="drawer-close ghost" aria-label="Close navigation" @click=${() => this._closeMenu()}>${icon.x()} Close</button>
          <div class="sidebar-section">Account</div>
          <nav aria-label="Account" @click=${() => this._closeMenu()}>
            <a href="#dashboard" class="sidebar-item ${this._isActive("dashboard")}" aria-current=${this.view === "dashboard" ? "page" : nothing}><span class="icon">${icon.home()}</span>Dashboard</a>
            <a href="#assets" class="sidebar-item ${this._isActive("assets")}" aria-current=${this.view === "assets" ? "page" : nothing}><span class="icon">${icon.log()}</span>Assets</a>
            <a href="#upload" class="sidebar-item ${this._isActive("upload")}" aria-current=${this.view === "upload" ? "page" : nothing}><span class="icon">${icon.plus()}</span>Upload video</a>
            <a href="#live" class="sidebar-item ${this._isActive("live")}" aria-current=${this.view === "live" ? "page" : nothing}><span class="icon">${icon.activity()}</span>Live streams</a>
            <a href="#account" class="sidebar-item ${this._isActive("account")}" aria-current=${this.view === "account" ? "page" : nothing}><span class="icon">${icon.key()}</span>Account</a>
            <a href="#catalog" class="sidebar-item ${this._isActive("catalog")}" aria-current=${this.view === "catalog" ? "page" : nothing}><span class="icon">${icon.search()}</span>Capabilities & prices</a>
          </nav>
        </aside>
        <main class="shell-content" ?inert=${this.menuOpen}>${this._renderView()}</main>
      </div>`;
  }
  _renderView() {
    switch (this.view) {
      case "catalog": return html`<portal-catalog></portal-catalog>`;
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
