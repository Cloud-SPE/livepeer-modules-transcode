import { LitElement, html, nothing } from "lit";
import { fetchCatalog } from "../lib/api.js";
import { icon } from "../lib/icons.js";

// LOC cc-catalog composition, adapted to transcode without legacy mint snippets.
export class Catalog extends LitElement {
  static properties = { data: {state:true}, loading:{state:true}, error:{state:true}, scope:{state:true}, search:{state:true} };
  createRenderRoot() { return this; }
  constructor() { super(); this.data=null; this.loading=true; this.error=""; this.scope="video"; this.search=""; }
  connectedCallback() { super.connectedCallback(); this._load(); }
  async _load() {
    this.loading=true; this.error="";
    try { this.data=await fetchCatalog(); } catch(e) { this.data=null; this.error=e.message || "Catalog unavailable."; }
    finally { this.loading=false; }
  }
  render() {
    const items=(this.data?.items || []).filter(c => (this.scope === "all" || c.name.startsWith("video:")) &&
      `${c.name} ${c.offerings.map(o=>o.id).join(" ")}`.toLowerCase().includes(this.search.toLowerCase()));
    return html`<section class="portal-main">
      <div class="page-heading"><h1>Capabilities & prices</h1><button class="ghost small" ?disabled=${this.loading} @click=${()=>this._load()}>${icon.refresh()} Refresh</button></div>
      <p class="muted mb-2">Advertised network offerings from LOC. Prices below are network wholesale rates, not a customer invoice or a reserved quote. Availability and pricing are checked when a job starts.</p>
      <div class="toolbar"><label>Scope<select .value=${this.scope} @change=${e=>{this.scope=e.target.value;}}><option value="video">Video capabilities</option><option value="all">All network capabilities</option></select></label>
      <label>Search<input type="search" placeholder="Capability or offering" .value=${this.search} @input=${e=>{this.search=e.target.value;}}></label>
      ${this.data ? html`<span class="muted small">Updated ${new Date(this.data.fetched_at).toLocaleTimeString()}</span>`:nothing}</div>
      ${this.loading ? html`<p class="muted" role="status">Loading capabilities…</p>`:nothing}
      ${this.error ? html`<div class="msg error" role="alert">${this.error}</div>`:nothing}
      ${!this.loading && !this.error && !items.length ? html`<div class="card"><p class="muted">No capabilities match these filters.</p></div>`:nothing}
      ${items.map(cap=>html`<div class="card"><h3><code>${cap.name}</code></h3><p class="muted small">${cap.offerings.length} offerings · work unit: <code>${cap.work_unit || "See offering"}</code></p>
        <div class="table-wrap"><table><thead><tr><th>Offering</th><th>Protocol</th><th>Network price</th><th>This gateway</th></tr></thead><tbody>
        ${cap.offerings.map(o=>html`<tr><td><code>${o.id}</code></td><td><span class="badge">${o.protocol}</span>${o.job?.transports?.length ? html`<span class="sub">${o.job.transports.join(", ")}</span>`:nothing}</td>
        <td>${o.price_per_work_unit_wei === null ? "Not quoted" : html`<span class="num">${o.price_per_work_unit_wei} wei</span><span class="sub">per ${o.units_per_price} ${o.work_unit || cap.work_unit || "work units"}</span>`}</td>
        <td>${o.configured_for_gateway ? html`<span class="badge ok">Configured</span>`:html`<span class="muted">Network catalog only</span>`}</td></tr>`)}
        </tbody></table></div></div>`)}
    </section>`;
  }
}
customElements.define("portal-catalog", Catalog);
