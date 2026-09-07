# AGENTS.md

This is `transcode-runner/` — the Go single-rendition VOD transcode
binary. Exposes synchronous `POST /v1/video/transcode` to the
capability-broker and streams typed progress plus the terminal outcome.

Component-local agent map. Root [`../AGENTS.md`](../AGENTS.md) is the
cross-cutting map.

## Surface

- `POST /v1/video/transcode` — synchronous `video-transcode-vod/v2` SSE exchange
- `GET /.well-known/livepeer-runner` — authoritative runner contract
- `GET /v1/video/transcode/presets` — list embedded presets
- `GET /healthz` — 200 ready
- `GET /metrics` — Prometheus (opt-in via `METRICS_ENABLED=true`)

## Operating principles

Inherited from the repo root. Plus:

- **Blind to customer identity.** No customer auth, no billing, no
  payment validation. The capability-broker authenticates upstream
  and forwards paid requests; this runner sees only HTTP method +
  path + body + the informational `Livepeer-*` headers.
- **Durable workload identity.** `workload_id` plus the canonical request hash
  converges retries on one execution and one recorded terminal result.
- **Runner-measured billing.** The terminal `X-Livepeer-Work-Units` trailer is
  `ceil(actual_frames × delivered_width × delivered_height / 1,000,000)`.
- **GPU passthrough is operator-supplied** — NVENC (`--gpus all` +
  nvidia-container-toolkit), QSV (`/dev/dri/renderD128` +
  `i965-va-driver`), VAAPI (same device + `mesa-va-drivers`).
- **amd64-only.** GPU drivers are x86-only in practice for v0.

## Doing work in this component

- `make test` — `go test ./...`
- `make build` — `go build .`
- `make image TARGET=runtime-nvidia TAG=v0.1.0` — Docker build (one of
  the three GPU variants)
- Go 1.25 (auto-toolchain via `go.mod`)
- Depends on `../transcode-core` (local `replace` in `go.mod`)
- Commit messages cite source paths, e.g.:
  `Modeled on livepeer-network-modules/video-runners/transcode-runner/main.go`

## What lives elsewhere

- `../transcode-core/` — shared library
- `../codecs-builder/` — Docker base image this Dockerfile `FROM`s
- `../abr-runner/` — sibling multi-rendition binary (same shape)
- `../transcode-tester/` — Node integration smoke harness
