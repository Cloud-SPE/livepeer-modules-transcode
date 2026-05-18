import { LitElement, html } from "lit";

// Modeled on blue-claw-network/web-platform/site/components/cc-theme-toggle.js.
// Light DOM (per frontend-dom-and-css-invariants.md §1). Persists choice to
// localStorage; respects prefers-color-scheme on first visit (handled by the
// inline script in <head> to avoid FOUC).

const KEY = "lmt-theme";

export class LmtThemeToggle extends LitElement {
  static properties = { theme: { state: true } };

  createRenderRoot() { return this; }

  constructor() {
    super();
    this.theme = document.documentElement.getAttribute("data-theme") || "light";
  }

  _toggle() {
    this.theme = this.theme === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", this.theme);
    localStorage.setItem(KEY, this.theme);
  }

  render() {
    return html`
      <span class="theme-toggle">
        <button type="button" aria-label="Toggle theme" @click=${() => this._toggle()}>
          ${this.theme === "dark" ? "Light" : "Dark"}
        </button>
      </span>
    `;
  }
}

customElements.define("lmt-theme-toggle", LmtThemeToggle);
