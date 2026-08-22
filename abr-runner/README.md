# abr-runner

Multi-rendition VOD ABR ladder transcode binary. Go + FFmpeg, behind
the capability-broker.

> **For agents:** start at [`AGENTS.md`](./AGENTS.md).

Same shape as `../transcode-runner/`; emits a ladder of renditions
per request.

## Modules v2 contract

The v2 target is one terminal SSE exchange per complete ladder:

| Contract axis | Value |
|---|---|
| Paid protocol | `paid-job/v1` |
| Runner request descriptor | `video-transcode-abr/v2` |
| Progress descriptor | `video-transcode-abr-progress/v2` |
| Terminal descriptor | `video-transcode-abr-result/v2` (`succeeded` or `failed`) |
| Work unit | `video-frame-megapixel` |

Go types and validation are in `contract_v2.go`. Canonical JSON/SSE fixtures
are under `testdata/contracts/v2/`; their strict-decoding tests are the shared
starting point for the gateway, runner, Modules extractor, and LOC integration.
The current handler is not yet wired to this contract—Bead `lmt-65a.3.6`
replaces its asynchronous 202/poll execution.

### Request and output safety

The request contains a caller-stable `workload_id`, presigned input/output
URLs, a preset, and non-secret artifact references. Signed URLs are credentials:
the runner must never log the request body or echo them in progress, results,
or errors. Only stable `artifact_uri` values appear in a terminal result.
The request's canonical SHA-256 includes the complete body and is persisted
before execution. Canonical encoding uses the contract's struct field order,
lexically sorted rendition-map keys, UTF-8 JSON strings without HTML escaping,
and no insignificant whitespace; the checked-in request fixture pins the
cross-language hash.

The chosen preset's rendition names and `output.renditions` keys must match
exactly. Unknown fields fail strict boundary decoding. Each progress event has
a monotonically increasing SSE `id`, sequence, phase, bounded percentage, and
the workload/request identity. A comment keepalive is emitted at least every
10 seconds when no progress data is available.

### Idempotency and crash behavior

Runner idempotency is independent of broker idempotency:

- unseen `workload_id`: persist ID, request hash, and initial event before
  starting FFmpeg;
- identical in-flight replay: attach to/replay the durable event stream; never
  launch another execution;
- identical terminal replay: return the recorded terminal event and claim;
- same ID with different content: return `409 workload_id_reuse` before any
  output or compute side effect.

The implementation must journal completed rendition metadata and actual frame
counts. After restart it resumes from the last durable boundary and uses the
same destinations. If recovery is impossible, it emits one terminal failure,
publishes no manifest, treats partial objects as non-delivered, and reports
zero work units. No terminal `202` may hide continuing background work: the
SSE HTTP response starts promptly with status 200 and remains open through one
`result` or `error` event.

The file-backed journal implementation is `workload_store_v2.go`. It uses
atomic rename plus file and directory fsync, stores bounded safe SSE history,
and keeps prepared/delivered checkpoints separate. It deliberately persists
only request hashes and non-secret artifact metadata—the identical replayed
request supplies fresh in-memory access to its credential URLs. Runtime images
provide `/var/lib/abr-runner` as the persistent volume boundary.

### Usage

Successful delivery reports exactly:

```
ceil(sum(actual_frames_i * width_i * height_i) / 1_000_000)
```

The runner sums every delivered video rendition before applying one ceiling.
Omitting `video` marks an audio-only rendition and contributes zero. Integer
overflow is a terminal validation failure. A failed terminal event always
reports `video-frame-megapixel: 0`.

`actual_frames` is the decoded video-frame count measured from each completed
output with `ffprobe -count_frames`, before upload and terminal emission. Input
duration/FPS and the last FFmpeg progress line are estimates only; if an exact
output count cannot be obtained, the runner must fail rather than invent a
claim. Presigned URLs must remain valid for the funded runtime plus the agreed
recovery window because changing a URL changes the canonical request hash.

## Build + run

```sh
make build
make image TARGET=runtime-nvidia TAG=v0.1.0
make image TARGET=runtime-intel  TAG=v0.1.0
make image TARGET=runtime-amd    TAG=v0.1.0
```

## License

MIT — repo-root applies.
