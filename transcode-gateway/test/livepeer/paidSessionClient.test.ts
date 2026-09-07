import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  LocClient,
  LocCloseSessionInput,
  LocOpenSessionInput,
  LocOpenSessionResult,
  LocRefillSessionInput,
} from "../../src/engine/interfaces/index.js";
import { LocTransportError, PaidSessionClientError } from "../../src/engine/interfaces/index.js";
import type { SelectedWorkerRoute } from "../../src/engine/types/index.js";
import { HEADER } from "../../src/livepeer/headers.js";
import {
  createPaidSessionClient,
  parsePaidSessionControlEvent,
} from "../../src/livepeer/paidSessionClient.js";

const operationId = "ae67b8f5-e381-4f01-9302-1957f26d82f2";
const gatewaySessionId = "live-operation-1";
const brokerSessionId = "broker-session-1";
const route = {
  workerUrl: "https://broker.example",
  ethAddress: `0x${"33".repeat(20)}`,
  capability: "video:transcode.live",
  offering: "default",
  pricePerWorkUnitWei: "1",
  unitsPerPrice: "1",
  workUnit: "output_seconds",
  protocol: "paid-session/v1",
  job: null,
  session: {
    descriptorSchema: "rtmp-hls/v1",
    attachment: "external",
    metering: "runner-reported",
    refill: "extensible",
    maxRotations: 3,
    heartbeat: { intervalSeconds: 10, missedThreshold: 3 },
    lease: { policy: "funding-tracking" },
  },
  workUnitEstimator: null,
  settlementKeys: [],
  quoteId: "quote-1",
  quoteVersion: "1",
  constraintFingerprint: Buffer.from("11".repeat(32), "hex"),
  routeFingerprint: Buffer.from("22".repeat(32), "hex"),
} satisfies SelectedWorkerRoute;
const opened: LocOpenSessionResult = {
  operationId,
  requestId: "broker-open-request-1",
  workId: "work-1",
  brokerUrl: route.workerUrl,
  protocol: "paid-session/v1",
  session: route.session,
  routeSnapshot: {
    schemaVersion: "route-snapshot/v1",
    brokerUrl: route.workerUrl,
    ethAddress: route.ethAddress,
    capability: route.capability,
    offering: route.offering,
    protocol: "paid-session/v1",
    workUnit: route.workUnit,
    pricePerWorkUnitWei: "1",
    unitsPerPrice: "1",
    binding: {
      quoteId: route.quoteId,
      quoteVersion: route.quoteVersion,
      constraintFingerprint: "11".repeat(32),
      routeFingerprint: "22".repeat(32),
    },
    settlementKeys: [],
    workUnitEstimator: null,
    job: null,
    session: route.session,
    extra: {},
    raw: {},
  },
  paymentEnvelope: "open-payment",
  refillEndpoint: `/v1/sessions/${operationId}/refill`,
  closeEndpoint: `/v1/sessions/${operationId}/close`,
  openedAt: "2026-08-24T00:00:00Z",
};
const balance = {
  claimed_units: 12,
  debited_units: 12,
  unit: route.workUnit,
  runway_units: 48,
  runway_seconds_estimate: 48,
  status: "ok",
  will_refuse_next_refill: false,
};
const control = {
  status_url: `https://broker.example/v1/session/${brokerSessionId}`,
  topup_url: `https://broker.example/v1/session/${brokerSessionId}/topup`,
  end_url: `https://broker.example/v1/session/${brokerSessionId}/end`,
  events_ws: `wss://broker.example/v1/session/${brokerSessionId}/ws`,
};

function signedSettlement(overrides: Record<string, unknown> = {}) {
  return {
    payload: {
      work_unit_name: route.workUnit,
      actual_units: "12",
      billed_units: "12",
      claimed_units: "12",
      debited_units: "12",
      outcome: "EXACT",
      session_id: brokerSessionId,
      gateway_session_id: gatewaySessionId,
      work_id: "work-1",
      predecessor_work_id: "",
      rotation_generation: 0,
      settlement_seq: "1",
      state: "closed",
      ...overrides,
    },
    signature: {
      algorithm: "secp256k1" as const,
      canonicalization: "jcs" as const,
      value: `0x${"44".repeat(65)}`,
    },
  };
}

