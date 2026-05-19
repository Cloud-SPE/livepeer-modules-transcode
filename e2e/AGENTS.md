# AGENTS.md

This is `e2e/` — the cross-cutting end-to-end smoke. It now has two
variants:

- `make smoke` — stub-path smoke (resolver / payer-daemon unset)
- `make smoke-daemon` — daemon-backed smoke with contract-level mock
  resolver, payer-daemon, and broker services

Component-local agent map. Root [`../AGENTS.md`](../AGENTS.md) is the
cross-cutting map.

## What the smoke covers

- Gateway boot logs the expected wire-stub messages
  (`wire.resolver.stub`, `wire.payerDaemon.stub`,
  `storage.s3.connected`)
- Auth: waitlist signup → email verify (token recovered from gateway
  log) → admin approve → API key → login → profile
- VOD: presigned-PUT upload to MinIO → complete → submit (asserts
  503 `no_video_transcode_route` because resolver is stubbed) →
  list → detail
- Live: POST /v1/live/streams asserts 503 `resolver_not_configured`
- HLS proxy: GET `/_hls/foo` asserts 404 `playback_session_not_found`
- Auth rotate + logout regression

Anything more (actual transcode, RTMP push, payment minting) needs
peer services we don't own — deferred to a future plan with mocks.

The daemon-backed smoke does cover the real gateway-side resolver and
payment-daemon code paths, but it still uses mocks rather than the
upstream daemon binaries.

Daemon-backed scope:

- mock resolver exposes real `SelectMany` over gRPC unix socket
- mock payer-daemon exposes real `PayerDaemon.CreatePayment` over gRPC unix socket
- mock broker accepts paid HTTP probe/transcode calls
- smoke waits for asset `ready` and fetches the stored HLS master manifest

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
- `make smoke-daemon` — daemon-backed smoke with mock resolver / payer / broker
- `make logs`   — tail gateway logs
- `make down`   — tear down + drop volumes
- `make reset`  — fresh state

## What lives elsewhere

- `../transcode-gateway/` — backend being smoked
- `../transcode-gateway/scripts/smoke.sh` — auth-only smoke from
  plan 0002. This e2e smoke is the superset.
