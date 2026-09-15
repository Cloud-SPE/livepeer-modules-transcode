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
const gatewaySessionId = "f00ac946-92f7-4b47-9231-ecc360ef4c68";
const brokerSessionId = "broker-session-1";
const settlementDomainId = `0x${"55".repeat(32)}`;
const caller = { publicKey: `02${"66".repeat(32)}`, signAuthorization: () => "caller-proof" };
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
    heartbeat: { intervalSeconds: 10, missedThreshold: 3 },
    lease: { policy: "funding-tracking" },
  },
  workUnitEstimator: null,
  settlementKeys: [],
  quoteId: "quote-1",
  quoteVersion: "1",
  constraintFingerprint: Buffer.from("11".repeat(32), "hex"),
  routeFingerprint: Buffer.from("22".repeat(32), "hex"),
  settlementDomainId,
} satisfies SelectedWorkerRoute;
const opened: LocOpenSessionResult = {
  operationId,
  gatewaySessionId,
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
      settlementDomainId,
    },
    settlementDomainId,
    settlementKeys: [],
    workUnitEstimator: null,
    job: null,
    session: route.session,
    extra: {},
    raw: {},
  },
  spendAuthorization: Buffer.from("open-authorization").toString("base64"),
  paymentEnvelope: null,
  expectedValueWei: "0",
  fundedValueWei: "0",
  refillEndpoint: `/v1/sessions/${operationId}/refill`,
  closeEndpoint: `/v1/sessions/${operationId}/close`,
  openedAt: "2026-08-24T00:00:00Z",
};
const balance = {
  claimed_units: 12,
  debited_units: 12,
  unit: route.workUnit,
  authorization_id: "work-1",
  authorization_max_units: 60,
  authorization_cap_remaining_units: 48,
  authorization_reserved_value_wei: "48",
  cumulative_billed_value_wei: "12",
  account_available_value_wei: "1000",
  account_version: 1,
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
      authorization_id: "work-1",
      settlement_domain_id: settlementDomainId,
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
    async prepareSession(input) {
      return {
        gatewaySessionId,
        routeBinding: input.routeBinding,
        brokerUrl: route.workerUrl,
        preparationToken: "prepared-token",
        expiresAt: "2026-08-24T00:05:00Z",
      };
    },
    async openSession(input) {
      opens.push(input);
      return opened;
    },
    async refillSession(input) {
      refills.push(input);
      return {
        workId: "work-2",
        requestId: "broker-refill-request-1",
        refillSequence: 1,
        spendAuthorization: Buffer.from("refill-authorization").toString("base64"),
        paymentEnvelope: null,
        expectedValueWei: "0",
        fundedValueWei: "0",
        capStatus: {
          sessionPctUsed: 0.5,
          spendPeriodPctUsed: null,
          userBalancePctUsed: null,
          operatorPoolPctUsed: null,
          willRefuseNextRefill: false,
          winddownReason: null,
        },
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
        billedValueWei: "12",
        refundWei: "88",
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
    caller,
    fetch: async (url, init) => {
      calls.push({ url: String(url), init });
      return Response.json(openResponse(), { status: 201 });
    },
  });
  const input = {
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
  assert.equal(headers.get(HEADER.AUTHORIZATION), opened.spendAuthorization);
  assert.equal(headers.get(HEADER.CALLER_PROOF), "caller-proof");
  assert.equal(headers.has(HEADER.PAYMENT), false);
});

test("post-admission live capacity settles zero with LOC before surfacing the refusal", async () => {
  const { loc, closes } = fakeLoc();
  const client = createPaidSessionClient(loc, {
    caller,
    fetch: async () => Response.json({
      error: { code: "capacity_exhausted", message: "no runner capacity" },
      session_id: brokerSessionId,
      gateway_session_id: gatewaySessionId,
      work_id: "work-1",
      settlement_url: `https://broker.example/v1/settlement/${brokerSessionId}`,
    }, {
      status: 503,
      headers: {
        [HEADER.ERROR]: "capacity_exhausted",
        [HEADER.WORK_UNITS]: "0",
        [HEADER.SETTLEMENT]: encodedSettlement({
          actual_units: "0",
          billed_units: "0",
          claimed_units: "0",
          debited_units: "0",
        }),
      },
    }),
  });

  await assert.rejects(
    () => client.open({
      requestId: "gateway-open-1",
      route,
      descriptorSchema: "rtmp-hls/v1",
      sessionParams: { publisher_mode: "gateway-relay" },
      estimatedRunwayUnits: 60,
      maxTotalUnits: 3_600,
    }),
    (error: unknown) => error instanceof PaidSessionClientError &&
      error.code === "capacity_exhausted" && error.retryable,
  );
  assert.equal(closes.length, 1);
  assert.equal(closes[0]?.actualUnits, 0);
});

