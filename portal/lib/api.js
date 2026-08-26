import { getSession, getApiKey, clearAll, setSession, setApiKey, setProfile } from "./session.js";

const API_BASE = import.meta.env.VITE_API_BASE || "";

/**
 * @typedef {Object} PaidOperationStatus
 * @property {string} operation_id
 * @property {'paid-job/v1'|'paid-session/v1'} protocol
 * @property {string} state
 * @property {string} request_id
 * @property {string} work_unit
 * @property {string} funded_units
 * @property {string|null} claimed_units
 * @property {string|null} balance_units
 * @property {string|null} lease_expires_at
 * @property {string[]} warnings
 * @property {boolean} recovered
 * @property {number} retry_count
 * @property {string|null} next_retry_at
 * @property {string|null} error_code
 * @property {string|null} relay_status
 * @property {string|null} delivered_units
 * @property {string|null} winddown_reason
 * @property {string|null} terminal_at
 */

async function fetchJson(path, init) {
  const res = await fetch(`${API_BASE}${path}`, init);
  if (res.status === 401) {
    clearAll();
    window.dispatchEvent(new CustomEvent("lmt-unauthorized"));
    throw new Error("Unauthorized");
  }
  const ct = res.headers.get("content-type") ?? "";
  const body = ct.includes("application/json") ? await res.json() : await res.text();
  if (!res.ok) {
    const msg = typeof body === "object" && body && "message" in body
      ? body.message : `${res.status} ${res.statusText}`;
    throw new Error(String(msg));
  }
  return body;
}

// ── Session bearer (Authorization: Bearer <sess_...>) ──

async function userRequest(path, init = {}) {
  return fetchJson(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getSession()}`,
      ...(init.headers || {}),
    },
  });
}

export async function login(apiKey) {
  const body = await fetchJson("/api/v1/user/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_key: apiKey }),
  });
  setSession(body.session_token);
  setApiKey(apiKey);
  setProfile(body.user);
  return body;
}

export async function fetchProfile() {
  return userRequest("/api/v1/user/profile");
}

export async function rotateKey() {
  const body = await userRequest("/api/v1/user/rotate-key", { method: "POST" });
  setSession(body.session_token);
  setApiKey(body.api_key);
  return body;
}

export async function logout() {
  try {
    await userRequest("/api/v1/user/logout", { method: "POST" });
  } catch {
    // logout should always succeed client-side
  }
  clearAll();
}

// ── API key bearer (Authorization: Bearer <tc_...>) ──

async function productRequest(path, init = {}) {
  return fetchJson(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getApiKey()}`,
      ...(init.headers || {}),
    },
  });
}

export async function listAssets(opts = {}) {
  const params = new URLSearchParams();
  if (opts.limit) params.set("limit", String(opts.limit));
  if (opts.cursor) params.set("cursor", opts.cursor);
  if (opts.includeDeleted) params.set("include_deleted", "true");
  const q = params.toString();
  return productRequest(`/v1/videos/assets${q ? `?${q}` : ""}`);
}

export async function getAsset(id) {
  return productRequest(`/v1/videos/assets/${encodeURIComponent(id)}`);
}

export async function deleteAsset(id) {
  const res = await fetch(`${API_BASE}/v1/videos/assets/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${getApiKey()}` },
  });
  if (!res.ok && res.status !== 204) {
    throw new Error(`Delete failed: ${res.status}`);
  }
}

export async function createUpload(input) {
  return productRequest("/v1/uploads", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function completeUpload(id) {
  return productRequest(`/v1/uploads/${encodeURIComponent(id)}/complete`, {
    method: "POST",
    body: "{}",
  });
}

export async function submitVod(input) {
  return productRequest("/v1/vod/submit", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function listLiveStreamsByApi() {
  // The gateway doesn't currently have a list-live-streams route; the portal
  // tracks streams created in this session client-side. See plan 0014 §3.6.
  return [];
}

export async function createLiveStream(input) {
  return productRequest("/v1/live/streams", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function getLiveStream(id) {
  return productRequest(`/v1/live/streams/${encodeURIComponent(id)}`);
}

export async function endLiveStream(id) {
  return productRequest(`/v1/live/streams/${encodeURIComponent(id)}/end`, {
    method: "POST",
    body: "{}",
  });
}

// ── Presigned S3 PUT upload with XHR progress ──
//
// `fetch()` doesn't expose upload-progress events; we use XMLHttpRequest.

export function putToPresignedUrl(url, file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(e.loaded / e.total);
      }
    });
    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve(undefined);
      else reject(new Error(`S3 PUT failed: ${xhr.status}`));
    });
    xhr.addEventListener("error", () => reject(new Error("S3 PUT network error")));
    xhr.addEventListener("abort", () => reject(new Error("S3 PUT aborted")));
    xhr.send(file);
  });
}
