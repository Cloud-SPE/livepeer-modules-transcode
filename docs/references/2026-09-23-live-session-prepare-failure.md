# Live stream preparation failure — 2026-09-23

The user submission at 13:44:15 UTC created local stream
`live_7a6a4c0b6a4e63dd` after successful LOC discovery. Request
`ba216bf5-e770-4554-9a56-aaffcdbcfc01` returned HTTP 502 after 30,469 ms;
`live.open_failed` reported `LOC request failed`. The original logs did not
retain the transport code or failing stage, so the precise original transport
failure cannot be established retrospectively from them.

After deploying safe stage diagnostics, nine observed recovery attempts failed
at `prepare_session` with LOC HTTP 409 `IDEMPOTENCY_IN_PROGRESS`. The durable
operation remained `opening`, without a LOC operation ID or broker session ID.
Recovery retains the original request identity. No replacement submission was
made during the investigation.

The local LOC source implements `/v1/sessions/prepare` by committing an
idempotency claim, selecting the bound registry route, and completing the
claim with the preparation response. Its default in-flight claim timeout is
60 seconds and expired claims are reclaimable. Production logs and effective
configuration are required to establish why this particular preparation does
not complete; these observations do not establish whether registry access,
request processing, or a different production setting is responsible.

Gateway diagnostics now retain the typed transport code, safe operation name,
upstream HTTP status, and sanitized remote code for live open/recovery errors.
They do not include request bodies, credentials, preparation tokens, or stream
keys. All 160 gateway tests passed, including both preparation and authorization
failure-stage tests. The gateway Docker image was rebuilt/recreated and
`GET /api/v1/health` returned `{"status":"ok"}`.

This diagnostic change does not resolve the production LOC preparation failure.
