// Production can override VITE_PORTAL_URL and VITE_SITE_URL at build time.
// The separate-port development stack uses the current hostname.
function localUrl(port) {
  const url = new URL(location.origin);
  url.port = port;
  return `${url.origin}/`;
}
const local = import.meta.env.DEV && ["3000", "3001", "3002"].includes(location.port);
export const portalUrl = import.meta.env.VITE_PORTAL_URL || (local ? localUrl("3002") : "/portal/");
export const siteUrl = import.meta.env.VITE_SITE_URL || (local ? localUrl("3000") : "/");
