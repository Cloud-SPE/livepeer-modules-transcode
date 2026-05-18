# AGENTS.md

This is `transcode-runner/` — the Go single-rendition VOD transcode
binary. Exposes `POST /v1/video/transcode` to the capability-broker,
runs FFmpeg per `presets.yaml`, reports progress via
`GET /v1/video/transcode/status?job_id=<id>`.

Component-local agent map. Root [`../AGENTS.md`](../AGENTS.md) is the
cross-cutting map.

## Surface

- `POST /v1/video/transcode` — submit a job (returns 202 + job id)
- `GET /v1/video/transcode/status?job_id=...` — poll
- `GET /v1/video/transcode/presets` — list embedded presets
- `GET /healthz` — 200 ready
- `GET /metrics` — Prometheus (opt-in via `METRICS_ENABLED=true`)

## Operating principles

Inherited from the repo root. Plus:

- **Blind to customer identity.** No customer auth, no billing, no
  payment validation. The capability-broker authenticates upstream
  and forwards paid requests; this runner sees only HTTP method +
  path + body + the informational `Livepeer-*` headers.
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
