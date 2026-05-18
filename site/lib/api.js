// site/ talks to the gateway through the Vite dev-proxy or the operator-front
// reverse proxy in production. No auth: this layer is public-only.

const API_BASE = import.meta.env.VITE_API_BASE || "";

export async function submitWaitlist(input) {
  const res = await fetch(`${API_BASE}/api/v1/waitlist`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `signup failed: ${res.status}`);
  }
  return res.json();
}

export async function verifyEmail(token) {
  const res = await fetch(
    `${API_BASE}/api/v1/waitlist/verify?token=${encodeURIComponent(token)}`,
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `verify failed: ${res.status}`);
  }
  return res.json();
}
