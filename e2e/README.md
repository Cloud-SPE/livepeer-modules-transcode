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

## Coverage matrix

| Surface | Assertion |
|---|---|
| Boot      | `wire.{resolver,payerDaemon}.stub` + `storage.s3.connected` logged |
| Auth      | full signup → verify → approve → login → profile → rotate → logout |
| VOD       | POST /uploads → PUT to MinIO → POST :id/complete → POST /vod/submit asserts 503 `no_video_transcode_route` (stub resolver); list + detail work |
| Live      | POST /live/streams asserts 503 `resolver_not_configured` |
| HLS proxy | GET /_hls/foo asserts 404 `playback_session_not_found` |

## What's NOT covered

- Actual transcode (needs real broker + runner)
- Actual RTMP push (needs real encoder + working broker)
- Payment minting (needs real payment-daemon)
- Multi-broker resolver routing (needs real resolver socket)

Mocks for those services are a meaningful chunk of work; this smoke
deliberately stays at "the gateway degrades correctly without them."

## License

MIT — repo-root applies.