function encodedSettlement(overrides: Record<string, unknown> = {}) {
  return Buffer.from(JSON.stringify(signedSettlement(overrides))).toString("base64");
}

function fakeLoc() {
  const opens: LocOpenSessionInput[] = [];
  const refills: LocRefillSessionInput[] = [];
  const closes: LocCloseSessionInput[] = [];
  const loc: LocClient = {
    async openSession(input) {
      opens.push(input);
      return opened;
    },
    async refillSession(input) {
      refills.push(input);
      return {
        workId: input.rebindFrom ? "work-2" : "work-1",
        requestId: "broker-refill-request-1",
        refillSequence: 1,
        paymentEnvelope: "refill-payment",
        fundedValueWei: 100,
        capStatus: {
          sessionPctUsed: 0.5,
          spendPeriodPctUsed: null,
          userBalancePctUsed: null,
          operatorPoolPctUsed: null,
          willRefuseNextRefill: false,
          winddownReason: null,
        },
        rebindFrom: input.rebindFrom ?? null,
      };
    },
    async getSession() {
      throw new Error("unused");
    },
    async closeSession(input) {
      closes.push(input);
      return {
        operationId,
        workId: "work-1",
        actualUnits: input.actualUnits,
        billedValueWei: 12,
        refundWei: 88,
        outcome: input.outcome,
        closedAt: "2026-08-24T00:10:00Z",
      };
    },
    async openJob() { throw new Error("unused"); },
    async settleJob() { throw new Error("unused"); },
  };
  return { loc, opens, refills, closes };
}

function openResponse() {
  return {
    session_id: brokerSessionId,
    work_id: "work-1",
    state: "active",
    runtime: {
      schema: "rtmp-hls/v1",
      public: {
        rtmp_url: "rtmp://runner.example/live",
        hls_url: "https://runner.example/live/index.m3u8",
        key_issue_url: "https://runner.example/keys",
      },
      grants: [{
        id: "grant-1",
        operations: ["stream-key-issue"],
        secret: "grant-secret",
        expires_at: "2026-08-25T00:00:00Z",
        max_uses: 1,
      }],
    },
    lease: { expires_at: "2026-08-24T00:05:00Z" },
    control,
    credential: "session-credential",
    balance,
  };
}

test("paid session open replays identical LOC and broker content while returning create-only secrets", async () => {
  const { loc, opens } = fakeLoc();
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const client = createPaidSessionClient(loc, {
    fetch: async (url, init) => {
      calls.push({ url: String(url), init });
      return Response.json(openResponse(), { status: 201 });
    },
  });
  const input = {
    gatewaySessionId,
    requestId: "gateway-open-1",
    route,
    descriptorSchema: "rtmp-hls/v1",
    sessionParams: { publisher_mode: "gateway-relay" },
    estimatedRunwayUnits: 60,
    maxTotalUnits: 3_600,
  } as const;

  const first = await client.open(input);
  const replay = await client.open(input);
  assert.equal(first.credential, "session-credential");
  assert.equal(first.grants[0]?.secret, "grant-secret");
  assert.deepEqual(opens[0], opens[1]);
  assert.equal(calls[0]?.url, "https://broker.example/v1/session");
  assert.equal(calls[0]?.init?.body, calls[1]?.init?.body);
  const headers = new Headers(calls[0]?.init?.headers);
  assert.equal(headers.get(HEADER.PROTOCOL), "paid-session/v1");
  assert.equal(headers.get(HEADER.REQUEST_ID), opened.requestId);
  assert.equal(headers.get(HEADER.PAYMENT), opened.paymentEnvelope);
});

