import { test } from "node:test";
import assert from "node:assert/strict";
import type { PaidOperation } from "../../src/engine/types/index.js";
import { adminOperationStatus, customerOperationStatus } from "../../src/routes/paidOperationStatus.js";

function operation(overrides: Partial<PaidOperation> = {}): PaidOperation {
  return {
    id: "operation-1",
    kind: "session",
    apiKeyId: "api-key-1",
    liveStreamId: "live-1",
    requestId: "request-1",
    requestContentSha256: "content-sha",
    workId: "work-1",
    rotationGeneration: 1,
    route: {
      protocol: "paid-session/v1",
      capability: "video:live.rtmp",
      offering: "live-standard",
      requestDescriptor: "rtmp-hls/v1",
      workUnit: "output_seconds",
      pricePerUnitWei: "10",
      unitsPerPrice: "1",
      quoteId: "quote-1",
      quoteVersion: "7",
      constraintFingerprint: "constraints",
      routeFingerprint: "route",
      settlementKey: "must-not-leak",
      raw: { broker_url: "must-not-leak" },
    },
    status: "winddown_retry",
    locOperationId: "loc-1",
    brokerSessionId: "broker-session-1",
    fundedUnits: "60",
    claimedUnits: "55",
    balanceUnits: "0",
    willRefuseNextRefill: true,
    leaseExpiresAt: new Date("2026-08-26T11:00:00Z"),
    settlementSequence: "2",
    lifecycleVersion: "4",
    sessionRuntime: {
      publisherMode: "gateway-relay",
      relayStatus: "stopping",
      relayGeneration: 1,
      lastRunnerSequence: "9",
      lastRunnerUsage: "55",
      winddownReason: "customer_end",
    },
    retryCount: 2,
    nextRetryAt: new Date("2026-08-26T12:01:00Z"),
    lastErrorCode: "accounting_pending",
    createdAt: new Date("2026-08-26T10:00:00Z"),
    updatedAt: new Date("2026-08-26T12:00:00Z"),
    ...overrides,
  };
}

test("customer status exposes durable progress and warnings without route or credential material", () => {
  const status = customerOperationStatus(operation(), new Date("2026-08-26T12:00:00Z"));
  assert.deepEqual(status?.warnings, ["refill_will_be_refused", "funded_balance_exhausted", "lease_expired"]);
  assert.equal(status?.state, "winddown_retry");
  assert.equal(status?.recovered, true);
  assert.equal(status?.winddown_reason, "customer_end");
  const wire = JSON.stringify(status);
  assert.doesNotMatch(wire, /must-not-leak|settlementKey|broker_url|recoveryOwner/);
});

test("admin status adds safe correlation IDs but no signed route metadata", () => {
  const status = adminOperationStatus(operation(), new Date("2026-08-26T12:00:00Z"));
  assert.equal(status.loc_operation_id, "loc-1");
  assert.equal(status.broker_session_id, "broker-session-1");
  assert.equal(status.route_fingerprint, "route");
  assert.doesNotMatch(JSON.stringify(status), /must-not-leak|settlementKey|broker_url|recoveryOwner/);
});

test("missing operation is represented explicitly", () => {
  assert.equal(customerOperationStatus(null), null);
});
