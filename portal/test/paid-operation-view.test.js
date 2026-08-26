import { test } from "node:test";
import assert from "node:assert/strict";
import { operationSummary, operationTone, shouldPollOperation } from "../lib/paid-operation-view.js";

const status = (overrides = {}) => ({
  state: "in_flight", work_unit: "video-frame-megapixel", claimed_units: null,
  recovered: false, error_code: null, winddown_reason: null, ...overrides,
});

test("pending and recovered operations remain pollable", () => {
  assert.equal(shouldPollOperation(status()), true);
  assert.match(operationSummary(status({ recovered: true })), /Recovered/);
  assert.equal(operationTone(status()), "warn");
});

test("failed debit is terminal and visibly unsafe", () => {
  const value = status({ state: "encumbered", error_code: "debit_failed" });
  assert.equal(shouldPollOperation(value), false);
  assert.equal(operationTone(value), "error");
  assert.match(operationSummary(value), /result remains unavailable/);
});

test("winddown remains pending until settlement", () => {
  const value = status({ state: "winddown_retry", winddown_reason: "customer_end" });
  assert.equal(shouldPollOperation(value), true);
  assert.match(operationSummary(value), /settlement is still pending/);
});

test("settled operation is terminal and reports verified usage", () => {
  const value = status({ state: "settled", claimed_units: "42" });
  assert.equal(shouldPollOperation(value), false);
  assert.equal(operationTone(value), "ok");
  assert.match(operationSummary(value), /42 video-frame-megapixel/);
});
