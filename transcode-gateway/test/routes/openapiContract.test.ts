import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

const publicFields = [
  "operation_id", "protocol", "state", "request_id", "work_unit",
  "funded_units", "claimed_units", "balance_units", "lease_expires_at",
  "warnings", "recovered", "retry_count", "next_retry_at", "error_code",
  "relay_status", "delivered_units", "winddown_reason", "terminal_at",
];
const adminFields = [
  "kind", "asset_id", "live_stream_id", "loc_operation_id", "broker_job_id",
  "broker_session_id", "capability", "offering", "transport", "quote_id",
  "quote_version", "route_fingerprint", "rotation_generation",
  "settlement_sequence", "created_at", "updated_at",
];

function file(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

test("OpenAPI and frontend status types cover the gateway v2 projections", () => {
  const openapi = file("../docs/api/openapi.yaml");
  const portal = file("../portal/lib/api.js");
  const admin = file("../admin/lib/api.js");
  for (const field of publicFields) {
    assert.match(openapi, new RegExp(`\\b${field}:`), `OpenAPI missing ${field}`);
    assert.match(portal, new RegExp(`\\b${field}\\b`), `portal type missing ${field}`);
    assert.match(admin, new RegExp(`\\b${field}\\b`), `admin type missing ${field}`);
  }
  for (const field of adminFields) {
    assert.match(openapi, new RegExp(`\\b${field}:`), `OpenAPI missing admin ${field}`);
  }
  for (const forbidden of ["settlement_key", "route_snapshot", "credentials", "runner_ingest_key", "grants"]) {
    assert.doesNotMatch(openapi, new RegExp(`\\b${forbidden}:`));
  }
});
