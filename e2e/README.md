# e2e

End-to-end compose-stack smoke for the transcode module.

> **For agents:** start at [`AGENTS.md`](./AGENTS.md).

## Run

```sh
cp .env.example .env       # or set the four env vars by hand
make smoke
```

`make smoke` brings up postgres + MinIO + the gateway, waits for
readiness, then drives the full auth + VOD + live + HLS-proxy shape.
Exits 0 on success; loud failure messages otherwise.

`make smoke-daemon` brings up the same stack plus contract-level mock
resolver, payer-daemon, and broker services. It exercises the real
gateway wire path for VOD submit and waits for the asset to become
`ready`.

## Coverage matrix

### `make smoke` — stub-path regression

| Surface | Assertion |
|---|---|
| Boot      | `wire.{resolver,payerDaemon}.stub` + `storage.s3.connected` logged |
| Auth      | full signup → verify → approve → login → profile → rotate → logout |
| VOD       | POST /uploads → PUT to MinIO → POST :id/complete → POST /vod/submit asserts 503 `no_video_transcode_route` (stub resolver); list + detail work |
| Live      | POST /live/streams asserts 503 `resolver_not_configured` |
| HLS proxy | GET /_hls/foo asserts 404 `playback_session_not_found` |

### `make smoke-daemon` — daemon-backed VOD path

| Surface | Assertion |
|---|---|
| Boot | `wire.resolver.connected` + `wire.payerDaemon.connected` + `storage.s3.connected` logged |
| Auth | full signup → verify → approve → login |
| VOD upload | presigned PUT to MinIO succeeds; upload completes |
| VOD dispatch | `POST /v1/vod/submit` returns `202 queued` with `selected_broker_url` from resolver |
| VOD execution | background probe + encode + finalize complete; asset reaches `ready` |
| Playback | `GET /v1/playback/:id` returns signed manifest URL |
| Storage | signed manifest URL fetches a valid HLS master playlist from MinIO |

## What's NOT covered

- Actual transcode (needs real broker + runner)
- Actual RTMP push (needs real encoder + working broker)
- Payment minting (needs real payment-daemon)
- Multi-broker resolver routing (needs real resolver socket)

Mocks for those services are a meaningful chunk of work; the default
smoke deliberately stays at "the gateway degrades correctly without
them." The daemon-backed smoke adds real gateway wire-path coverage
without depending on upstream daemon binaries.

For real gateway wire coverage against contract-level mocks, use
`make smoke-daemon`.

## License

MIT — repo-root applies.
