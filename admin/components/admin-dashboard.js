import { LitElement, html, nothing } from "lit";
import { fetchStats } from "../lib/api.js";

// Modeled on blue-claw-network/web-platform/admin/components/admin-dashboard.js.
// Plain numbers grid + 30-day daily count list (no chart dependency).

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
    if (this.error) return html`<section class="admin-main"><div class="msg error" role="alert">${this.error}</div></section>`;
    const s = this.stats;
    return html`
      <section class="admin-main">
        <h1>Overview</h1>
        <p class="muted mb-2">Access requests and signup activity.</p>
        <div class="metric-grid">
          <div class="metric"><div class="label">Total signups</div><div class="value">${s.total_signups}</div><div class="sub">All access requests</div></div>
          <div class="metric"><div class="label">Today</div><div class="value">${s.today}</div><div class="sub">Signups today</div></div>
          <div class="metric"><div class="label">This week</div><div class="value">${s.this_week}</div><div class="sub">Signups this week</div></div>
          <div class="metric"><div class="label">This month</div><div class="value">${s.this_month}</div><div class="sub">Signups this month</div></div>
        </div>
        <div class="card">
          <h3>Last 30 days</h3>
          ${s.daily_counts?.length
            ? html`
              <div class="table-wrap"><table>
                <thead><tr><th>Date</th><th>Signups</th></tr></thead>
                <tbody>
                  ${s.daily_counts.map((d) => html`
                    <tr><td>${d.date}</td><td>${d.count}</td></tr>
                  `)}
                </tbody>
              </table></div>`
            : html`<p class="muted">No signups in the last 30 days.</p>`}
          ${nothing}
        </div>
      </section>
    `;
  }
}
customElements.define("admin-dashboard", AdminDashboard);
