import assert from "node:assert/strict";
import { test } from "node:test";
import {
  classifyV2Failure,
  v2CorrelationContext,
} from "../../src/livepeer/v2Outcome.js";

test("every normative v2 outcome has a stable category and retry policy", () => {
  const expected = {
    protocol_transport_unsupported: ["protocol", false],
    job_in_flight: ["recovery", true],
    request_id_reuse: ["caller", false],
    accounting_pending: ["recovery", true],
    recipient_rotated: ["payment", true],
    rebind_refused: ["payment", false],
    insufficient_balance: ["payment", false],
    DEBIT_FAILED: ["payment", false],
    ADMITTED_EVIDENCE_EXPIRED: ["evidence", false],
  } as const;
  for (const [code, [category, retryable]] of Object.entries(expected)) {
    const classified = classifyV2Failure(code);
    assert.equal(classified.category, category, code);
    assert.equal(classified.retryable, retryable, code);
  }
});

test("unknown capacity and backend HTTP failures penalize routes", () => {
  assert.deepEqual(classifyV2Failure("", 429), {
    code: "rate_limited",
    category: "capacity",
    retryable: true,
    penalizeRoute: true,
  });
  assert.equal(classifyV2Failure("internal_error", 503).category, "backend");
  assert.equal(classifyV2Failure("internal_error", 503).penalizeRoute, true);
});

test("correlation log context is an identifier allowlist with no secret fields", () => {
  const context = v2CorrelationContext({
    requestId: "request-1",
    locOperationId: "loc-1",
    workId: "work-1",
    brokerJobId: "job-1",
    brokerSessionId: "session-1",
    gatewaySessionId: "gateway-session-1",
  });
  assert.deepEqual(Object.keys(context).sort(), [
    "broker_job_id",
    "broker_session_id",
    "gateway_session_id",
    "loc_operation_id",
    "request_id",
    "work_id",
  ]);
  assert.equal(JSON.stringify(context).includes("payment"), false);
  assert.equal(JSON.stringify(context).includes("credential"), false);
});
