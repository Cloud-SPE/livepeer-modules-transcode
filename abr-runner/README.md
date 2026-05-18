# abr-runner

Multi-rendition VOD ABR ladder transcode binary. Go + FFmpeg, behind
the capability-broker.

> **For agents:** start at [`AGENTS.md`](./AGENTS.md).

Same shape as `../transcode-runner/`; emits a ladder of renditions
per request.

## Build + run

```sh
make build
make image TARGET=runtime-nvidia TAG=v0.1.0
make image TARGET=runtime-intel  TAG=v0.1.0
make image TARGET=runtime-amd    TAG=v0.1.0
```

## License

MIT — repo-root applies.
