Subject: LOC v2 production issue: live preparation failures leave requests in progress

We need help fixing live session preparation in production LOC at
https://loc.cloudspe.com. Read-only investigation on infra1 confirmed:

- On 2026-09-23, around 13:44 and 13:49 UTC, POST /v1/sessions/prepare
  failed inside service.prepare_session → select_bound_route →
  GrpcRegistryClient.select_many → stub.SelectMany with gRPC NOT_FOUND:
  no route for video:transcode.live / gateway-ingest.
- select_many does not handle NOT_FOUND, although select already does.
  It also has no explicit RPC deadline.
- Preparation commits an idempotency claim before selecting the route. Its
  error path leaves the claim in_flight. Subsequent identical requests return
  409 IDEMPOTENCY_IN_PROGRESS until the configured 300-second claim expires.
  Our gateway returned 502 after roughly 30 seconds during the original open.
- Registry logs show candidate lookups failing with context deadline exceeded
  and rpc.all_circuits_open. The registry has one configured RPC host,
  arb1.xode.app. Please investigate its availability/circuit behavior separately;
  fixing the HTTP error handling alone will not restore unavailable routes.

Please review and implement:

1. Bound SelectMany with a suitable RPC deadline, handle NOT_FOUND consistently
   with select, and map other gRPC failures to a sanitized service-unavailable
   response. The draft uses 10 seconds; validate/configure this against healthy
   cold-selection latency.
2. On a known pre-payment preparation failure, allow an identical retry promptly
   while retaining the fingerprint and request identity. Release only the same
   claim attempt using a conditional expiry/status check; a late failed request
   must not expire a newer retry's claim. Do not apply this release behavior to
   paid opens, refills, or uncertain funding outcomes.
3. Cover no-route, registry timeout, repeated preparation, expired/reclaimed
   claims, and late-failure concurrency. Verify discovery → prepare → open
   against the production video:transcode.live / gateway-ingest route.

A reviewed draft patch and regression tests are available in
livepeer-modules-transcode/docs/proposals/loc-live-recovery/:

- loc-preparation.patch
- test_preparation_recovery.py
- README.md

The three patch target files match the installed production source by SHA256.
In an isolated source copy, four targeted tests (including an in-memory database
claim-fencing test) and 35 existing LOC unit tests passed; 11 legacy cases were
skipped. Neither the LOC source checkout nor production has been changed.

For incident correlation:
- Gateway request: ba216bf5-e770-4554-9a56-aaffcdbcfc01
- Local stream: live_7a6a4c0b6a4e63dd
- LOC session after eventual recovery: 167c94b6-d0d2-40d0-b1ff-ee99cb3f7aae
- Broker session: sess_ed87a24f-ad07-464e-bbb7-b8cec26bfeff

Separately, our repo now fixes settlement parsing, pending creation/closure UI,
recovery claim release, and close-reason compatibility. The EU broker's existing
session is stuck because its pinned lease_exhausted reason is rejected by the
runner (HTTP400; runner expects lease_expired). Runner compatibility is prepared
locally but not deployed. That runner deployment is a separate coordinated fix;
please do not clear accounting/session records to work around it.

No production changes are authorized by this handoff alone. Please return the
reviewed change, validation results and deployment plan so we can coordinate the
runner update and complete the real create → RTMP → HLS → LOC-settlement test.
