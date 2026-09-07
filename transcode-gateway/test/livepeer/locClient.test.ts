import assert from "node:assert/strict";
import { test } from "node:test";
import type { LocRequest, LocTransport } from "../../src/engine/interfaces/index.js";
import { LocTransportError } from "../../src/engine/interfaces/index.js";
import type { SelectedWorkerRoute } from "../../src/engine/types/index.js";
import { createLocClient, routeBindingFor } from "../../src/livepeer/locClient.js";

const JOB_ID = "b728b1a9-1ad8-4598-9382-92fca5d3bdf8";
const SESSION_ID = "ae67b8f5-e381-4f01-9302-1957f26d82f2";
const binding = {
  quoteId: "quote-1",
  quoteVersion: "18446744073709551615",
  constraintFingerprint: "11".repeat(32),
  routeFingerprint: "22".repeat(32),
};

function snapshot(protocol: "paid-job/v1" | "paid-session/v1") {
  const session = {
    descriptor_schema: "rtmp-hls/v1",
    attachment: "external",
    metering: "runner-reported",
    refill: "extensible",
    max_rotations: 3,
    heartbeat: { interval_seconds: 10, missed_threshold: 3 },
    lease: { policy: "funding-tracking" },
  };
  return {
    schema_version: "route-snapshot/v1",
    broker_url: "https://broker.example/livepeer",
    eth_address: `0x${"33".repeat(20)}`,
    capability: protocol === "paid-job/v1" ? "video:transcode.abr" : "video:transcode.live",
    offering: "default",
    protocol,
    work_unit: protocol === "paid-job/v1" ? "frame_megapixel" : "output_second",
    price_per_work_unit_wei: "1000000000000000000",
    units_per_price: "18446744073709551615",
    quote_id: binding.quoteId,
    quote_version: binding.quoteVersion,
    constraint_fingerprint: binding.constraintFingerprint,
    route_fingerprint: binding.routeFingerprint,
    settlement_keys: [
      {
        public_key: `0x04${"44".repeat(64)}`,
        not_before: "2026-08-24T00:00:00Z",
        expires_at: "2026-08-25T00:00:00Z",
        introduced_in_publication_seq: "18446744073709551615",
      },
    ],
    work_unit_estimator: {
      id: "transcode-frame-megapixel/v1",
      rounding: "ceil-total",
      exactness: "ceiling",
      fixtures: "transcode/v1",
    },
    job: protocol === "paid-job/v1" ? { transports: ["unary"] } : null,
    session: protocol === "paid-session/v1" ? session : null,
    extra: protocol === "paid-job/v1" ? { job: { transports: ["unary"] } } : { session },
  };
}

function jobResponse() {
  return {
    job_id: JOB_ID,
    request_id: "broker-request-1",
    work_id: "work-1",
    broker_url: "https://broker.example/livepeer",
    protocol: "paid-job/v1",
    transport: "unary",
    work_unit: "frame_megapixel",
    route_snapshot: snapshot("paid-job/v1"),
    payment_envelope: "payment-envelope",
    expected_value_wei: 1,
    funded_value_wei: 1,
    settle_endpoint: `/v1/jobs/${JOB_ID}/settle`,
    opened_at: "2026-08-24T00:00:00Z",
  };
}

function fakeTransport(response: unknown) {
  const requests: LocRequest<unknown>[] = [];
  const transport: LocTransport = {
    async request<T>(request: LocRequest<T>): Promise<T> {
      requests.push(request as LocRequest<unknown>);
      return request.schema.parse(response);
    },
  };
  return { transport, requests };
}

test("route binding preserves resolver uint64 identity without JavaScript number conversion", () => {
  const route = {
    workerUrl: "https://broker.example/livepeer",
    ethAddress: `0x${"33".repeat(20)}`,
    capability: "video:transcode.abr",
    offering: "default",
    pricePerWorkUnitWei: "1",
    workUnit: "frame_megapixel",
    protocol: "paid-job/v1",
    job: { transports: ["unary"] },
    session: null,
    workUnitEstimator: null,
    settlementKeys: [],
    quoteId: binding.quoteId,
    quoteVersion: binding.quoteVersion,
    constraintFingerprint: Buffer.from(binding.constraintFingerprint, "hex"),
    routeFingerprint: Buffer.from(binding.routeFingerprint, "hex"),
  } satisfies SelectedWorkerRoute;
  assert.deepEqual(routeBindingFor(route), binding);
});

test("LOC client opens and replays an exact bound paid job", async () => {
  const { transport, requests } = fakeTransport(jobResponse());
  const client = createLocClient(transport);
  const input = {
    requestId: "request-1",
    capability: "video:transcode.abr",
    offering: "default",
    transport: "unary" as const,
    estimatedUnits: 100,
    maxTotalUnits: 200,
    routeBinding: binding,
  };
  const first = await client.openJob(input);
  const replay = await client.openJob(input);

  assert.deepEqual(replay, first);
  assert.equal(first.routeSnapshot.schemaVersion, "route-snapshot/v1");
  assert.equal(first.requestId, "broker-request-1");
  assert.equal(first.routeSnapshot.unitsPerPrice, "18446744073709551615");
  assert.equal(
    first.routeSnapshot.settlementKeys[0]?.introducedInPublicationSeq,
    "18446744073709551615",
  );
  assert.equal(requests.length, 2);
  assert.equal(requests[0]?.idempotencyKey, "request-1");
  assert.deepEqual(requests[1]?.body, requests[0]?.body);
  assert.deepEqual(requests[0]?.body, {
    capability: "video:transcode.abr",
    offering: "default",
    transport: "unary",
    estimated_units: 100,
    max_total_units: 200,
    route_binding: {
      quote_id: binding.quoteId,
      quote_version: binding.quoteVersion,
      constraint_fingerprint: binding.constraintFingerprint,
      route_fingerprint: binding.routeFingerprint,
    },
  });
});