test("stream-key issuance consumes only its scoped grant and replays byte-identically", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const client = createPaidSessionClient(fakeLoc().loc, {
    fetch: async (url, init) => {
      calls.push({ url: String(url), init });
      return Response.json({
        request_id: "key-request-1",
        stream_key: "private-runner-key",
        expires_at: "2026-08-25T00:00:00Z",
      }, { status: 201 });
    },
  });
  const input = {
    keyIssueUrl: "https://runner.example/v1/sessions/runner-1/stream-keys",
    grant: {
      id: "grant-1",
      operations: ["stream-key-issue"],
      secret: "grant-secret",
      expiresAt: "2026-08-25T00:00:00Z",
      maxUses: 1,
    },
    requestId: "key-request-1",
    audience: "gateway-relay" as const,
  };

  const first = await client.issueStreamKey(input);
  const replay = await client.issueStreamKey(input);
  assert.equal(first.streamKey, "private-runner-key");
  assert.deepEqual(replay, first);
  assert.equal(calls[0]?.init?.body, calls[1]?.init?.body);
  assert.equal(new Headers(calls[0]?.init?.headers).get("authorization"), "Bearer grant-secret");
  assert.equal(calls[0]?.init?.body, JSON.stringify({ request_id: "key-request-1", audience: "gateway-relay" }));
});

test("stream-key issuance rejects malformed or unscoped grant evidence", async () => {
  let fetched = false;
  const client = createPaidSessionClient(fakeLoc().loc, {
    fetch: async () => {
      fetched = true;
      return Response.json({});
    },
  });
  await assert.rejects(
    () => client.issueStreamKey({
      keyIssueUrl: "https://runner.example/keys",
      grant: { id: "grant-1", operations: ["status"], secret: "secret", expiresAt: "2026-08-25T00:00:00Z" },
      requestId: "key-request-1",
      audience: "gateway-relay",
    }),
    (error: unknown) => error instanceof PaidSessionClientError && error.code === "paid_session_request_invalid",
  );
  assert.equal(fetched, false);
});

test("status is authoritative and never has a credential or grant field", async () => {
  const client = createPaidSessionClient(fakeLoc().loc, {
    fetch: async () => Response.json({
      session_id: brokerSessionId,
      gateway_session_id: gatewaySessionId,
      work_id: "work-1",
      state: "active",
      runtime: { schema: "rtmp-hls/v1", public: { hls_url: "https://runner.example/live/index.m3u8" } },
      usage: { unit: route.workUnit, claimed_total: 12 },
      lease: { expires_at: "2026-08-24T00:05:00Z" },
      balance,
      started_at: "2026-08-24T00:00:00Z",
    }),
  });
  const result = await client.status({ opened, brokerSessionId, workId: "work-1", credential: "session-credential" });
  assert.equal(result.gatewaySessionId, gatewaySessionId);
  assert.equal(result.claimedUnits, 12);
  assert.equal("credential" in result, false);
  assert.equal("grants" in result, false);
});

test("refill keeps its durable request identity and atomically forwards recipient rebind", async () => {
  const { loc, refills } = fakeLoc();
  const calls: RequestInit[] = [];
  const client = createPaidSessionClient(loc, {
    fetch: async (_url, init) => {
      calls.push(init ?? {});
      return Response.json({
        session_id: brokerSessionId,
        work_id: "work-2",
        lease: { expires_at: "2026-08-24T00:10:00Z" },
        balance,
      });
    },
  });
  const input = {
    opened,
    brokerSessionId,
    credential: "session-credential",
    requestId: "gateway-refill-1",
    observedConsumedUnits: 12,
    rebindFrom: "work-1",
    replacesRequestId: "broker-refill-old",
  };
  await client.refill(input);
  await client.refill(input);
  assert.deepEqual(refills[0], refills[1]);
  const headers = new Headers(calls[0]?.headers);
  assert.equal(headers.get(HEADER.REQUEST_ID), "broker-refill-request-1");
  assert.equal(headers.get(HEADER.REBIND_FROM), "work-1");
  assert.equal(headers.get(HEADER.PAYMENT), "refill-payment");
});

