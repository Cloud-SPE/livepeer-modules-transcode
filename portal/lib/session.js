// Per-tab session + API-key storage. Cleared on logout / 401 / new tab.

const KEYS = {
  session: "lmt-session-token",
  apiKey: "lmt-api-key",
  profile: "lmt-user-profile",
};

export function getSession() {
  return sessionStorage.getItem(KEYS.session) || "";
}
export function setSession(token) {
  sessionStorage.setItem(KEYS.session, token);
}

export function getApiKey() {
  return sessionStorage.getItem(KEYS.apiKey) || "";
}
export function setApiKey(key) {
  sessionStorage.setItem(KEYS.apiKey, key);
}

export function getProfile() {
  try {
    const raw = sessionStorage.getItem(KEYS.profile);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
export function setProfile(profile) {
  sessionStorage.setItem(KEYS.profile, JSON.stringify(profile));
}

export function clearAll() {
  for (const k of Object.values(KEYS)) sessionStorage.removeItem(k);
}

export function hasSession() {
  return Boolean(getSession());
}
