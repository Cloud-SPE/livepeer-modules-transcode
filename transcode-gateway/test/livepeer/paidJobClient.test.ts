import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  LocClient,
  LocOpenJobResult,
  LocSettleJobInput,
  PaidJobRequest,
} from "../../src/engine/interfaces/index.js";
import { PaidJobClientError } from "../../src/engine/interfaces/index.js";
import type { SelectedWorkerRoute } from "../../src/engine/types/index.js";
import { HEADER } from "../../src/livepeer/headers.js";
import { createPaidJobClient } from "../../src/livepeer/paidJobClient.js";

const binding = {
  quoteId: "quote-1",
  quoteVersion: "7",
  constraintFingerprint: "11".repeat(32),
  routeFingerprint: "22".repeat(32),
};
const route = {
  workerUrl: "https://broker.example",
  ethAddress: `0x${"33".repeat(20)}`,
  capability: "video:transcode.abr",
  offering: "default",
  pricePerWorkUnitWei: "1",
  unitsPerPrice: "1",
  workUnit: "frame_megapixel",
  protocol: "paid-job/v1",
  job: { transports: ["unary", "stream"] },
  session: null,
  workUnitEstimator: null,
  settlementKeys: [],
  quoteId: binding.quoteId,
  quoteVersion: binding.quoteVersion,
  constraintFingerprint: Buffer.from(binding.constraintFingerprint, "hex"),
  routeFingerprint: Buffer.from(binding.routeFingerprint, "hex"),
} satisfies SelectedWorkerRoute;
const opened: LocOpenJobResult = {
  operationId: "b728b1a9-1ad8-4598-9382-92fca5d3bdf8",
  requestId: "request-1",
  workId: "work-1",
  brokerUrl: route.workerUrl,
  protocol: "paid-job/v1",
  transport: "unary",
  workUnit: route.workUnit,
  routeSnapshot: {
    schemaVersion: "route-snapshot/v1",
    brokerUrl: route.workerUrl,
    ethAddress: route.ethAddress,
    capability: route.capability,
    offering: route.offering,
    protocol: "paid-job/v1",
    workUnit: route.workUnit,
    pricePerWorkUnitWei: "1",
    unitsPerPrice: "1",
    binding,
    settlementKeys: [],
    workUnitEstimator: null,
    job: route.job,
    session: null,
    extra: {},
    raw: {},
  },
  paymentEnvelope: "payment-1",
  settleEndpoint: "/v1/jobs/b728b1a9-1ad8-4598-9382-92fca5d3bdf8/settle",
  openedAt: "2026-08-24T00:00:00Z",
};

function envelope(overrides: Record<string, unknown> = {}) {
  return {
    payload: {
      accepted_quote_ref: {
        quote_id: binding.quoteId,
        quote_version: binding.quoteVersion,
        constraint_fingerprint: Buffer.from(binding.constraintFingerprint, "hex").toString("base64"),
        route_fingerprint: Buffer.from(binding.routeFingerprint, "hex").toString("base64"),
      },
      work_unit_name: route.workUnit,
      actual_units: "12",
      billed_units: "12",
      debited_units: "12",
      outcome: "EXACT",
      work_id: opened.workId,
      job_id: "broker-job-1",
      request_id: opened.requestId,
      ...overrides,
    },
    signature: {
      algorithm: "secp256k1" as const,
      canonicalization: "jcs" as const,
      value: `0x${"44".repeat(65)}`,
    },
  };
}

function encodedSettlement(overrides: Record<string, unknown> = {}): string {
  return Buffer.from(JSON.stringify(envelope(overrides))).toString("base64");
}

function fakeLoc() {
  const opens: unknown[] = [];
  const settlements: LocSettleJobInput[] = [];
  const loc: LocClient = {
    async openJob(input) {
      opens.push(input);
      return { ...opened, transport: input.transport };
    },
    async settleJob(input) {
      settlements.push(input);
      return {
        operationId: input.operationId,
        workId: opened.workId,
        actualUnits: input.actualUnits,
        billedValueWei: 12,
        refundWei: 0,
        outcome: input.outcome,
        closedAt: "2026-08-24T00:01:00Z",
      };
    },
    async openSession() {
      throw new Error("unused");
    },
  };
  return { loc, opens, settlements };
}

function request(transport: "unary" | "stream" = "unary"): PaidJobRequest {
  return {
    requestId: opened.requestId,
    route,
    transport,
    estimatedUnits: 12,
    maxTotalUnits: 20,
    contentType: "application/json",
    body: Buffer.from('{"input":"asset-1"}'),
  };
}

