# codecs-builder

Dockerfile-only base image that compiles x264, SVT-AV1, libopus,
libvpx, and libzimg from source. Both transcode runners FROM this
image for their FFmpeg compile stage.

> **For agents:** start at [`AGENTS.md`](./AGENTS.md).

## Build

```sh
make build TAG=v0.1.0
make push  TAG=v0.1.0
```

Build takes ~20 minutes (compiles five codec libs from source).
Image is ~1.2 GB.

## Codec versions

| Lib | Version | Source |
|---|---|---|
| x264 | stable | https://github.com/mirror/x264 |
| SVT-AV1 | v2.3.0 | https://gitlab.com/AOMediaCodec/SVT-AV1 |
| libopus | v1.5.2 | https://github.com/xiph/opus |
| libvpx | v1.15.2 | https://github.com/webmproject/libvpx |
| libzimg | 3.0.6 | https://github.com/sekrit-twc/zimg |

Pinned per [core-beliefs §11](../docs/design-docs/core-beliefs.md);
don't bump silently.

## License

MIT — repo-root applies. Note that the compiled codec libs carry
their own licenses (x264 = GPL when enabled with `--enable-gpl`).

## How it's consumed

Each runner's Dockerfile has:

```Dockerfile
ARG CODECS_IMAGE=${REGISTRY}/codecs-builder:${TAG}
FROM ${CODECS_IMAGE} AS codecs-builder
...
COPY --from=codecs-builder /usr/local /usr/local
```