test("refill exposes LOC recipient rotation as a typed recoverable session outcome", async () => {
  const { loc } = fakeLoc();
  loc.refillSession = async () => {
    throw new LocTransportError("loc_http_error", {
      status: 409,
      remoteCode: "INVALID_RECIPIENT_RAND",
      retryable: true,
    });
  };
  const client = createPaidSessionClient(loc, {
    fetch: async () => { throw new Error("broker must not receive an invalid payment"); },
  });

  await assert.rejects(
    () => client.refill({
      opened,
      brokerSessionId,
      credential: "session-credential",
      requestId: "gateway-refill-1",
      observedConsumedUnits: 12,
    }),
    (error: unknown) =>
      error instanceof PaidSessionClientError &&
      error.code === "INVALID_RECIPIENT_RAND" &&
      error.retryable,
  );
});

test("end retrieves the authoritative settlement by gateway id and closes LOC once", async () => {
  const { loc, closes } = fakeLoc();
  const urls: string[] = [];
  const client = createPaidSessionClient(loc, {
    fetch: async (url) => {
      urls.push(String(url));
      if (String(url).includes("/settlement/")) {
        return Response.json({
          session_id: brokerSessionId,
          gateway_session_id: gatewaySessionId,
          work_id: "work-1",
          predecessor_work_id: "",
          rotation_generation: 0,
          state: "closed",
          unit: route.workUnit,
          claimed_units: 12,
          debited_units: 12,
          settlement_seq: 1,
        }, { headers: { [HEADER.SETTLEMENT]: encodedSettlement() } });
      }
      return Response.json({
        session_id: brokerSessionId,
        work_id: "work-1",
        state: "closed",
        close_reason: "customer_end",
        ended_at: "2026-08-24T00:10:00Z",
      });
    },
  });
  const result = await client.end({
    opened,
    gatewaySessionId,
    brokerSessionId,
    credential: "session-credential",
    reason: "customer_end",
  });
  assert.equal(result.actualUnits, 12);
  assert.equal(urls[1], `https://broker.example/v1/settlement/${gatewaySessionId}`);
  assert.equal(closes.length, 1);
  assert.equal(closes[0]?.settlement.signature.canonicalization, "jcs");
});

test("terminal identity drift and debit failure are rejected before LOC close", async () => {
  for (const overrides of [{ gateway_session_id: "other" }, { outcome: "DEBIT_FAILED" }]) {
    const { loc, closes } = fakeLoc();
    const client = createPaidSessionClient(loc, {
      fetch: async (url) => String(url).includes("/settlement/")
        ? Response.json({
            session_id: brokerSessionId,
            gateway_session_id: gatewaySessionId,
            work_id: "work-1",
            predecessor_work_id: "",
            rotation_generation: 0,
            state: "closed",
            unit: route.workUnit,
            claimed_units: 12,
            debited_units: 12,
            settlement_seq: 1,
          }, { headers: { [HEADER.SETTLEMENT]: encodedSettlement(overrides) } })
        : Response.json({
            session_id: brokerSessionId, work_id: "work-1", state: "closed",
            close_reason: "customer_end", ended_at: "2026-08-24T00:10:00Z",
          }),
    });
    await assert.rejects(
      () => client.end({ opened, gatewaySessionId, brokerSessionId, credential: "credential", reason: "end" }),
      (error: unknown) => error instanceof PaidSessionClientError && !error.retryable,
    );
    assert.equal(closes.length, 0);
  }
});

test("control frames are typed advisory signals for HTTP reconciliation", () => {
  assert.deepEqual(parsePaidSessionControlEvent({
    type: "session.usage.tick",
    body: { sequence: 4, unit: route.workUnit, claimed_total: 12, debited_units: 3 },
  }), {
    type: "session.usage.tick",
    sequence: 4,
    unit: route.workUnit,
    claimedTotal: 12,
    debitedUnits: 3,
  });
  assert.throws(() => parsePaidSessionControlEvent({ type: "session.usage.tick", body: { sequence: 0 } }));
});
