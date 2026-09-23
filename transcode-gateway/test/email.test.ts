import assert from "node:assert/strict";
import { test } from "node:test";
import { loadConfig } from "../src/config.js";
import { createEmailClient } from "../src/email/client.js";

const required = {
  DATABASE_URL: "postgres://localhost/transcode",
  ADMIN_TOKEN: "a".repeat(16),
  API_KEY_HASH_PEPPER: "p".repeat(16),
};

test("email uses the configured compatible endpoint without following credential redirects", async (t) => {
  const calls: { url: string; init?: RequestInit }[] = [];
  t.mock.method(globalThis, "fetch", async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return Response.json({ id: "test" });
  });
  const config = loadConfig({ ...required, RESEND_API_KEY: "test-secret", RESEND_BASE_URL: "https://mail.example.test/api/" });
  await createEmailClient(config, { info() {}, error() {} }).send({ to: "test@example.test", subject: "Test", html: "Test" });
  assert.equal(calls[0]?.url, "https://mail.example.test/api/emails");
  assert.equal(calls[0]?.init?.redirect, "error");
  assert.equal(new Headers(calls[0]?.init?.headers).get("authorization"), "Bearer test-secret");
});

test("email defaults to Resend and rejects unsafe endpoint shapes", () => {
  assert.equal(loadConfig(required).RESEND_BASE_URL, "https://api.resend.com");
  for (const value of ["ftp://mail.test", "https://user:pass@mail.test", "https://mail.test?key=x", "https://mail.test/#x"]) {
    assert.throws(() => loadConfig({ ...required, RESEND_BASE_URL: value }), /RESEND_BASE_URL/);
  }
});