test("paid-job unary execution uses the v2 wire and forwards verified settlement to LOC", async () => {
  const { loc, settlements } = fakeLoc();
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const client = createPaidJobClient(loc, {
    fetch: async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response('{"output":"ok"}', {
        status: 200,
        headers: {
          "content-type": "application/json",
          [HEADER.JOB_ID]: "broker-job-1",
          [HEADER.WORK_UNITS]: "12",
          [HEADER.WORK_UNIT]: route.workUnit,
          [HEADER.SETTLEMENT]: encodedSettlement(),
        },
      });
    },
  });

  const result = await client.execute(request());
  assert.equal(result.kind, "settled");
  assert.equal(calls[0]?.url, "https://broker.example/v1/job");
  const headers = new Headers(calls[0]?.init?.headers);
  assert.equal(headers.get(HEADER.PROTOCOL), "paid-job/v1");
  assert.equal(headers.get(HEADER.REQUEST_ID), opened.requestId);
  assert.equal(headers.get(HEADER.PAYMENT), opened.paymentEnvelope);
  assert.equal(Buffer.from(calls[0]?.init?.body as Uint8Array).toString(), '{"input":"asset-1"}');
  assert.equal(settlements[0]?.brokerJobId, "broker-job-1");
  assert.equal(settlements[0]?.actualUnits, 12);
});

test("stream execution selects SSE and retrieves a terminal trailer claim by job id", async () => {
  const { loc } = fakeLoc();
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const client = createPaidJobClient(loc, {
    fetch: async (url, init) => {
      calls.push({ url: String(url), init });
      if (String(url).includes("/v1/settlement/")) {
        return Response.json({
          job_id: "broker-job-1",
          state: "terminal",
          work_units: 12,
          unit: route.workUnit,
          settlement: encodedSettlement(),
        });
      }
      return new Response("data: done\n\n", {
        headers: { [HEADER.JOB_ID]: "broker-job-1", "content-type": "text/event-stream" },
      });
    },
  });

  const result = await client.execute(request("stream"));
  assert.equal(result.kind, "settled");
  assert.equal(new Headers(calls[0]?.init?.headers).get("accept"), "text/event-stream");
  assert.equal(calls[1]?.url, "https://broker.example/v1/settlement/broker-job-1");
});

test("exact retries preserve request id and body while changed-body reuse remains a typed refusal", async () => {
  const { loc } = fakeLoc();
  const bodies: string[] = [];
  const client = createPaidJobClient(loc, {
    fetch: async (_url, init) => {
      const body = Buffer.from(init?.body as Uint8Array).toString();
      bodies.push(body);
      if (bodies.length === 3) {
        return Response.json({ error: { code: "request_id_reuse" } }, { status: 409 });
      }
      return new Response("ok", {
        headers: {
          [HEADER.JOB_ID]: "broker-job-1",
          [HEADER.WORK_UNITS]: "12",
          [HEADER.WORK_UNIT]: route.workUnit,
          [HEADER.SETTLEMENT]: encodedSettlement(),
        },
      });
    },
  });

  await client.execute(request());
  await client.execute(request());
  assert.equal(bodies[0], bodies[1]);
  const changed = request();
  changed.body = Buffer.from('{"input":"different"}');
  await assert.rejects(
    () => client.execute(changed),
    (error: unknown) =>
      error instanceof PaidJobClientError && error.code === "request_id_reuse" && !error.retryable,
  );
});

test("recovery models every non-settled broker exchange outcome", async () => {
  const cases = [
    ["IN_FLIGHT", "in_flight", { job_id: "broker-job-1" }],
    ["NOT_ADMITTED", "not_admitted", { non_admission: "evidence" }],
    ["NO_RECORD", "no_record", {}],
    ["ADMITTED_OUTCOME_UNKNOWN", "admitted_outcome_unknown", { job_id: "broker-job-1" }],
    ["ADMITTED_EVIDENCE_EXPIRED", "admitted_evidence_expired", { job_id: "broker-job-1" }],
  ] as const;
  for (const [outcome, kind, extra] of cases) {
    const client = createPaidJobClient(fakeLoc().loc, {
      fetch: async () => Response.json({ request_id: opened.requestId, outcome, ...extra }),
    });
    assert.equal((await client.recover(opened)).kind, kind);
  }
});

test("accounting pending is bounded and DEBIT_FAILED or identity drift fails closed", async () => {
  const pending = createPaidJobClient(fakeLoc().loc, {
    accountingPollAttempts: 2,
    accountingPollDelayMs: 0,
    fetch: async (url) =>
      String(url).includes("/exchange/")
        ? Response.json({
            request_id: opened.requestId,
            job_id: "broker-job-1",
            outcome: "ACCOUNTING_PENDING",
          }, { status: 202 })
        : Response.json({ job_id: "broker-job-1", state: "accounting_pending" }, { status: 202 }),
  });
  assert.equal((await pending.recover(opened)).kind, "accounting_pending");

  for (const overrides of [{ outcome: "DEBIT_FAILED" }, { request_id: "different" }]) {
    const client = createPaidJobClient(fakeLoc().loc, {
      fetch: async () => Response.json({
        request_id: opened.requestId,
        job_id: "broker-job-1",
        outcome: "SETTLED",
        work_units: 12,
        unit: route.workUnit,
        settlement: encodedSettlement(overrides),
      }),
    });
    await assert.rejects(
      () => client.recover(opened),
      (error: unknown) =>
        error instanceof PaidJobClientError &&
        (error.code === "paid_job_debit_failed" || error.code === "paid_job_settlement_identity_mismatch"),
    );
  }
});
