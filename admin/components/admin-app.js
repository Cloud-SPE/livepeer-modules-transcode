import { icon } from "../lib/icons.js";
import { LitElement, html, nothing } from "lit";
import { hasAdminToken, clearAdminToken } from "../lib/session.js";
import { HashRouter } from "../lib/router.js";

export class AdminApp extends LitElement {
  static properties = {
    authenticated: { state: true },
    menuOpen: { state: true },
    view: { state: true },
  };
  createRenderRoot() { return this; }
  constructor() {
    super();
    this.menuOpen = false;
    this.authenticated = hasAdminToken();
    this.router = new HashRouter();
    this.view = this.router.current().view;
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
    this._onRoute = (e) => { this._closeMenu(); this.view = e.detail.view; };
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
  _logout() {
    clearAdminToken();
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
    if (!this.authenticated) return html`<admin-login></admin-login>`;
    return html`
      <div class="shell">
        <header class="shell-topbar" ?inert=${this.menuOpen}>
          <div class="row">
            <button class="hamburger ghost" aria-label="Open navigation" aria-controls="admin-navigation" aria-expanded=${this.menuOpen} @click=${() => this._openMenu()}>${icon.menu()}</button>
            <a href="#dashboard" class="brand">Livepeer Transcode · Admin</a>
          </div>
          <div class="row"><lmt-theme-toggle></lmt-theme-toggle><button class="ghost signout" aria-label="Sign out" @click=${() => this._logout()}>${icon.logout()}<span>Sign out</span></button></div>
        </header>
        ${this.menuOpen ? html`<button class="shell-sidebar-backdrop" aria-label="Close navigation" tabindex="-1" @click=${() => this._closeMenu()}></button>` : nothing}
        <aside class="shell-sidebar ${this.menuOpen ? "open" : ""}" id="admin-navigation" aria-label="Operations navigation">
          <button class="drawer-close ghost" aria-label="Close navigation" @click=${() => this._closeMenu()}>${icon.x()} Close</button>
          <div class="sidebar-section">Operations</div>
          <nav aria-label="Operations" @click=${() => this._closeMenu()}>
            <a href="#dashboard" class="sidebar-item ${this._isActive("dashboard")}" aria-current=${this.view === "dashboard" ? "page" : nothing}><span class="icon">${icon.home()}</span>Overview</a>
            <a href="#signups" class="sidebar-item ${this._isActive("signups")}" aria-current=${this.view === "signups" ? "page" : nothing}><span class="icon">${icon.users()}</span>Signups</a>
            <a href="#operations" class="sidebar-item ${this._isActive("operations")}" aria-current=${this.view === "operations" ? "page" : nothing}><span class="icon">${icon.activity()}</span>Operations</a>
            <a href="#catalog" class="sidebar-item ${this._isActive("catalog")}" aria-current=${this.view === "catalog" ? "page" : nothing}><span class="icon">${icon.search()}</span>Capabilities & prices</a>
          </nav>
        </aside>
        <main class="shell-content" ?inert=${this.menuOpen}>${this._renderView()}</main>
      </div>`;
  }
  _renderView() {
    switch (this.view) {
      case "catalog": return html`<admin-catalog></admin-catalog>`;
      case "dashboard": return html`<admin-dashboard></admin-dashboard>`;
      case "signups":   return html`<admin-signups></admin-signups>`;
      case "operations": return html`<admin-operations></admin-operations>`;
      default:          return html`<section class="admin-main"><p class="muted">Unknown view.</p></section>`;
    }
  }
}
customElements.define("admin-app", AdminApp);
