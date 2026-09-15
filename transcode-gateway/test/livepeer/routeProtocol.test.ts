import { test } from "node:test";
import assert from "node:assert/strict";

import {
  parseRouteProtocolDeclaration,
  parseSettlementKeys,
  parseWorkUnitEstimator,
  routeSatisfiesRequirement,
} from "../../src/livepeer/routeProtocol.js";

test("paid-job declaration preserves transports and rejects protocol drift", () => {
  const declaration = parseRouteProtocolDeclaration("paid-job/v1", {
    protocol: "paid-job/v1",
    job: { transports: ["stream", "unary"] },
  });
  assert.ok(declaration);
  assert.deepEqual(declaration.job?.transports, ["stream", "unary"]);
  assert.equal(
    routeSatisfiesRequirement(declaration, {
      protocol: "paid-job/v1",
      acceptedTransports: ["stream"],
    }),
    true,
  );
  assert.equal(
    routeSatisfiesRequirement(declaration, {
      protocol: "paid-job/v1",
      acceptedTransports: ["multipart"],
    }),
    false,
    "JSON ABR dispatch must reject a multipart-only offering",
  );
  assert.equal(
    parseRouteProtocolDeclaration("paid-job/v1", {
      protocol: "paid-session/v1",
      job: { transports: ["stream"] },
    }),
    null,
  );
});

test("paid-session declaration applies normative defaults and gates descriptor and attachment", () => {
  const declaration = parseRouteProtocolDeclaration("paid-session/v1", {
    protocol: "paid-session/v1",
    session: {
      descriptor_schema: "rtmp-hls/v1",
      attachment: "external",
      metering: "runner-reported",
      session_params_schema: { type: "object", required: ["ingest_url"] },
    },
  });
  assert.ok(declaration?.session);
  assert.equal(declaration.session.refill, "extensible");
  assert.deepEqual(declaration.session.heartbeat, {
    intervalSeconds: 10,
    missedThreshold: 3,
  });
  assert.equal(
    routeSatisfiesRequirement(declaration, {
      protocol: "paid-session/v1",
      descriptorSchema: "rtmp-hls/v1",
      attachment: "external",
    }),
    true,
  );
  assert.equal(
    routeSatisfiesRequirement(declaration, {
      protocol: "paid-session/v1",
      descriptorSchema: "other/v1",
    }),
    false,
  );
});

test("malformed or unsupported route declarations fail closed", () => {
  assert.equal(parseRouteProtocolDeclaration("http-stream@v0", {}), null);
  assert.equal(
    parseRouteProtocolDeclaration("paid-job/v1", { job: { transports: ["multipart", "bogus"] } }),
    null,
  );
  assert.equal(
    parseRouteProtocolDeclaration("paid-session/v1", {
      session: { descriptor_schema: "rtmp-hls/v1", metering: "broker-observed" },
    }),
    null,
    "broker-observed metering cannot use the default external attachment",
  );
});

test("estimator and overlapping settlement keys preserve the trusted route snapshot", () => {
  assert.deepEqual(
    parseWorkUnitEstimator({
      id: "abr-output-frame-megapixels/v1",
      rounding: "ceiling",
      exactness: "exact-or-reject",
      package: "@livepeer/abr-work-units",
      fixtures: "fixtures/abr-work-units/v1",
    }),
    {
      id: "abr-output-frame-megapixels/v1",
      rounding: "ceiling",
      exactness: "exact-or-reject",
      package: "@livepeer/abr-work-units",
      fixtures: "fixtures/abr-work-units/v1",
    },
  );

  const keys = parseSettlementKeys([
    {
      publicKey: "0x04-new",
      notBefore: "2026-08-22T00:00:00Z",
      expiresAt: "2026-08-24T00:00:00Z",
      introducedInPublicationSeq: "7",
    },
    {
      publicKey: "0x04-old",
      notBefore: "2026-08-21T00:00:00Z",
      expiresAt: "2026-08-23T00:00:00Z",
      introducedInPublicationSeq: "6",
    },
  ]);
  assert.equal(keys?.length, 2);
  assert.equal(keys?.[0]?.publicKey, "0x04-new");
  assert.equal(keys?.[1]?.publicKey, "0x04-old");
});
