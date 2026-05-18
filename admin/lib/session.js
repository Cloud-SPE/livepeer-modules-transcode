const KEY = "lmt-admin-token";

export function getAdminToken() {
  return sessionStorage.getItem(KEY) || "";
}
export function setAdminToken(token) {
  sessionStorage.setItem(KEY, token);
}
export function clearAdminToken() {
  sessionStorage.removeItem(KEY);
}
export function hasAdminToken() {
  return Boolean(getAdminToken());
}
