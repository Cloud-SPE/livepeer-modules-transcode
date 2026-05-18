# transcode-core

Go shared library for the transcode runners. Package `transcode`.

> **For agents:** start at [`AGENTS.md`](./AGENTS.md).

## What's here

| File | Purpose |
|---|---|
| `ffmpeg.go` | FFmpeg command construction (per-rendition encode, probe) |
| `gpu.go` | GPU detection + HW profile (NVIDIA NVENC, Intel QSV, AMD VAAPI) |
| `presets.go` | Single-rendition encode presets |
| `abr_presets.go` | Multi-rendition (ABR ladder) presets from YAML |
| `hls.go` | HLS packaging args + master/variant playlist |
| `filters.go` | Video filter chain synthesis (scale, hwupload, format) |
| `progress.go` | ffmpeg stderr progress parsing |
| `thumbnail.go` | Thumbnail extraction args |
| `io.go` | URL / storage-key I/O helpers |

Plus `*_test.go` for each.

## Build / test

```sh
make test       # go test ./...
make vet        # go vet ./...
make fmt        # gofmt -l -w .
```

Requires Go ≥ 1.25 (declared in `go.mod`; auto-toolchain picks it
even on older `go` invocations from 1.21+).

## License

MIT — see repo-root [`../LICENSE`](../LICENSE) when added.
