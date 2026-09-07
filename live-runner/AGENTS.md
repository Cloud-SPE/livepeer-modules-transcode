# AGENTS.md

This is `live-runner/` — the Go runner for `paid-session/v1` live RTMP ingest
and LL-HLS output. Start at the repository-root [`AGENTS.md`](../AGENTS.md).

## Contract

The runner implements the capability-owned `rtmp-hls/v1` descriptor over the
Modules runner create/status/terminate seam. `contract.go` is the strict local
contract and `testdata/contracts/v1/` contains cross-repository fixtures.

The broker never carries media or interprets `session_params`. The runner
owns ingest, output, private stream-key issuance, cumulative `output_seconds`
events, and idempotent termination.

The attach contract is served only at `GET /.well-known/livepeer-runner`.
Public descriptor coordinates derive exclusively from
`LIVEPEER_PUBLIC_RTMP_URL` and `LIVEPEER_PUBLIC_URL`; the deleted
`LIVE_RUNNER_PUBLIC_*` variables are not accepted.

## Work rules

- All design docs and exec plans remain in root `docs/`.
- Never log create bodies, callback tokens, grant secrets, stream keys, or
  object-store credentials.
- Any source port must cite its exact read-only source path in the introducing
  commit message.
- Use `go test ./...`, `go test -race ./...`, and `go vet ./...`.
