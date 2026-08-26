# AGENTS.md

This is `e2e/` — the cross-cutting end-to-end smoke. `make smoke` covers
the resolver-unavailable path without external Modules or LOC processes.

Component-local agent map. Root [`../AGENTS.md`](../AGENTS.md) is the
cross-cutting map.

## What the smoke covers

- Gateway boot logs the expected resolver-stub and storage messages
  (`wire.resolver.stub`, `storage.s3.connected`)
- Auth: waitlist signup → email verify (token recovered from gateway
  log) → admin approve → API key → login → profile
- VOD: presigned-PUT upload to MinIO → complete → submit (asserts
  503 `no_video_transcode_route` because resolver is stubbed) →
  list → detail
- Live: POST /v1/live/streams asserts 503 `resolver_not_configured`
- HLS proxy: GET `/_hls/foo` asserts 404 `playback_session_not_found`
- Auth rotate + logout regression

Actual transcode, RTMP push, and LOC settlement need peer services we do
not own. Those are covered by the Modules v2/LOC cross-repository release
matrix rather than local compatibility mocks.

## Operating principles

- **Docker-first.** `make smoke` brings up + drives + asserts in one
  step.
- **No host deps beyond docker + curl + bash.**
- **Asserts the documented degraded paths.** Failure of an asserted
  503/404 path is a smoke FAIL (we changed contract without thinking
  about it).

## Doing work

- `make up`     — bring the stack up
- `make smoke`  — full smoke (idempotent; first call brings up)
- `make logs`   — tail gateway logs
- `make down`   — tear down + drop volumes
- `make reset`  — fresh state

## What lives elsewhere

- `../transcode-gateway/` — backend being smoked
- `../transcode-gateway/scripts/smoke.sh` — auth-only smoke from
  plan 0002. This e2e smoke is the superset.
