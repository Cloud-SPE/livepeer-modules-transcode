# AGENTS.md

This is `transcode-core/` — the Go shared library for the transcode
module's runner binaries. Package: `transcode`.

Component-local agent map. Root [`../AGENTS.md`](../AGENTS.md) is the
cross-cutting map.

## What this library owns

- **FFmpeg command construction** (`ffmpeg.go`) — building encode commands
  for VOD per-rendition or per-tier
- **GPU detection + HW profiles** (`gpu.go`) — NVIDIA NVENC / Intel QSV /
  AMD VAAPI inventory and capability strings
- **Codec presets** (`presets.go`) — single-rendition speed/quality preset
  table and lookup
- **ABR presets** (`abr_presets.go`) — multi-rendition ladder loading
  from YAML
- **HLS packaging** (`hls.go`) — segmenter args, master + variant
  playlist construction
- **Filters** (`filters.go`) — video filter chain synthesis (scale,
  hwupload, format conversion)
- **Progress parsing** (`progress.go`) — ffmpeg stderr progress
  extraction
- **Thumbnails** (`thumbnail.go`) — thumbnail extraction args
- **I/O helpers** (`io.go`) — URL/path utilities used by the above

## What it does NOT own

- A binary entry point — runners (`transcode-runner/`, `abr-runner/`)
  do that
- A Dockerfile — runners ship their own
- Live (RTMP / MPEG-TS pipe) transcoding — `live.go` from source was
  intentionally dropped per plan 0008 decision log (no consumer; will
  re-port if plan 0007 needs it)
- Custom FFmpeg builds — see `codecs-builder/` (plan 0011) for the
  base image with x264 / SVT-AV1 / libopus / libvpx / libzimg

## Operating principles

Inherited from the repo root. Plus:

- **No imports of repo-internal packages.** This library has zero
  internal coupling; only depends on `gopkg.in/yaml.v3` and the
  standard library. Keeps it portable across runners.
- **Pure functions where possible.** Command-builders return
  `*exec.Cmd` without running them. Progress / GPU helpers are
  stateless.
- **Tests cover command-construction.** No GPU-required tests (those
  live at the runner layer).

## Doing work in this component

- `make test` — `go test ./...`
- `make vet` — `go vet ./...`
- `make fmt` — `gofmt -l -w .`
- Go 1.25 (auto-toolchain via `go.mod`). Source pinned 1.22; we
  bumped to match `.tool-versions`.
- Commit messages cite source paths, e.g.:
  `Modeled on livepeer-network-modules/video-runners/transcode-core/ffmpeg.go`.

## What lives elsewhere

- `transcode-runner/` (plan 0009) — single-rendition VOD binary that
  imports this library via `replace` in its `go.mod`.
- `abr-runner/` (plan 0010) — multi-rendition ABR binary; same
  `replace` pattern.
- `codecs-builder/` (plan 0011) — Dockerfile-only base image both
  runners' Dockerfiles `FROM`.
