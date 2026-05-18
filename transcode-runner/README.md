# transcode-runner

Single-rendition VOD transcode binary. Go + FFmpeg, behind the
capability-broker.

> **For agents:** start at [`AGENTS.md`](./AGENTS.md).

## Build + run

```sh
make build                            # go build .
make image TARGET=runtime-nvidia TAG=v0.1.0
make image TARGET=runtime-intel  TAG=v0.1.0
make image TARGET=runtime-amd    TAG=v0.1.0
```

The Dockerfile `FROM`s `tztcloud/codecs-builder:v1.2.0` by default;
override with `--build-arg TAG=...` and `--build-arg REGISTRY=...`.

## GPU passthrough

Operators supply one of:

- **NVIDIA NVENC** — `--gpus all` + nvidia-container-toolkit
- **Intel QSV** — `--device /dev/dri/renderD128` + `i965-va-driver`
- **AMD VAAPI** — `--device /dev/dri/renderD128` + `mesa-va-drivers`

## License

MIT — repo-root applies.
