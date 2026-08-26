import assert from "node:assert/strict";
import { test } from "node:test";
import { loadConfig } from "../src/config.js";

const required = {
  DATABASE_URL: "postgres://localhost/transcode",
  ADMIN_TOKEN: "a".repeat(16),
  API_KEY_HASH_PEPPER: "p".repeat(16),
};

test("LOC configuration is disabled only when URL and API key are both absent", () => {
  const config = loadConfig(required);
  assert.equal(config.LIVEPEER_LOC_URL, undefined);
  assert.equal(config.LIVEPEER_LOC_API_KEY, undefined);
  assert.equal(config.LIVEPEER_LOC_TIMEOUT_MS, 15_000);
  assert.equal(config.LIVEPEER_LOC_CLIENT_ID, "livepeer-modules-transcode/0.0.0");
  assert.equal(config.LIVEPEER_LIVE_OFFERING_DEFAULT, "live-standard");
  assert.equal(config.LIVEPEER_LIVE_INITIAL_RUNWAY_UNITS, 60);
  assert.equal(config.LIVEPEER_LIVE_MAX_TOTAL_UNITS, 3_600);
  assert.equal(config.LIVEPEER_LIVE_REFILL_THRESHOLD_UNITS, 15);
  assert.equal(config.LIVEPEER_LIVE_MAX_REFILLS, 60);
  assert.equal(config.LIVEPEER_LIVE_RECONCILE_INTERVAL_MS, 5_000);
  assert.equal(config.LIVEPEER_LIVE_CONTROL_WINDOW_MS, 250);
});

test("live refill threshold must leave positive initial runway", () => {
  assert.throws(() => loadConfig({
    ...required,
    LIVEPEER_LIVE_INITIAL_RUNWAY_UNITS: "60",
    LIVEPEER_LIVE_REFILL_THRESHOLD_UNITS: "60",
  }), /must be below initial runway/);
});

test("live funding ceiling must cover the initial finite runway", () => {
  assert.throws(() => loadConfig({
    ...required,
    LIVEPEER_LIVE_INITIAL_RUNWAY_UNITS: "120",
    LIVEPEER_LIVE_MAX_TOTAL_UNITS: "60",
  }), /must cover LIVEPEER_LIVE_INITIAL_RUNWAY_UNITS/);
});

test("LOC configuration rejects partial credentials", () => {
  assert.throws(
    () =>
      loadConfig({
        ...required,
        LIVEPEER_LOC_URL: "https://loc.example.com",
      }),
    /LIVEPEER_LOC_URL and LIVEPEER_LOC_API_KEY must be set together/,
  );
  assert.throws(
    () =>
      loadConfig({
        ...required,
        LIVEPEER_LOC_API_KEY: "loc-secret",
      }),
    /LIVEPEER_LOC_URL and LIVEPEER_LOC_API_KEY must be set together/,
  );
});

test("LOC configuration accepts a complete explicit boundary", () => {
  const config = loadConfig({
    ...required,
    LIVEPEER_LOC_URL: "https://loc.example.com",
    LIVEPEER_LOC_API_KEY: "loc-secret",
    LIVEPEER_LOC_TIMEOUT_MS: "2500",
    LIVEPEER_LOC_CLIENT_ID: "transcode/test",
  });
  assert.equal(config.LIVEPEER_LOC_TIMEOUT_MS, 2_500);
  assert.equal(config.LIVEPEER_LOC_CLIENT_ID, "transcode/test");
});
