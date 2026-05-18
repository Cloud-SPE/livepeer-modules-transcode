# AGENTS.md

This is `transcode-tester/` — a Node smoke harness for the transcode
runners. Two scripts:

- `test-transcode.mjs` — submits a single-rendition VOD job to
  `transcode-runner` and polls for status.
- `test-abr.mjs` — same shape for `abr-runner`.

Component-local agent map. Root [`../AGENTS.md`](../AGENTS.md) is the
cross-cutting map.

## Operating principles

Inherited from the repo root. Plus:

- **No runtime deps.** Pure `fetch` + Node 22+.
- **Env var name is `OPENAI_BASE_URL`** — misnomer carried over from
  source's earlier OpenAI-shaped tooling. Points at the runner's
  `/v1/video/transcode*` endpoints; despite the name, no OpenAI
  involvement.

## Usage

```sh
# point at a running runner
export OPENAI_BASE_URL=http://localhost:8090/v1

node test-transcode.mjs quick    # submit + poll + validate
node test-transcode.mjs presets  # list presets
node test-abr.mjs quick
```

Or via Docker:

```sh
make build TAG=v0.1.0
make run-transcode OPENAI_BASE_URL=http://localhost:8090/v1
```

## What lives elsewhere

- `../transcode-runner/` — runner this harness exercises
- `../abr-runner/` — sibling ABR runner
- `../docs/exec-plans/active/0016-e2e-smoke.md` (planned) — full
  compose-stack smoke that includes this tester