test("stream-key issuance consumes only its scoped grant and replays byte-identically", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const client = createPaidSessionClient(fakeLoc().loc, {
    caller,
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
    caller,
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
    caller,
    fetch: async () => Response.json({
      session_id: brokerSessionId,
      gateway_session_id: gatewaySessionId,
      work_id: "work-1",
      authorization_id: "work-1",
      state: "active",
      runtime: { schema: "rtmp-hls/v1", public: { hls_url: "https://runner.example/live/index.m3u8" } },
      usage: { unit: route.workUnit, claimed_total: 12 },
      lease: { expires_at: "2026-08-24T00:05:00Z" },
      balance,
      started_at: "2026-08-24T00:00:00Z",
      output_state: "stalled",
      output_state_since: "2026-08-24T00:00:20Z",
      last_failure_code: "encoder_init_failed",
    }),
  });
  const result = await client.status({ opened, brokerSessionId, workId: "work-1", credential: "session-credential" });
  assert.equal(result.gatewaySessionId, gatewaySessionId);
  assert.equal(result.claimedUnits, 12);
  assert.equal(result.outputState, "stalled");
  assert.equal(result.outputStateSince, "2026-08-24T00:00:20Z");
  assert.equal(result.lastFailureCode, "encoder_init_failed");
  assert.equal("credential" in result, false);
  assert.equal("grants" in result, false);
});

test("status from a pre-output-health broker is represented as unknown", async () => {
  const client = createPaidSessionClient(fakeLoc().loc, {
    caller,
    fetch: async () => Response.json({
      session_id: brokerSessionId,
      gateway_session_id: gatewaySessionId,
      work_id: "work-1",
      authorization_id: "work-1",
      state: "active",
      runtime: { schema: "rtmp-hls/v1", public: {} },
      usage: { unit: route.workUnit, claimed_total: 0 },
      lease: { expires_at: "2026-08-24T00:05:00Z" },
      balance,
      started_at: "2026-08-24T00:00:00Z",
    }),
  });

  const result = await client.status({ opened, brokerSessionId, workId: "work-1", credential: "session-credential" });
  assert.equal(result.outputState, "unknown");
  assert.equal(result.outputStateSince, null);
  assert.equal(result.lastFailureCode, null);
});

test("refill keeps its durable request identity and forwards a successor authorization", async () => {
  const { loc, refills } = fakeLoc();
  const calls: RequestInit[] = [];
  const client = createPaidSessionClient(loc, {
    caller,
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
    maxTotalUnits: 120,
  };
  await client.refill(input);
  await client.refill(input);
  assert.deepEqual(refills[0], refills[1]);
  const headers = new Headers(calls[0]?.headers);
  assert.equal(headers.get(HEADER.REQUEST_ID), "broker-refill-request-1");
  assert.equal(headers.get(HEADER.AUTHORIZATION), Buffer.from("refill-authorization").toString("base64"));
  assert.equal(headers.get(HEADER.CALLER_PROOF), "caller-proof");
  assert.equal(headers.has(HEADER.PAYMENT), false);
  assert.equal(calls[0]?.body, "{}");
});

test("refill exposes a typed LOC refusal without calling the broker", async () => {
  const { loc } = fakeLoc();
  loc.refillSession = async () => {
    throw new LocTransportError("loc_http_error", {
      status: 409,
      remoteCode: "session_cap_exceeded",
      retryable: false,
    });
  };
  const client = createPaidSessionClient(loc, {
    caller,
    fetch: async () => { throw new Error("broker must not receive an invalid payment"); },
  });

  await assert.rejects(
    () => client.refill({
      opened,
      brokerSessionId,
      credential: "session-credential",
      requestId: "gateway-refill-1",
      observedConsumedUnits: 12,
      maxTotalUnits: 120,
    }),
    (error: unknown) =>
      error instanceof PaidSessionClientError &&
      error.code === "session_cap_exceeded" &&
      !error.retryable,
  );
});

test("end retrieves the authoritative settlement by gateway id and closes LOC once", async () => {
  const { loc, closes } = fakeLoc();
  const urls: string[] = [];
  const client = createPaidSessionClient(loc, {
    caller,
    fetch: async (url) => {
      urls.push(String(url));
      if (String(url).includes("/settlement/")) {
        return Response.json({
          session_id: brokerSessionId,
          gateway_session_id: gatewaySessionId,
          work_id: "work-1",
          authorization_id: "work-1",
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
  for (const overrides of [
    { gateway_session_id: "other" },
    { outcome: "DEBIT_FAILED" },
    { authorization_id: "other" },
    { settlement_domain_id: `0x${"77".repeat(32)}` },
  ]) {
    const { loc, closes } = fakeLoc();
    const client = createPaidSessionClient(loc, {
      caller,
      fetch: async (url) => String(url).includes("/settlement/")
        ? Response.json({
            session_id: brokerSessionId,
            gateway_session_id: gatewaySessionId,
            work_id: "work-1",
            authorization_id: "work-1",
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
  assert.deepEqual(parsePaidSessionControlEvent({
    type: "session.output.health",
    body: {
      output_state: "stalled",
      output_state_since: "2026-09-09T12:00:00Z",
      last_failure_code: "encoder_init_failed",
    },
  }), {
    type: "session.output.health",
    outputState: "stalled",
    outputStateSince: "2026-09-09T12:00:00Z",
    lastFailureCode: "encoder_init_failed",
  });
  assert.throws(() => parsePaidSessionControlEvent({
    type: "session.output.health",
    body: { output_state: "broken", output_state_since: "2026-09-09T12:00:00Z" },
  }));
  assert.throws(() => parsePaidSessionControlEvent({
    type: "session.output.health",
    body: { output_state: "stalled", output_state_since: "not-a-time" },
  }));
});
