# Production v2 compatibility review — 2026-09-22

Review bead: `lmt-ls0`. This is observed compatibility evidence, not approval
of a production release or a replacement for funded end-to-end acceptance.

## Reviewed versions

| Repository | Reviewed main SHA |
| --- | --- |
| Transcode | `295ac633caa109f897b86c9379c1bda8ddb3f869` |
| LOC | `6a6392a7d636f2ca694d728e9df26eb08c1e63bb` |
| Modules | `08f59859a2cd1d79a26ee3e807702d86496f8391` |

Read-only `git ls-remote origin refs/heads/main` confirmed both upstream
checkouts match remote main. Their pre-existing `.beads/interactions.jsonl`
modifications were not touched. No upstream fetch, checkout, or edit occurred.

Public production observations:

- `https://loc.cloudspe.com/health` returned HTTP 200 and
  `{"status":"ok","version":"2.0.0","env":"prod"}`.
- `https://loc.cloudspe.com/openapi.json` returned HTTP 200. Its job create,
  job settle, session prepare/create/refill/status/close, route binding, and
  route snapshot schemas exactly match upstream's root `openapi.json`.
- These surfaces do not establish the running image digest or commit. No
  authenticated request, paid workload, or production mutation was performed.

## Compatibility already implemented

Transcode commit `9c726fd` implements LOC-issued wholesale authorizations,
delegated caller proofs, workload digests, prepared session identities,
authorization cap revisions, and settlement-domain persistence/validation.
The reviewed LOC request/response models agree with the gateway's adapter.
The gateway uses a local HTTP adapter; publication of an npm LOC SDK is not
a runtime dependency.

The vendored resolver/type protos have the same fields as current Modules;
the diff is comments and whitespace. Current Modules templates expose
`abr-default` and `gateway-ingest`, matching gateway defaults. The catalog
also contains immutable runner image references, persistent runner state,
and shared GPU admission configuration. Their presence is not proof that a
specific member is deployed and certified with those artifacts.

## Findings

**Definitive VOD authorization refusal is not preserved by recovery.** LOC
`d8724d8` adds HTTP 422 `AUTHORIZATION_REFUSED`, HTTP 409
`ENGAGEMENT_CLOSED`, and retryable HTTP 503 `WHOLESALE_FUNDING_UNVERIFIED`.
`transcode-gateway/src/livepeer/paidJobClient.ts` calls `loc.openJob` without
normalizing `LocTransportError`. The catch in
`transcode-gateway/src/engine/service/paidAbrRecovery.ts` only recognizes
`PaidJobClientError`, so even a nonretryable LOC refusal becomes
`recovery_retry` / `paid_job_recovery_failed`. This is a source-confirmed
failure-path gap, tracked by `lmt-9ee`; it was not exercised against a funded
production account during this review.

**Local Compose does not provide a paid integration environment.** Gateway
Compose supplies Postgres but leaves resolver, LOC, operation encryption,
storage, and RTMP configuration unwired. E2E Compose adds MinIO but explicitly
asserts missing-resolver 503 responses. Its README excludes actual encoding,
RTMP publishing, LOC settlement, and real discovery. A passing smoke cannot
establish those properties. The local integration profile is tracked in Beads.

**Release provenance is stale.** The approved baseline still points to August;
the September wholesale transition reference explicitly withholds approval.
Several open beads describe implementation that is already in source, while
their joint-conformance and deployed-evidence criteria remain unfulfilled in
this checkout. Do not interpret these old entries as proof that upstream is
still missing the implementation, or close them solely because v2 was merged.

## Local deployment boundary

A local gateway can use production LOC without running a local payer daemon.
It needs Postgres; an approved, funded LOC API key; a stable delegated caller
private key; and a separately backed-up operation encryption key. Configure
`LIVEPEER_LOC_URL=https://loc.cloudspe.com`, `LIVEPEER_LOC_API_KEY`,
`LIVEPEER_CALLER_PRIVATE_KEY`, `LIVEPEER_OPERATION_SECRETS_KEK`, and its key ID.
Startup runs migrations, including `0005_settlement_domain_identity.sql`.

The gateway currently constructs a Unix-domain gRPC resolver client. Mount a
real Modules resolver socket and set `LIVEPEER_RESOLVER_SOCKET`; the LOC URL
alone cannot replace this dependency. Gateway-selected quotes/routes must be
accepted by LOC's resolver and expose the same settlement domain and delegated
settlement keys. Static broker fallback is intentionally unsupported.

VOD requires S3 credentials, bucket, and presigned URLs reachable by the
uploader, gateway, and selected runner. The E2E `http://minio:9000` address is
container-network-local and must not be assumed reachable by remote runners.
Live also requires `LIVEPEER_GATEWAY_EXTERNAL_RTMP_URL`, the relay, an exposed
RTMP listener, and reachable runner ingest/playback endpoints. Standalone
runner Compose does not attach or certify runners with a broker by itself.

Readiness requires the real transcode path: VOD upload/ABR/output/settlement;
live publish/playback/refill/end/settlement; identical-request restart
recovery; authorization refusal and transient funding failure; and deployed
image/manifest provenance. Existing release beads `lmt-65a.3.1`,
`lmt-65a.4.4`, `lmt-65a.5.2`, and `lmt-65a.5.6` own this acceptance.

## Validation performed

- Gateway TypeScript lint and 138 tests passed.
- `go test ./...` passed in transcode-core, transcode-runner, abr-runner,
  and live-runner.
- `make -C transcode-gateway build` passed, producing local image
  `tztcloud/transcode-gateway:v0.1.0`, image ID
  `sha256:0c94d9a52974f370f56b905eb8c003f0ddb82a0ada2a93bbf62df872ad9779d4`.
  This is a local image ID, not a published registry manifest digest.
- No real funded VOD/live session, GPU encode, full repository release gate,
  rollback drill, or production image attestation was performed.

The code is substantially aligned with current v2, but this review does not
establish full local paid-path or production readiness.
