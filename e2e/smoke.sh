#!/usr/bin/env bash
# End-to-end compose-stack smoke. Brings up postgres + minio + gateway and
# drives the full auth + VOD + live + HLS-proxy shape. Real Modules, LOC,
# and resolver services are NOT wired; the smoke asserts the documented
# 503 degradation paths (no_video_transcode_route, resolver_not_configured).

set -euo pipefail

GATEWAY=${GATEWAY:-http://localhost:4000}
ADMIN_TOKEN=${ADMIN_TOKEN:-dev-admin-token-1234567890}
COMPOSE=${COMPOSE:-docker compose -f compose.yaml}
EMAIL="smoke-$(date +%s)@example.com"
FIXTURE=${FIXTURE:-fixtures/tiny.mp4}

step() { printf "\n\033[1;36m== %s ==\033[0m\n" "$1"; }
ok()   { printf "\033[1;32m  ✓ %s\033[0m\n" "$1"; }
fail() { printf "\033[1;31m  ✖ %s\033[0m\n" "$1"; exit 1; }

# ── Wait for gateway ──
step "wait for gateway /api/v1/health"
for i in $(seq 1 60); do
  if curl -fsS "$GATEWAY/api/v1/health" >/dev/null 2>&1; then ok "gateway up"; break; fi
  [[ $i -eq 60 ]] && fail "gateway never became ready"
  sleep 1
done

# ── Confirm wire degradation logs at boot ──
step "confirm wire stubs at boot"
LOGS=$($COMPOSE logs gateway 2>/dev/null)
echo "$LOGS" | grep -q "wire.resolver.stub" || fail "expected wire.resolver.stub log"
echo "$LOGS" | grep -q "storage.s3.connected" || fail "expected storage.s3.connected log"
ok "resolver stub + S3 wired"

# ── Auth ──
step "auth: signup $EMAIL"
curl -fsS -X POST "$GATEWAY/api/v1/waitlist" \
  -H 'content-type: application/json' \
  -d "{\"name\":\"Smoke\",\"email\":\"$EMAIL\"}" >/dev/null
ok "signup accepted"

step "auth: recover verify token from gateway log"
sleep 1
URL=$($COMPOSE logs --since 30s gateway 2>/dev/null \
  | grep -oE 'http[^"]+/api/v1/waitlist/verify\?token=[a-f0-9]+' | tail -1)
[[ -n "$URL" ]] || fail "no verify URL in gateway log"
TOKEN=${URL##*token=}
ok "token=${TOKEN:0:16}..."

step "auth: verify email"
curl -fsS "$GATEWAY/api/v1/waitlist/verify?token=$TOKEN" >/dev/null
ok "verified"

step "auth: admin approve"
ID=$(curl -fsS "$GATEWAY/api/v1/admin/waitlist?status=pending" \
  -H "authorization: Bearer $ADMIN_TOKEN" \
  | grep -oE '"id":"[^"]+"' | head -1 | cut -d'"' -f4)
[[ -n "$ID" ]] || fail "no pending id"
APPROVE=$(curl -fsS -X POST "$GATEWAY/api/v1/admin/waitlist/approve" \
  -H "authorization: Bearer $ADMIN_TOKEN" \
  -H 'content-type: application/json' \
  -d "{\"ids\":[\"$ID\"]}")
KEY=$(printf "%s" "$APPROVE" | grep -oE '"key":"tc_[^"]+"' | head -1 | cut -d'"' -f4)
[[ -n "$KEY" ]] || fail "no API key in approve response"
ok "API key issued (${KEY:0:12}...)"

step "auth: login + profile"
LOGIN=$(curl -fsS -X POST "$GATEWAY/api/v1/user/login" \
  -H 'content-type: application/json' \
  -d "{\"api_key\":\"$KEY\"}")
SESSION=$(printf "%s" "$LOGIN" | grep -oE '"session_token":"sess_[^"]+"' | head -1 | cut -d'"' -f4)
[[ -n "$SESSION" ]] || fail "no session token"
curl -fsS "$GATEWAY/api/v1/user/profile" -H "authorization: Bearer $SESSION" >/dev/null
ok "profile ok"

# ── VOD upload via MinIO ──
step "vod: POST /v1/uploads"
UPLOAD=$(curl -fsS -X POST "$GATEWAY/v1/uploads" \
  -H "authorization: Bearer $KEY" \
  -H 'content-type: application/json' \
  -d '{"filename":"tiny.mp4","content_type":"video/mp4"}')
UPLOAD_URL=$(printf "%s" "$UPLOAD" | grep -oE '"upload_url":"[^"]+"' | head -1 | cut -d'"' -f4)
ASSET_ID=$(printf "%s" "$UPLOAD" | grep -oE '"asset_id":"[^"]+"' | head -1 | cut -d'"' -f4)
UPLOAD_ID=$(printf "%s" "$UPLOAD" | grep -oE '"upload_id":"[^"]+"' | head -1 | cut -d'"' -f4)
[[ -n "$UPLOAD_URL" && -n "$ASSET_ID" && -n "$UPLOAD_ID" ]] || fail "upload init missing fields"
# Rewrite the presigned URL host: gateway returns minio:9000 (compose hostname),
# we hit it from the host as localhost:9000.
ok "asset_id=${ASSET_ID:0:14}..."

step "vod: PUT bytes to MinIO via presigned URL"
[[ -f "$FIXTURE" ]] || fail "fixture not found: $FIXTURE"
curl -fsS -X PUT "$UPLOAD_URL" \
  --resolve minio:9000:127.0.0.1 \
  -H "content-type: video/mp4" \
  --data-binary "@$FIXTURE" >/dev/null
ok "presigned PUT to MinIO succeeded"

step "vod: POST /v1/uploads/:id/complete"
curl -fsS -X POST "$GATEWAY/v1/uploads/$UPLOAD_ID/complete" \
  -H "authorization: Bearer $KEY" \
  -H 'content-type: application/json' -d '{}' >/dev/null
ok "upload completed"

step "vod: POST /v1/vod/submit (expect 503 no_video_transcode_route — stub resolver)"
CODE=$(curl -s -o /tmp/submit.json -w '%{http_code}' \
  -X POST "$GATEWAY/v1/vod/submit" \
  -H "authorization: Bearer $KEY" \
  -H 'content-type: application/json' \
  -d "{\"asset_id\":\"$ASSET_ID\"}")
[[ "$CODE" == "503" ]] || fail "expected 503, got $CODE: $(cat /tmp/submit.json)"
grep -q "no_video_transcode_route" /tmp/submit.json || fail "wrong error code: $(cat /tmp/submit.json)"
ok "stub resolver returned no_video_transcode_route as expected"

step "vod: list assets returns our just-uploaded row"
LIST=$(curl -fsS "$GATEWAY/v1/videos/assets" -H "authorization: Bearer $KEY")
printf "%s" "$LIST" | grep -q "$ASSET_ID" || fail "asset $ASSET_ID not in list"
ok "list contains the asset"

step "vod: get asset detail"
curl -fsS "$GATEWAY/v1/videos/assets/$ASSET_ID" -H "authorization: Bearer $KEY" >/dev/null
ok "asset detail ok"

# ── Live ──
step "live: POST /v1/live/streams (expect 503 resolver_not_configured)"
CODE=$(curl -s -o /tmp/live.json -w '%{http_code}' \
  -X POST "$GATEWAY/v1/live/streams" \
  -H "authorization: Bearer $KEY" \
  -H 'content-type: application/json' -d '{}')
[[ "$CODE" == "503" ]] || fail "expected 503, got $CODE: $(cat /tmp/live.json)"
grep -q "resolver_not_configured" /tmp/live.json || fail "wrong error: $(cat /tmp/live.json)"
ok "live route degraded as expected"

step "live: GET /_hls/foo/index.m3u8 (expect 404 playback_session_not_found)"
CODE=$(curl -s -o /tmp/hls.json -w '%{http_code}' "$GATEWAY/_hls/foo/index.m3u8")
[[ "$CODE" == "404" ]] || fail "expected 404, got $CODE: $(cat /tmp/hls.json)"
grep -q "playback_session_not_found" /tmp/hls.json || fail "wrong error: $(cat /tmp/hls.json)"
ok "hls proxy 404'd as expected"

# ── Rotate + logout ──
step "auth: rotate key (old session dies, new session works)"
ROTATE=$(curl -fsS -X POST "$GATEWAY/api/v1/user/rotate-key" \
  -H "authorization: Bearer $SESSION")
NEW_SESSION=$(printf "%s" "$ROTATE" | grep -oE '"session_token":"sess_[^"]+"' | head -1 | cut -d'"' -f4)
OLD_CODE=$(curl -s -o /dev/null -w '%{http_code}' \
  "$GATEWAY/api/v1/user/profile" -H "authorization: Bearer $SESSION")
[[ "$OLD_CODE" == "401" ]] || fail "old session should be 401, got $OLD_CODE"
NEW_CODE=$(curl -s -o /dev/null -w '%{http_code}' \
  "$GATEWAY/api/v1/user/profile" -H "authorization: Bearer $NEW_SESSION")
[[ "$NEW_CODE" == "200" ]] || fail "new session should be 200, got $NEW_CODE"
ok "rotate revokes old + accepts new"

step "auth: logout (post-logout 401)"
curl -fsS -X POST "$GATEWAY/api/v1/user/logout" \
  -H "authorization: Bearer $NEW_SESSION" >/dev/null
POST=$(curl -s -o /dev/null -w '%{http_code}' \
  "$GATEWAY/api/v1/user/profile" -H "authorization: Bearer $NEW_SESSION")
[[ "$POST" == "401" ]] || fail "post-logout should be 401, got $POST"
ok "logged out"

step "ALL GREEN — e2e smoke passed"
