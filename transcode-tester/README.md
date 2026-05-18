# transcode-tester

Node integration smoke harness for `transcode-runner` and
`abr-runner`. Submits a job, polls for status, validates the result.

> **For agents:** start at [`AGENTS.md`](./AGENTS.md).

## Usage

```sh
export OPENAI_BASE_URL=http://localhost:8090/v1   # the runner's base
node test-transcode.mjs quick
```

Set `INPUT_URL` to test with your own file; default is a freely-
licensed 10-second Big Buck Bunny clip.

`OUTPUT_URL` (optional) is a presigned PUT target; without it the
job fails at the upload step (still useful as a connectivity smoke).

## Docker

```sh
make build TAG=v0.1.0
make run-transcode OPENAI_BASE_URL=http://host.docker.internal:8090/v1
```

## License

MIT — repo-root applies.
