// Tiny HashRouter. URL hash format: #<view>[/<param>]. Listeners called with
// { view, param }.

export class HashRouter extends EventTarget {
  constructor() {
    super();
    this._onChange = () => this._emit();
    window.addEventListener("hashchange", this._onChange);
  }

  current() {
    const raw = location.hash.slice(1) || "dashboard";
    const [view, ...rest] = raw.split("/");
    return { view: view || "dashboard", param: rest.join("/") || null };
  }

  navigate(view, param) {
    location.hash = param ? `${view}/${param}` : view;
  }

  _emit() {
    this.dispatchEvent(new CustomEvent("change", { detail: this.current() }));
  }

  dispose() {
    window.removeEventListener("hashchange", this._onChange);
  }
}
