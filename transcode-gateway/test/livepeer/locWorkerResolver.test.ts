import assert from "node:assert/strict";
import { test } from "node:test";
import { createLocWorkerResolver } from "../../src/livepeer/locWorkerResolver.js";
import { createLocHttpTransport } from "../../src/livepeer/locHttpTransport.js";
import { LocTransportError } from "../../src/engine/interfaces/index.js";

function fixture(live = false) {
  const binding = {
    quote_id: "quote-1", quote_version: "18446744073709551615",
    constraint_fingerprint: "11".repeat(32), route_fingerprint: "22".repeat(32),
    settlement_domain_id: `0x${"33".repeat(32)}`,
  };
  return {
    route_binding: { ...binding },
    route_snapshot: {
      ...binding, schema_version: "route-snapshot/v1", broker_url: "https://broker.example.test",
      eth_address: `0x${"44".repeat(20)}`, capability: live ? "video:transcode.live" : "video:transcode.abr",
      offering: live ? "gateway-ingest" : "abr-default", protocol: live ? "paid-session/v1" : "paid-job/v1",
      work_unit: live ? "output_seconds" : "video-frame-megapixel",
      price_per_work_unit_wei: "90071992547409931234", units_per_price: "1000",
      settlement_keys: [{ public_key: `0x04${"55".repeat(64)}`, not_before: "2026-01-01T00:00:00Z", expires_at: "2027-01-01T00:00:00Z", introduced_in_publication_seq: "9007199254740993" }],
      job: live ? null : { transports: ["stream"] },
      session: live ? { descriptor_schema: "rtmp-hls/v1", attachment: "external", metering: "runner-reported" } : null,
      work_unit_estimator: null, extra: {},
    },
  };
}
const input = { capability: "video:transcode.abr" as const, offering: "abr-default", tier: "standard" };
function resolver(fetchImpl: typeof fetch) {
  return createLocWorkerResolver(createLocHttpTransport({
    baseUrl: "https://loc.example.test", apiKey: "test-key", clientId: "test", timeoutMs: 1000, fetch: fetchImpl,
  }));
}

test("LOC discovery authenticates a read-only selection and preserves exact route identity", async () => {
  const route = await resolver(async (url, init) => {
    const parsed = new URL(String(url));
    assert.equal(parsed.pathname, "/v1/routes");
    assert.equal(parsed.searchParams.get("capability"), input.capability);
    assert.equal(parsed.searchParams.get("offering"), input.offering);
    assert.equal(init?.method, "GET");
    assert.equal(init?.body, undefined);
    assert.equal(new Headers(init?.headers).get("X-API-Key"), "test-key");
    return Response.json(fixture());
  }).selectWorker(input);
  assert.equal(route?.quoteVersion, "18446744073709551615");
  assert.equal(route?.pricePerWorkUnitWei, "90071992547409931234");
  assert.equal(route?.settlementDomainId, fixture().route_binding.settlement_domain_id);
  assert.equal(Buffer.from(route!.routeFingerprint!).toString("hex"), "22".repeat(32));
  assert.equal(route?.settlementKeys[0]?.introducedInPublicationSeq, "9007199254740993");
});

test("LOC discovery supports the external metered live descriptor", async () => {
  const route = await resolver(async () => Response.json(fixture(true))).selectWorker({ capability: "video:transcode.live", offering: "gateway-ingest", tier: "standard" });
  assert.equal(route?.session?.descriptorSchema, "rtmp-hls/v1");
  assert.equal(route?.workUnit, "output_seconds");
});

test("LOC discovery refuses mismatched or incomplete paid identity", async () => {
  const mutations: ((value: ReturnType<typeof fixture>) => void)[] = [
    value => { value.route_binding.quote_id = "other"; },
    value => { value.route_snapshot.offering = "other"; },
    value => { value.route_snapshot.capability = "other"; },
    value => { value.route_snapshot.settlement_keys = []; },
    value => { value.route_snapshot.settlement_domain_id = `0x${"0".repeat(64)}`; },
    value => { (value.route_snapshot as Record<string, unknown>).quote_version = 9007199254740992; },
    value => { value.route_snapshot.route_fingerprint = "invalid"; },
  ];
  for (const mutate of mutations) {
    const value = fixture(); mutate(value);
    await assert.rejects(() => resolver(async () => Response.json(value)).selectWorker(input), LocTransportError);
  }
});

test("LOC discovery does not return unsupported transport or work units", async () => {
  const value = fixture(); value.route_snapshot.job!.transports = ["unary"];
  assert.equal(await resolver(async () => Response.json(value)).selectWorker(input), null);
  value.route_snapshot.job!.transports = ["stream"]; value.route_snapshot.work_unit = "seconds";
  assert.equal(await resolver(async () => Response.json(value)).selectWorker(input), null);
});

test("only explicit no-route maps to no candidate; outages and credentials remain errors", async () => {
  assert.equal(await resolver(async () => Response.json({ detail: "no_route_available" }, { status: 404 })).selectWorker(input), null);
  for (const status of [401, 403, 404, 500, 503]) {
    await assert.rejects(() => resolver(async () => Response.json({ error: { code: "upstream_error" } }, { status })).selectWorker(input), (error: unknown) => {
      assert.ok(error instanceof LocTransportError); assert.equal(error.status, status); return true;
    });
  }
});
