---
plan: 0008
title: transcode-core — Go shared library (FFmpeg + GPU + presets + HLS + progress + thumbnails + filters)
status: completed
phase: shipped
opened: 2026-05-18
closed: 2026-05-18
owner: harness
related:
  - "docs/exec-plans/completed/0001-initial-port-roadmap.md §3.2 (renumbered queue)"
  - "docs/design-docs/transcode-pipeline.md (consumers of this library)"
  - "docs/design-docs/dependencies.md (Go ≥ 1.25.7 via .tool-versions)"
---

# Plan 0008 — transcode-core port

## 1. Problem

The transcode runners (plans 0009 `transcode-runner` + 0010
`abr-runner`) both consume a shared Go library that owns FFmpeg
command construction, GPU/vendor profile detection, codec presets, HLS
packaging, progress parsing, thumbnail generation, and filter
synthesis. The source repo ships this as
`livepeer-network-modules/video-runners/transcode-core/`.

This plan ports that library as a standalone Go module at
`transcode-core/` in this repo. The runners that follow will declare
it via a local `replace` directive in their own `go.mod`.

## 2. Required invariants

Per [core-beliefs.md](../../design-docs/core-beliefs.md):

- **§4 Read-only source.** Cite source paths in commit messages.
- **§10 Docker-first.** Library doesn't ship a Dockerfile (it's not a
  binary); the runners that consume it do.
- **§15 Latest stable deps.** Bump Go from source's `1.22` to
  `1.25.x` (matches `.tool-versions`). One dep: `yaml.v3` (latest).

## 3. Source inventory

22 files, ~4,718 lines:

| File | LOC | Purpose |
|---|---|---|
| `abr_presets.go` + `_test.go` | 130 + 296 | ABR ladder preset loading from YAML |
| `ffmpeg.go` + `_test.go` | 425 + 625 | Core ffmpeg command construction |
| `filters.go` + `_test.go` | 213 + 344 | Video filter chain synthesis |
| `gpu.go` + `_test.go` | 297 + 178 | GPU detection (NVIDIA/Intel/AMD) + HW profile |
| `hls.go` + `_test.go` | 288 + 401 | HLS packaging / segmenter args |
| `io.go` + `_test.go` | 147 + 171 | URL/path I/O helpers |
| `live.go` + `_test.go` | 85 + 237 | `LiveTranscodeCmd` (MPEG-TS pipe live transcode) — only used by its own test, not consumed by runners |
| `presets.go` + `_test.go` | 182 + 323 | Single-rendition preset loading |
| `progress.go` + `_test.go` | 95 + 132 | ffmpeg progress parser |
| `thumbnail.go` + `_test.go` | 62 + 87 | Thumbnail extraction args |

All files are package `transcode`. Only external dep is
`gopkg.in/yaml.v3`.

## 4. Execution

### 4.1 Module setup

Create `transcode-core/` with:

```
transcode-core/
├── AGENTS.md                 # component-local map; tiny
├── README.md                 # human overview
├── go.mod                    # module github.com/Cloud-SPE/livepeer-modules-transcode/transcode-core
├── go.sum
├── Makefile                  # test / vet / fmt / build
└── *.go + *_test.go          # ports
```

`go.mod`:

```
module github.com/Cloud-SPE/livepeer-modules-transcode/transcode-core

go 1.25

require gopkg.in/yaml.v3 v3.0.1
```

(`go 1.25` per [`.tool-versions`](../../../.tool-versions) — source
uses `1.22` but our toolchain pin is newer; auto-toolchain handles
either.)

### 4.2 File-by-file port

Every `.go` and `_test.go` ports **verbatim** except for:

- The package's import path moves from
  `github.com/Cloud-SPE/livepeer-network-modules/video-runners/transcode-core`
  to `github.com/Cloud-SPE/livepeer-modules-transcode/transcode-core`.
  None of the source files actually import themselves (they're all
  package `transcode`), so this is a `go.mod`-only change for
  *this* library. Runners that import it will use the new path in their
  own `go.mod` `require` line.
- **Drop `live.go` + `live_test.go`** (322 LOC, `LiveTranscodeCmd`).
  Unreferenced by any runner per plan 0001 §3.2. If plan 0007 needs an
  in-process FFmpeg fallback for gateway-side RTMP termination, the
  symbols re-port from source at that point.

### 4.3 Makefile

Per core-beliefs §10:

```
make build      # go build ./...
make test       # go test ./...
make vet        # go vet ./...
make fmt        # gofmt -l -w .
make help       # list targets
```

### 4.4 AGENTS.md + README.md

Component-local AGENTS.md (~40 lines) pointing back at root
[`AGENTS.md`](../../../AGENTS.md). Brief README explaining the library
boundary (no Docker; runners build against it).

### 4.5 Acceptance

1. `cd transcode-core && go test ./...` passes — all source tests
   green.
2. `go vet ./...` clean.
3. `go build ./...` succeeds.
4. `go.mod` declares the new module path; `go.sum` regenerated.
5. No file in `transcode-core/` references the source's `Cloud-SPE/livepeer-network-modules/`
   import path.
6. Component `AGENTS.md` + `README.md` + `Makefile` present.
7. `PLANS.md` roadmap row for phase 6 (transcode-core) flips to ✅.
8. This plan moves to `docs/exec-plans/completed/`.

## 5. Out of scope

- Dockerization — not a binary; the runners that consume it ship their
  own Dockerfiles (plans 0009 / 0010).
- Integration tests against real GPU hardware — unit tests cover
  command-construction; GPU exec lives at the runner layer.
- Custom FFmpeg builds — `codecs-builder` (plan 0011) ships the codec
  base image; this library just builds command lines.

## 6. Decision log

| Date | Decision | Why |
|---|---|---|
| 2026-05-18 | Drop `live.go` + `live_test.go` (not port) | Plan 0001 §3.2 originally instructed "delete unreferenced symbols." No runner consumes `LiveTranscodeCmd`; only its own test does. If plan 0007 needs in-process FFmpeg fallback for gateway RTMP termination, re-port the file at that point. Trade-off: 322 fewer LOC carried, leaner library |
| 2026-05-18 | Module path = `github.com/Cloud-SPE/livepeer-modules-transcode/transcode-core` | Mirrors repo path; matches source naming convention |
| 2026-05-18 | Bump Go to 1.25 (from source's 1.22) | Matches repo's `.tool-versions` pin. Go auto-toolchain handles older invocations |
| 2026-05-18 | Single PR per port (transcode-core, then transcode-runner, then abr-runner, then codecs-builder) | Per [core-beliefs §13](../../design-docs/core-beliefs.md) throughput-friendly. Each port is a verbatim copy; risk is low |
