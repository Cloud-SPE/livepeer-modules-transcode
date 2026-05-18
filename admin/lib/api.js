import { getAdminToken, clearAdminToken } from "./session.js";

const API_BASE = import.meta.env.VITE_API_BASE || "";

async function adminRequest(path, init = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getAdminToken()}`,
      ...(init.headers || {}),
    },
  });
  if (res.status === 401) {
    clearAdminToken();
    window.dispatchEvent(new CustomEvent("lmt-unauthorized"));
    throw new Error("Unauthorized");
  }
  const ct = res.headers.get("content-type") ?? "";
  const body = ct.includes("application/json") ? await res.json() : await res.text();
  if (!res.ok) {
    const msg = typeof body === "object" && body && "message" in body ? body.message : `${res.status}`;
    throw new Error(String(msg));
  }
  return body;
}

export async function verifyAdminToken() {
  // Cheapest auth-gated route: count
  return adminRequest("/api/v1/admin/waitlist/count");
}

export async function fetchStats() {
  return adminRequest("/api/v1/admin/stats");
}

export async function listWaitlist(opts = {}) {
  const params = new URLSearchParams();
  if (opts.page) params.set("page", String(opts.page));
  if (opts.perPage) params.set("per_page", String(opts.perPage));
  if (opts.sort) params.set("sort", opts.sort);
  if (opts.order) params.set("order", opts.order);
  if (opts.search) params.set("search", opts.search);
  if (opts.status) params.set("status", opts.status);
  if (opts.verified !== undefined) params.set("verified", String(opts.verified));
  return adminRequest(`/api/v1/admin/waitlist?${params.toString()}`);
}

export async function approveBatch(ids, sendEmails) {
  return adminRequest("/api/v1/admin/waitlist/approve", {
    method: "POST",
    body: JSON.stringify({ ids, send_emails: sendEmails }),
  });
}

export async function rejectBatch(ids) {
  return adminRequest("/api/v1/admin/waitlist/reject", {
    method: "POST",
    body: JSON.stringify({ ids }),
  });
}

export async function deleteOne(id) {
  return adminRequest(`/api/v1/admin/waitlist/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export function exportUrl() {
  return `${API_BASE}/api/v1/admin/waitlist/export?_auth=${encodeURIComponent(getAdminToken())}`;
}
