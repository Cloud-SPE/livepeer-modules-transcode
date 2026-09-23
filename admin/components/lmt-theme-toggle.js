import { LitElement, html } from "lit";

const KEY = "lmt-theme";

export class LmtThemeToggle extends LitElement {
  static properties = { theme: { state: true } };
  createRenderRoot() { return this; }
  constructor() {
    super();
    this.theme = document.documentElement.getAttribute("data-theme") || "dark";
  }
  _toggle() {
    this.theme = this.theme === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", this.theme);
    localStorage.setItem(KEY, this.theme);
  }
  render() {
    return html`
      <span class="theme-toggle">
        <button type="button" class="secondary" aria-label="Toggle theme" @click=${() => this._toggle()}>
          ${this.theme === "dark" ? "Light" : "Dark"}
        </button>
      </span>
    `;
  }
}
customElements.define("lmt-theme-toggle", LmtThemeToggle);
