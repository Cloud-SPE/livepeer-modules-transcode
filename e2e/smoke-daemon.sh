#!/usr/bin/env bash
set -euo pipefail

GATEWAY=${GATEWAY:-http://localhost:4001}
ADMIN_TOKEN=${ADMIN_TOKEN:-dev-admin-token-1234567890}
COMPOSE=${COMPOSE:-docker compose -f compose.daemon.yaml}
EMAIL="daemon-smoke-$(date +%s)@example.com"
FIXTURE=${FIXTURE:-fixtures/tiny.mp4}

step() { printf "\n\033[1;36m== %s ==\033[0m\n" "$1"; }
ok()   { printf "\033[1;32m  ✓ %s\033[0m\n" "$1"; }
fail() { printf "\033[1;31m  ✖ %s\033[0m\n" "$1"; exit 1; }

step "compose up daemon-backed stack"
$COMPOSE up -d --build >/dev/null

step "wait for gateway /api/v1/health"
for i in $(seq 1 90); do
  if curl -fsS "$GATEWAY/api/v1/health" >/dev/null 2>&1; then ok "gateway up"; break; fi
  [[ $i -eq 90 ]] && fail "gateway never became ready"
  sleep 1
done

step "confirm resolver+payer connected at boot"
LOGS=$($COMPOSE logs gateway 2>/dev/null)
echo "$LOGS" | grep -q "wire.resolver.connected" || fail "expected wire.resolver.connected log"
echo "$LOGS" | grep -q "wire.payerDaemon.connected" || fail "expected wire.payerDaemon.connected log"
echo "$LOGS" | grep -q "storage.s3.connected" || fail "expected storage.s3.connected log"
ok "resolver+payer connected"

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

step "auth: verify + approve + login"
curl -fsS "$GATEWAY/api/v1/waitlist/verify?token=$TOKEN" >/dev/null
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
LOGIN=$(curl -fsS -X POST "$GATEWAY/api/v1/user/login" \
  -H 'content-type: application/json' \
  -d "{\"api_key\":\"$KEY\"}")
SESSION=$(printf "%s" "$LOGIN" | grep -oE '"session_token":"sess_[^"]+"' | head -1 | cut -d'"' -f4)
[[ -n "$SESSION" ]] || fail "no session token"
ok "api key + session issued"

step "vod: init upload"
UPLOAD=$(curl -fsS -X POST "$GATEWAY/v1/uploads" \
  -H "authorization: Bearer $KEY" \
  -H 'content-type: application/json' \
  -d '{"filename":"tiny.mp4","content_type":"video/mp4"}')
UPLOAD_URL=$(printf "%s" "$UPLOAD" | grep -oE '"upload_url":"[^"]+"' | head -1 | cut -d'"' -f4)
ASSET_ID=$(printf "%s" "$UPLOAD" | grep -oE '"asset_id":"[^"]+"' | head -1 | cut -d'"' -f4)
UPLOAD_ID=$(printf "%s" "$UPLOAD" | grep -oE '"upload_id":"[^"]+"' | head -1 | cut -d'"' -f4)
[[ -n "$UPLOAD_URL" && -n "$ASSET_ID" && -n "$UPLOAD_ID" ]] || fail "upload init missing fields"
ok "asset_id=${ASSET_ID:0:14}..."

step "vod: PUT bytes + complete upload"
[[ -f "$FIXTURE" ]] || fail "fixture not found: $FIXTURE"
curl -fsS -X PUT "$UPLOAD_URL" \
  --resolve minio:9000:127.0.0.1 \
  -H "content-type: video/mp4" \
  --data-binary "@$FIXTURE" >/dev/null
curl -fsS -X POST "$GATEWAY/v1/uploads/$UPLOAD_ID/complete" \
  -H "authorization: Bearer $KEY" \
  -H 'content-type: application/json' \
  -d '{}' >/dev/null
ok "upload completed"

step "vod: submit with real resolver+payer path"
SUBMIT=$(curl -fsS -X POST "$GATEWAY/v1/vod/submit" \
  -H "authorization: Bearer $KEY" \
  -H 'content-type: application/json' \
  -d "{\"asset_id\":\"$ASSET_ID\"}")
printf "%s" "$SUBMIT" | grep -q '"status":"queued"' || fail "submit did not queue: $SUBMIT"
printf "%s" "$SUBMIT" | grep -q '"selected_broker_url":"http://mock-broker:8080"' || fail "submit did not route through mock broker: $SUBMIT"
ok "submit accepted"

step "vod: wait until asset becomes ready"
DETAIL=""
for i in $(seq 1 60); do
  DETAIL=$(curl -fsS "$GATEWAY/v1/videos/assets/$ASSET_ID" -H "authorization: Bearer $KEY")
  if printf "%s" "$DETAIL" | grep -q '"status":"ready"'; then
    break
  fi
  [[ $i -eq 60 ]] && fail "asset never became ready: $DETAIL"
  sleep 1
done
PLAYBACK_ID=$(printf "%s" "$DETAIL" | grep -oE '"playback_id":"pb_[^"]+"' | head -1 | cut -d'"' -f4)
[[ -n "$PLAYBACK_ID" ]] || fail "ready asset missing playback_id: $DETAIL"
ok "asset ready with playback_id=${PLAYBACK_ID:0:10}..."

step "vod: playback URL returns signed manifest URL"
PLAYBACK=$(curl -fsS "$GATEWAY/v1/playback/$PLAYBACK_ID")
HLS_URL=$(printf "%s" "$PLAYBACK" | grep -oE '"hls_url":"[^"]+"' | head -1 | cut -d'"' -f4)
[[ -n "$HLS_URL" ]] || fail "playback route missing hls_url: $PLAYBACK"
ok "signed HLS URL returned"

step "vod: fetch stored master manifest from MinIO"
MANIFEST=$(curl -fsS --resolve minio:9000:127.0.0.1 "$HLS_URL")
printf "%s" "$MANIFEST" | grep -q '#EXTM3U' || fail "manifest missing EXTM3U header"
printf "%s" "$MANIFEST" | grep -q '#EXT-X-STREAM-INF' || fail "manifest missing variant entries"
ok "master manifest stored and readable"

step "daemon-backed smoke passed"
