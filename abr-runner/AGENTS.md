# AGENTS.md

This is `abr-runner/` — the Go multi-rendition (ABR ladder) VOD
transcode binary. Exposes `POST /v1/video/transcode/abr`. Same shape
as `../transcode-runner/` but emits one playback ladder per request
instead of one rendition.

Component-local agent map. Root [`../AGENTS.md`](../AGENTS.md) is the
cross-cutting map.

## Surface

- `POST /v1/video/transcode/abr` — submit an ABR ladder job
- `GET /v1/video/transcode/abr/status?job_id=...` — poll
- `GET /v1/video/transcode/abr/presets` — list embedded ladder presets
- `GET /healthz` — 200 ready
- `GET /metrics` — Prometheus (opt-in via `METRICS_ENABLED=true`)

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
