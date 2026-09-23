// Entry point. Importing each component module triggers its
// customElements.define() side-effect. Vite tree-shakes unused exports.

import "./lmt-theme-toggle.js";
import "./lmt-signup-form.js";
import "./lmt-email-verify.js";
import "./lmt-toast.js";

import { portalUrl } from "../../frontend/links.js";
for (const link of document.querySelectorAll("[data-portal-link]")) link.href = portalUrl;
