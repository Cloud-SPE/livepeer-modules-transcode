import { test } from "node:test";
import assert from "node:assert/strict";
import {
  RouteHealthTracker,
  summarizeRouteHealth,
  renderRouteHealthMetrics,
} from "../../src/livepeer/routeHealth.js";
import type { VideoRouteCandidate } from "../../src/livepeer/routeSelector.js";

function candidate(brokerUrl: string): VideoRouteCandidate {
  return {
    brokerUrl,
    ethAddress: "0xabc",
    capability: "video:transcode.abr",
    offering: "default",
    pricePerWorkUnitWei: "0",
    workUnit: "seconds",
    protocol: "paid-job/v1",
    job: { transports: ["stream"] },
    session: null,
    workUnitEstimator: null,
    settlementKeys: [],
    quoteId: null,
    quoteVersion: null,
    constraintFingerprint: null,
    routeFingerprint: null,
    unitsPerPrice: null,
    extra: null,
    constraints: null,
  };
}

test("success closes any prior failure state", () => {
  const tracker = new RouteHealthTracker({ failureThreshold: 2, cooldownMs: 60_000 });
  const c = candidate("https://broker.example.com");
  tracker.record(c, { ok: false, retryable: true }, "first fail");
  tracker.record(c, { ok: true, retryable: false });
  const snap = tracker.inspect()[0]!;
  assert.equal(snap.consecutiveFailures, 0);
  assert.equal(snap.coolingDown, false);
});

test("hitting the failure threshold opens a cooldown", () => {
  const tracker = new RouteHealthTracker({ failureThreshold: 2, cooldownMs: 60_000 });
  const c = candidate("https://broker.example.com");
  tracker.record(c, { ok: false, retryable: true }, "1");
  tracker.record(c, { ok: false, retryable: true }, "2");
  const snap = tracker.inspect()[0]!;
  assert.equal(snap.consecutiveFailures, 2);
  assert.equal(snap.coolingDown, true);
  assert.ok(snap.cooldownUntil !== null);
});

test("non-retryable failures do not count toward threshold", () => {
  const tracker = new RouteHealthTracker({ failureThreshold: 2, cooldownMs: 60_000 });
  const c = candidate("https://broker.example.com");
  tracker.record(c, { ok: false, retryable: false });
  tracker.record(c, { ok: false, retryable: false });
  const snap = tracker.inspect()[0]!;
  assert.equal(snap.consecutiveFailures, 0);
  assert.equal(snap.coolingDown, false);
});

test("rankCandidates puts ready brokers ahead of cooling ones", () => {
  const tracker = new RouteHealthTracker({ failureThreshold: 1, cooldownMs: 60_000 });
  const hot = candidate("https://hot.example.com");
  const cold = candidate("https://cold.example.com");
  tracker.record(cold, { ok: false, retryable: true });   // cold goes cooling
  tracker.record(hot, { ok: true, retryable: false });

  const ranked = tracker.rankCandidates([cold, hot]);
  assert.equal(ranked[0]!.brokerUrl, "https://hot.example.com");
  assert.equal(ranked[1]!.brokerUrl, "https://cold.example.com");
});

test("summarizeRouteHealth counts tracked / cooling / failing", () => {
  const tracker = new RouteHealthTracker({ failureThreshold: 1, cooldownMs: 60_000 });
  tracker.record(candidate("a"), { ok: false, retryable: true });
  tracker.record(candidate("b"), { ok: true, retryable: false });
  const summary = summarizeRouteHealth(tracker.inspect());
  assert.equal(summary.tracked_routes, 2);
  assert.equal(summary.cooling_routes, 1);
  assert.equal(summary.routes_with_failures, 1);
});

test("renderRouteHealthMetrics emits Prometheus-shaped lines for the configured gateway", () => {
  const tracker = new RouteHealthTracker({ failureThreshold: 1, cooldownMs: 60_000 });
  tracker.record(candidate("x"), { ok: true, retryable: false });
  const out = renderRouteHealthMetrics(
    "transcode-gateway",
    summarizeRouteHealth(tracker.inspect()),
    tracker.inspectMetrics(),
  );
  assert.match(out, /livepeer_gateway_route_health_attempts_total\{gateway="transcode-gateway"\} 1/);
  assert.match(out, /livepeer_gateway_route_health_successes_total\{gateway="transcode-gateway"\} 1/);
  assert.match(out, /livepeer_gateway_route_health_tracked_routes\{gateway="transcode-gateway"\} 1/);
});
