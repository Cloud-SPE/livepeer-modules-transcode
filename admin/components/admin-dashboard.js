import { LitElement, html, nothing } from "lit";
import { fetchStats } from "../lib/api.js";

// Modeled on blue-claw-network/web-platform/admin/components/admin-dashboard.js.
// Plain numbers grid + 30-day daily count list (no chart for v0).

export class AdminDashboard extends LitElement {
  static properties = {
    stats: { state: true },
    loading: { state: true },
    error: { state: true },
  };
  createRenderRoot() { return this; }
  constructor() {
    super();
    this.stats = null;
    this.loading = true;
    this.error = "";
  }
  async connectedCallback() {
    super.connectedCallback();
    try {
      this.stats = await fetchStats();
    } catch (err) {
      this.error = err.message || "Could not load stats.";
    } finally {
      this.loading = false;
    }
  }
  render() {
    if (this.loading) return html`<section class="admin-main"><p class="muted">Loading…</p></section>`;
    if (this.error) return html`<section class="admin-main"><div class="error">${this.error}</div></section>`;
    const s = this.stats;
    return html`
      <section class="admin-main">
        <h2>Stats</h2>
        <div class="stats-grid">
          <div class="stat"><div class="label">Total signups</div><div class="value">${s.total_signups}</div></div>
          <div class="stat"><div class="label">Today</div><div class="value">${s.today}</div></div>
          <div class="stat"><div class="label">This week</div><div class="value">${s.this_week}</div></div>
          <div class="stat"><div class="label">This month</div><div class="value">${s.this_month}</div></div>
        </div>
        <div class="card">
          <h3>Last 30 days</h3>
          ${s.daily_counts?.length
            ? html`
              <table>
                <thead><tr><th>Date</th><th>Signups</th></tr></thead>
                <tbody>
                  ${s.daily_counts.map((d) => html`
                    <tr><td>${d.date}</td><td>${d.count}</td></tr>
                  `)}
                </tbody>
              </table>`
            : html`<p class="muted">No signups in the last 30 days.</p>`}
          ${nothing}
        </div>
      </section>
    `;
  }
}
customElements.define("admin-dashboard", AdminDashboard);
