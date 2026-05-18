---
plan: 0016
title: e2e/ — compose-stack smoke (gateway + postgres + S3-compat MinIO + fixture flows)
status: completed
phase: shipped
opened: 2026-05-18
closed: 2026-05-18
owner: harness
related:
  - "docs/exec-plans/completed/0002-auth-blueclaw-port.md (auth smoke this expands)"
  - "docs/exec-plans/completed/0005-vod-routes-port.md (VOD route shapes)"
  - "docs/exec-plans/completed/0006-live-pipeline-port.md (live route shapes)"
  - "docs/exec-plans/completed/0012-transcode-tester-port.md (runner smoke)"
---

# Plan 0016 — e2e compose-stack smoke

## 1. Problem

Each plan shipped its own local smoke (auth in 0002, S3-503 check in
0005, live-503 check in 0006, etc.). None exercise the **complete
stack** in one compose: gateway + postgres + S3-compat + the full
request shapes a real customer would hit.

This plan lands `e2e/` — a top-level compose project that brings up
the gateway with real postgres + real S3-compat (MinIO) and runs a
fixture-driven smoke against it. Real `capability-broker`,
`service-registry-daemon`, and `payment-daemon` are NOT included
(those are external peer services we don't own); the smoke uses
the gateway's stub fallback for those and asserts the documented
degraded behavior (`503 no_video_transcode_route`, `503
resolver_not_configured`).

## 2. Scope

In:
- Postgres 16 (real)
- MinIO (S3-compat; CHANGED from the plan-0002 compose which had no
  storage)
- Gateway with S3 wired, no resolver / no payer-daemon (stub fallback)
- A `smoke.sh` that drives:
  - auth flow (signup → verify → approve → login → profile → rotate
    → logout)
  - VOD upload flow (POST /v1/uploads → presigned PUT to MinIO →
    POST /v1/uploads/:id/complete → POST /v1/vod/submit → expect 503
    `no_video_transcode_route` because resolver is stubbed)
  - asset list, asset detail
  - live session-open: expect 503 `resolver_not_configured`
  - `/_hls/foo` proxy: expect 404 `playback_session_not_found`
  - RTMP listener: with env set, verify port 1935 LISTEN; without,
    not bound

Out (deferred — would need real peer services / runners):
- Actual transcode (needs real broker + runner)
- Actual RTMP push (needs real encoder + working broker)
- Multi-broker resolver behavior
- Payment-daemon ticket minting
- Recording handoff

## 3. Required invariants

- **Docker-first** per [core-beliefs §10](../../design-docs/core-beliefs.md):
  every gesture is a `make smoke` away.
- **No real peer-service dependencies** — keep the smoke runnable
  in CI without provisioning brokers / daemons.
- **Fixture-only inputs** — the smoke generates throwaway emails +
  asset ids per run; no manual state.

## 4. Execution

### 4.1 Files

```
e2e/
├── AGENTS.md
├── README.md
├── Makefile               # smoke, up, down, logs, reset, help
├── compose.yaml           # postgres + minio + gateway
├── .env.example           # sample env for the smoke
├── smoke.sh               # the full smoke driver
└── fixtures/
    └── tiny.mp4           # 1KB placeholder (S3-PUT smoke; not a real video)
```

~7 files.

### 4.2 compose.yaml

Services:
- `postgres:16-alpine` (matches transcode-gateway/compose.yaml)
- `minio/minio:latest` (S3-compat; bind console on 9001, S3 API on
  9000). Bootstrap a bucket via `mc` in a one-shot sidecar service.
- `gateway` — built from the repo's existing
  `transcode-gateway/Dockerfile`, wired with:
  - DATABASE_URL → postgres
  - ADMIN_TOKEN, API_KEY_HASH_PEPPER → from `.env`
  - S3_REGION + S3_BUCKET + S3_ACCESS_KEY_ID + S3_SECRET_ACCESS_KEY +
    S3_ENDPOINT → MinIO
  - S3_FORCE_PATH_STYLE=true (MinIO requires path-style)
  - LIVEPEER_RESOLVER_SOCKET / LIVEPEER_PAYER_SOCKET UNSET (stub
    fallback exercised by the smoke)

### 4.3 smoke.sh

Bash script. Exits non-zero on any unexpected response. Uses curl +
jq. Sequence:

1. Wait for gateway `/api/v1/health` → 200.
2. Auth: POST /waitlist, recover verify URL from gateway log, GET
   verify, admin approve → capture raw `tc_` key.
3. User: POST /user/login → capture session token; GET /user/profile.
4. VOD upload:
   - POST /v1/uploads with `{ filename: "tiny.mp4", content_type:
     "video/mp4" }` → capture `upload_url` + `asset_id` + `upload_id`
   - PUT the fixture bytes to `upload_url` (curl -X PUT) → 200/204
     from MinIO
   - POST /v1/uploads/:id/complete → 200
   - POST /v1/vod/submit `{ asset_id, encoding_tier: "standard" }`
     → expect 503 `no_video_transcode_route` (stub resolver)
5. VOD reads:
   - GET /v1/videos/assets → returns one row (the just-uploaded
     asset, status `preparing`)
   - GET /v1/videos/assets/:id → 200
6. Live:
   - POST /v1/live/streams → 503 `resolver_not_configured`
   - GET /_hls/anything → 404 `playback_session_not_found`
7. Rotate + logout + post-logout-401 check (regression from plan
   0002).

Exit 0 on success; non-zero on any unexpected status. Each step
prints a one-line `✓ step …` log so the failure point is obvious.

### 4.4 Makefile

```
make up        # docker compose up -d --build
make smoke     # up + run smoke.sh
make logs      # follow gateway logs
make down      # docker compose down -v
make reset     # down + up (fresh state)
make help
```

### 4.5 `.env.example`

```
ADMIN_TOKEN=dev-admin-token-1234567890
API_KEY_HASH_PEPPER=dev-pepper-1234567890
S3_ACCESS_KEY_ID=minioadmin
S3_SECRET_ACCESS_KEY=minioadmin
```

## 5. Acceptance

1. `make smoke` from a clean state exits 0 against a freshly-built
   stack.
2. Every step of the smoke prints `✓ step …`.
3. The gateway boot log shows `wire.resolver.stub`,
   `wire.payerDaemon.stub`, `storage.s3.connected` (proving the
   degraded paths are deliberate).
4. PLANS.md roadmap row 14 flips to ✅.
5. Plan moves to `completed/`.

## 6. Out of scope

- Real transcode end-to-end (needs broker + runner)
- Real RTMP push (needs encoder)
- Payment + resolver smokes (would need mocks; phase 2)
- CI workflow (separate concern; this plan only provides the
  smoke artifact)
- Frontend smoke (the three frontends have their own `pnpm build`
  acceptance; no headless-browser smoke in v0)

## 7. Decision log

| Date | Decision | Why |
|---|---|---|
| 2026-05-18 | MinIO (not RustFS or aws-cli mock) for S3 in the smoke | Single popular S3-compat image; `mc` for bootstrap; no extra deps |
| 2026-05-18 | Stub resolver + payer-daemon (no mocks) | Mocks of those services are a real chunk of work; the v0 acceptance is "gateway degrades correctly," not "full broker dispatch works" |
| 2026-05-18 | `e2e/` as a top-level component (not `transcode-gateway/test/integration/`) | Cross-cutting: the smoke spins up multiple services. Its own component dir keeps it independent of the gateway's package |
| 2026-05-18 | Bash + curl + jq for the driver (not Node) | Familiar; matches plan 0002's smoke.sh. No deps; runs in any Docker host |
| 2026-05-18 | Tiny non-video fixture (1KB binary) | The smoke validates the S3 PUT + complete-notify path, not the decode. A real video would just slow the test |
| 2026-05-18 | Single PR | Per [core-beliefs §13](../../design-docs/core-beliefs.md) |
