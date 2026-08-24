import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { LocTransportError } from "../../src/engine/interfaces/index.js";
import { createLocHttpTransport } from "../../src/livepeer/locHttpTransport.js";

function transport(fetchImpl: typeof fetch, timeoutMs = 1_000) {
  return createLocHttpTransport({
    baseUrl: "https://loc.example.com/",
    apiKey: "loc-top-secret",
    clientId: "transcode/test",
    timeoutMs,
    fetch: fetchImpl,
  });
}

test("LOC transport sends official auth, identity, JSON, and idempotency headers", async () => {
  let captured:
    | { input: Parameters<typeof fetch>[0]; init?: RequestInit }
    | undefined;
  const client = transport(async (input, init) => {
    captured = { input, init };
    return Response.json({ job_id: "job-1" });
  });

  const result = await client.request({
    method: "POST",
    path: "/v1/jobs",
    idempotencyKey: "request-1",
    body: { capability: "video:transcode.abr" },
    schema: z.object({ job_id: z.string() }),
  });

  assert.deepEqual(result, { job_id: "job-1" });
  assert.equal(String(captured?.input), "https://loc.example.com/v1/jobs");
  assert.equal(captured?.init?.method, "POST");
  assert.equal(captured?.init?.redirect, "error");
  assert.deepEqual(captured?.init?.headers, {
    "X-API-Key": "loc-top-secret",
    "Livepeer-Open-Clearinghouse-SDK": "transcode/test",
    "Content-Type": "application/json",
    "Idempotency-Key": "request-1",
  });
  assert.equal(
    captured?.init?.body,
    JSON.stringify({ capability: "video:transcode.abr" }),
  );
});

test("LOC transport requires mutation identity and refuses credential redirects", async () => {
  const client = transport(async () => Response.json({ ok: true }));
  await assert.rejects(
    () =>
      client.request({
        method: "POST",
        path: "/v1/jobs",
        schema: z.object({ ok: z.boolean() }),
      }),
    (error: unknown) =>
      error instanceof LocTransportError && error.code === "loc_request_invalid",
  );
  await assert.rejects(
    () =>
      client.request({
        method: "GET",
        path: "//attacker.example/v1/jobs",
        schema: z.object({ ok: z.boolean() }),
      }),
    (error: unknown) =>
      error instanceof LocTransportError && error.code === "loc_request_invalid",
  );
});

test("LOC transport rejects ambiguous or credential-bearing base URLs", () => {
  for (const baseUrl of [
    "ftp://loc.example.com/",
    "https://user:password@loc.example.com/",
    "https://loc.example.com/prefix/",
    "https://loc.example.com/?credential=secret",
  ]) {
    assert.throws(() =>
      createLocHttpTransport({
        baseUrl,
        apiKey: "loc-top-secret",
        clientId: "transcode/test",
        timeoutMs: 1_000,
      }),
    );
  }
});

test("LOC transport maps official error envelopes without exposing response secrets", async () => {
  const client = transport(async () =>
    Response.json(
      {
        error: {
          code: "IDEMPOTENCY_IN_PROGRESS",
          message: "payment_envelope=do-not-expose",
          details: { payment_envelope: "do-not-expose" },
        },
      },
      { status: 409, headers: { "Retry-After": "7" } },
    ),
  );

  await assert.rejects(
    () =>
      client.request({
        method: "POST",
        path: "/v1/jobs",
        idempotencyKey: "request-1",
        body: {},
        schema: z.object({}),
      }),
    (error: unknown) => {
      assert.ok(error instanceof LocTransportError);
      assert.equal(error.code, "loc_http_error");
      assert.equal(error.status, 409);
      assert.equal(error.remoteCode, "IDEMPOTENCY_IN_PROGRESS");
      assert.equal(error.retryable, true);
      assert.equal(error.retryAfterSeconds, 7);
      assert.doesNotMatch(error.message, /do-not-expose|payment_envelope/);
      return true;
    },
  );
});

test("LOC transport fails closed on malformed success payloads", async () => {
  const client = transport(async () => Response.json({ unexpected: true }));
  await assert.rejects(
    () =>
      client.request({
        method: "GET",
        path: "/v1/jobs/job-1",
        schema: z.object({ job_id: z.string() }),
      }),
    (error: unknown) =>
      error instanceof LocTransportError &&
      error.code === "loc_response_invalid" &&
      error.retryable === false,
  );
});

test("LOC transport distinguishes timeout from network failure", async () => {
  const timeoutClient = transport(
    async (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      }),
    5,
  );
  await assert.rejects(
    () =>
      timeoutClient.request({
        method: "GET",
        path: "/v1/jobs/job-1",
        schema: z.object({}),
      }),
    (error: unknown) =>
      error instanceof LocTransportError &&
      error.code === "loc_timeout" &&
      error.retryable,
  );

  const unavailableClient = transport(async () => {
    throw new Error("network includes loc-top-secret");
  });
  await assert.rejects(
    () =>
      unavailableClient.request({
        method: "GET",
        path: "/v1/jobs/job-1",
        schema: z.object({}),
      }),
    (error: unknown) => {
      assert.ok(error instanceof LocTransportError);
      assert.equal(error.code, "loc_unavailable");
      assert.doesNotMatch(error.message, /loc-top-secret|network includes/);
      return true;
    },
  );
});
