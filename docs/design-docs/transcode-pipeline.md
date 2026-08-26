# Transcode pipeline (VOD)

This document defines the implemented Modules v2 VOD pipeline. The gateway
dispatches one recoverable `paid-job/v1` ABR exchange through LOC and contains
no legacy per-rendition payment path.

## Customer surface

```
POST   /v1/uploads
POST   /v1/uploads/:id/complete
POST   /v1/vod/submit
GET    /v1/vod/:asset_id
GET    /v1/videos/assets
GET    /v1/videos/assets/:id
DELETE /v1/videos/assets/:id
GET    /v1/playback/:id
```

Uploads use presigned S3-compatible object-store URLs. All product routes are
gated by the customer API key.

## State and correlation

Product state remains asset-oriented:

```
asset: pending -> uploaded -> encoding -> ready
                                   \-> failed
```

One paid exchange represents the complete ABR ladder. Before calling LOC,
the gateway durably records at least:

- asset and local operation IDs;
- `Livepeer-Request-Id` and canonical request-content hash;
- selected resolver route, route/constraint fingerprints, quote ID/version,
  settlement key, protocol, transport, descriptor, and work unit;
- conservative funded ceiling and LOC operation ID when assigned;
- broker job ID, signed terminal work units, and terminal outcome.

Rendition rows remain product outputs; they are not independent paid jobs.

## Exchange contract

| Axis | Required value |
|---|---|
| Protocol | `paid-job/v1` |
| HTTP selection | `POST /v1/job`, `Accept: text/event-stream` |
| Transport | `stream` |
| Request schema | `video-transcode-abr/v2` |
| Terminal schema | `video-transcode-abr-result/v2` |
| Work unit | `video-frame-megapixel` |
| Cardinality | one exchange per ABR ladder |

The gateway rejects any route that does not advertise all required axes
before LOC is asked to fund it.

The runner-owned validation types and canonical cross-repo fixtures live in
[`abr-runner/contract_v2.go`](../../abr-runner/contract_v2.go) and
[`abr-runner/testdata/contracts/v2/`](../../abr-runner/testdata/contracts/v2/).
They define strict request parsing, progress/keepalive SSE, success/failure
terminal results, and workload replay independently of broker behavior.

## Processing flow

1. The upload completes in object storage and the gateway probes source
   duration, dimensions, frame rate, and codecs.
2. The gateway plans a supported ABR ladder and creates the asset's pending
   rendition rows.
3. It computes a conservative funded-unit ceiling from the probe and target
   ladder. This is authorization, not the final claim.
4. It resolves a compatible route, persists the correlation record, and asks
   LOC to execute the job with a stable request ID.
5. The broker starts the ABR runner. The runner responds as SSE promptly,
   sends progress or keepalive events while FFmpeg runs, and emits exactly one
   terminal result containing all delivered outputs.
6. The terminal response carries `Livepeer-Job-Id`, `Livepeer-Work-Unit`, and
   the signed `Livepeer-Work-Units` claim. LOC settles once. The gateway
   validates unit identity, records outputs, publishes the HLS manifest, and
   marks the asset ready.

There is no 202/poll runner protocol and no fixed five-minute backend timeout.
Gateway, LOC, broker, proxy, and load-balancer deadlines must permit the
expected encode duration while idle timers are kept alive by SSE traffic.

## Metering

For delivered video renditions `i`, the exact terminal claim is:

```
ceil(sum(actual_frames_i * width_i * height_i) / 1_000_000)
```

The runner sums before applying one ceiling. Audio-only outputs contribute
zero units. Estimated frames or source frames are acceptable only for the
pre-open funded ceiling; settlement uses actual delivered output frames.

The Modules stack must provide a Modules-owned terminal response
header/trailer extractor (or equivalent protocol-native mechanism) that can
verify this multi-rendition formula against shared fixtures. The existing
fixed-resolution FFmpeg-progress extractor is insufficient because it floors
units and cannot aggregate a varying ladder.

## Idempotency and recovery

A timeout after open is an unknown outcome, not evidence that nothing ran.
Recovery repeats or queries the same LOC operation with identical bytes and
request ID. Expected convergence includes the same status, claim, and broker
job ID. `job_in_flight` causes reconciliation/backoff;
`request_id_reuse` is a terminal integrity error. The gateway never settles
zero as compensation and never opens a replacement job for ambiguity.

## Product output

On success, the terminal result maps to `media.renditions`; the gateway
builds/publishes the master playlist and records playback state. Product
pricing, customer invoices, and a usage UI are independent of the LOC network
settlement claim.

See [plan 0018](../exec-plans/active/0018-livepeer-modules-v2-migration.md)
and [requirements](./requirements.md).