test("LOC client fails closed when the recorded route differs from the binding", async () => {
  const response = jobResponse();
  response.route_snapshot.route_fingerprint = "ff".repeat(32);
  const client = createLocClient(fakeTransport(response).transport);

  await assert.rejects(
    () =>
      client.openJob({
        requestId: "request-1",
        capability: "video:transcode.abr",
        offering: "default",
        transport: "unary",
        estimatedUnits: 1,
        routeBinding: binding,
      }),
    (error: unknown) =>
      error instanceof LocTransportError && error.code === "loc_response_invalid",
  );
});

test("LOC client opens a bound paid session and preserves its declared axes", async () => {
  const route = snapshot("paid-session/v1");
  const response = {
    session_id: SESSION_ID,
    request_id: "session-request-1",
    work_id: "session-work-1",
    broker_url: route.broker_url,
    protocol: "paid-session/v1",
    session: route.session,
    route_snapshot: route,
    payment_envelope: "session-envelope",
    expected_value_wei: 1,
    funded_value_wei: 1,
    refill_endpoint: `/v1/sessions/${SESSION_ID}/refill`,
    close_endpoint: `/v1/sessions/${SESSION_ID}/close`,
    opened_at: "2026-08-24T00:00:00Z",
  };
  const { transport, requests } = fakeTransport(response);
  const client = createLocClient(transport);
  const opened = await client.openSession({
    requestId: "session-request-1",
    capability: "video:transcode.live",
    offering: "default",
    descriptorSchema: "rtmp-hls/v1",
    sessionParams: { ingest: "gateway-relay" },
    estimatedRunwayUnits: 60,
    maxTotalUnits: 3_600,
    routeBinding: binding,
  });

  assert.equal(opened.protocol, "paid-session/v1");
  assert.equal(opened.session.descriptorSchema, "rtmp-hls/v1");
  assert.equal(opened.routeSnapshot.session?.maxRotations, 3);
  assert.deepEqual(requests[0]?.body, {
    capability: "video:transcode.live",
    offering: "default",
    descriptor_schema: "rtmp-hls/v1",
    session_params: { ingest: "gateway-relay" },
    estimated_runway_units: 60,
    max_total_units: 3_600,
    route_binding: {
      quote_id: binding.quoteId,
      quote_version: binding.quoteVersion,
      constraint_fingerprint: binding.constraintFingerprint,
      route_fingerprint: binding.routeFingerprint,
    },
  });
});

test("LOC client submits the decoded broker settlement to the recorded job endpoint", async () => {
  const settlement = {
    payload: { request_id: "request-1", actual_units: "12" },
    signature: {
      algorithm: "secp256k1" as const,
      canonicalization: "jcs" as const,
      value: `0x${"44".repeat(65)}`,
    },
  };
  const { transport, requests } = fakeTransport({
    job_id: JOB_ID,
    work_id: "work-1",
    actual_units: 12,
    billed_value_wei: 10,
    refund_wei: 2,
    outcome: "OVERFUNDED",
    closed_at: "2026-08-24T00:01:00Z",
    cap_status: {
      session_pct_used: 0.5,
      spend_period_pct_used: null,
      user_balance_pct_used: null,
      operator_pool_pct_used: null,
      will_refuse_next_refill: false,
      winddown_reason: null,
    },
  });
  const result = await createLocClient(transport).settleJob({
    operationId: JOB_ID,
    actualUnits: 12,
    brokerJobId: "broker-job-1",
    workUnit: "frame_megapixel",
    outcome: "OVERFUNDED",
    settlement,
  });

  assert.equal(result.refundWei, 2);
  assert.equal(requests[0]?.path, `/v1/jobs/${JOB_ID}/settle`);
  assert.equal(requests[0]?.idempotencyKey, `settle:${JOB_ID}`);
  assert.deepEqual(requests[0]?.body, {
    actual_units: 12,
    broker_job_id: "broker-job-1",
    work_unit: "frame_megapixel",
    outcome: "OVERFUNDED",
    settlement,
  });
});

test("LOC session refill preserves its idempotency and recipient rebind identities", async () => {
  const { transport, requests } = fakeTransport({
    work_id: "work-2",
    request_id: "broker-refill-request-1",
    refill_seq: 2,
    payment_envelope: "refill-envelope",
    expected_value_wei: 10,
    funded_value_wei: 20,
    cap_status: {
      session_pct_used: 0.5,
      spend_period_pct_used: null,
      user_balance_pct_used: null,
      operator_pool_pct_used: null,
      will_refuse_next_refill: false,
      winddown_reason: null,
    },
    rebind_from: "work-1",
  });
  const result = await createLocClient(transport).refillSession({
    operationId: SESSION_ID,
    requestId: "gateway-refill-1",
    observedConsumedUnits: 12,
    rebindFrom: "work-1",
    replacesRequestId: "broker-refill-old",
  });

  assert.equal(result.workId, "work-2");
  assert.equal(requests[0]?.idempotencyKey, "gateway-refill-1");
  assert.deepEqual(requests[0]?.body, {
    observed_consumed_units: 12,
    rebind_from: "work-1",
    replaces_request_id: "broker-refill-old",
  });
});
