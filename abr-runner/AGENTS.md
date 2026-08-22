# AGENTS.md

This is `abr-runner/` — the Go multi-rendition (ABR ladder) VOD
transcode binary. Exposes `POST /v1/video/transcode/abr`. Same shape
as `../transcode-runner/` but emits one playback ladder per request
instead of one rendition.

Component-local agent map. Root [`../AGENTS.md`](../AGENTS.md) is the
cross-cutting map.

## Surface

Current surface:

- `POST /v1/video/transcode/abr` — terminal Modules v2 SSE exchange
- `GET /v1/video/transcode/abr/presets` — list embedded ladder presets
- `GET /healthz` — 200 ready
- `GET /metrics` — Prometheus (opt-in via `METRICS_ENABLED=true`)

The POST route stays behind the broker and returns one terminal SSE response
using the versioned contracts in `contract_v2.go`. It has no 202/poll path.
Fixtures live in `testdata/contracts/v2/`; implementation is tracked by
`lmt-65a.3.6`.

## Operating principles

Inherited from the repo root + same as `../transcode-runner/AGENTS.md`:
runner is blind to customer identity, GPU passthrough is
operator-supplied, amd64-only.

## Doing work in this component

- `make test` — `go test ./...`
- `make build` — `go build .`
- `make image TARGET=runtime-nvidia TAG=v0.1.0`
- Go 1.25 (auto-toolchain via `go.mod`)
- Depends on `../transcode-core` via local `replace`
- Commit messages cite source:
  `Modeled on livepeer-network-modules/video-runners/abr-runner/main.go`

## What lives elsewhere

- `../transcode-core/` — shared library
- `../codecs-builder/` — Docker base image
- `../transcode-runner/` — sibling single-rendition binary
- `../transcode-tester/` — Node integration smoke harness
