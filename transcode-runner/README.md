# transcode-runner

Single-rendition VOD transcode binary. Go + FFmpeg, behind the
capability-broker.

The `video-transcode-vod/v2` request is one synchronous `paid-job/v1`
exchange. The response is typed SSE and ends with an
`X-Livepeer-Work-Units` trailer containing delivered frame-megapixels.
Identical `workload_id` retries converge on the durable journal; changed
content under the same id is rejected. The runner-owned attach contract is
served at `GET /.well-known/livepeer-runner`.

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

When VOD, ABR, and live runners share one physical GPU, mount one host-shared
directory into every container and set `GPU_ADMISSION_LOCK` to the same clean,
absolute lock-file base path. VOD joins the batch cohort for each execution,
allowing batch concurrency while the live cohort is absent. An active live
cohort causes new VOD work to return `429 capacity_reached` before FFmpeg starts.
An invalid configured path fails runner startup. `/healthz` reports whether the
domain is configured and the cumulative rejection count without exposing the
path.

## License

MIT — repo-root applies.
