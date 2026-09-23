# 0020 — LOC-owned HTTP discovery

On 2026-09-23 the user authorized replacing the local resolver requirement
with LOC discovery, matching the OpenAI demo's deployment boundary.
Beads `lmt-5n3` owns implementation/acceptance and `lmt-291` owns local setup.

LOC already exposes authenticated `GET /v1/routes?capability=…&offering=…`.
The response includes a complete `route-snapshot/v1` and `route_binding` with
quote/fingerprints, lossless price/uint64 values, settlement domain and keys,
and protocol axes. Reuse the existing LOC HTTP transport and snapshot parser.
The engine continues to receive a validated `SelectedWorkerRoute`; paid opens
continue binding to the selected quote. LOC remains responsible for the
underlying registry and ranking. No static broker fallback is introduced.

Replace the startup socket adapter with LOC HTTP discovery. Reject the old
socket setting with an actionable migration error instead of silently ignoring
it. Without LOC configuration, retain the unconfigured development stub.
A real no-route response yields no candidate; authentication, availability and
malformed-contract failures must not be disguised as no inventory. Validate
capability/offering, binding consistency, nonzero settlement domain, streaming
ABR/work unit and live descriptor/metering before any paid side effect.

LOC currently selects one ranked route per request. This adapter does not
invent multi-route failover or filtering parameters the HTTP API lacks. The
previous startup adapter did not apply the engine's tier/minWeight hints;
those remain product request inputs, not new discovery guarantees.

Verify mocked protocol/error cases, normal gateway gates, and read-only
selection against production LOC. Do not fund jobs or sessions for this change.
Externally reachable S3/media endpoints and a funded acceptance run remain
separate requirements for real transcoding.

## Validation

Gateway lint and 146 tests passed, including discovery binding/precision,
protocol rejection and error classification. The rebuilt local Docker gateway
selected ABR (`paid-job/v1`, `video-frame-megapixel`) and live
(`paid-session/v1`, `output_seconds`) through production LOC with no resolver
socket configured. Gateway and all three UI health proxies returned HTTP 200.
No paid operation or email was sent. Upstream availability is dynamic: an
earlier ABR lookup returned no candidate before a later lookup succeeded.
