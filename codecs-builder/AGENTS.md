# AGENTS.md

This is `codecs-builder/` — a Dockerfile-only base image that
compiles x264 / SVT-AV1 / libopus / libvpx / libzimg from source.
Both transcode runners (`../transcode-runner/`, `../abr-runner/`)
`FROM ${REGISTRY}/codecs-builder:${TAG}` in their Dockerfiles for the
ffmpeg compile stage.

Component-local agent map. Root [`../AGENTS.md`](../AGENTS.md) is the
cross-cutting map.

## Contents

Single `Dockerfile`. No Go, no source code, no Makefile beyond the
build/push helpers.

## Image artifact

- Image: `tztcloud/codecs-builder`
- Default tag: `v0.1.0` (this repo)
- Source repo uses `v1.2.0`; the runner Dockerfiles default to
  `v1.2.0` too. Override at runner build time with
  `--build-arg TAG=v0.1.0`.
- All libs install under `/usr/local/{lib,include}`. Downstream
  ffmpeg stages `COPY --from=codecs-builder /usr/local /usr/local`.

## Operating principles

Inherited from the repo root. Plus:

- **Build is slow.** ~20 minutes (compiles five libs from source). Run
  on CI / once per release.
- **Pinned codec versions.** x264 stable, SVT-AV1 v2.3.0, opus v1.5.2,
  libvpx v1.15.2, zimg 3.0.6. Don't bump silently
  ([core-beliefs §11](../../docs/design-docs/core-beliefs.md)).
- **Verbatim from source.** Dockerfile copied without edits from
  `livepeer-network-modules/video-runners/codecs-builder/Dockerfile`.

## Doing work

- `make build` — `docker build -t tztcloud/codecs-builder:v0.1.0 .`
- `make push` — push to registry
- `make help` — list targets

## What lives elsewhere

- `../transcode-runner/` — consumer (Dockerfile FROMs this image)
- `../abr-runner/` — consumer (same)
- `../transcode-core/` — Go library (no Docker; runners build against)
