#!/usr/bin/env bash
# End-to-end smoke for the auth surface. Run via `make smoke`.
#
# Assumes:
#   - `make smoke` brought up compose with gateway on host:4000 and postgres on host:5432
#   - ADMIN_TOKEN matches compose.yaml (`dev-admin-token-change-me`)
#   - RESEND_API_KEY is unset (emails are logged as `email.dryrun`)
#
# The verification token is recovered by greping the gateway's container
# logs for the verify URL emitted by the dryrun email path.

set -euo pipefail

GATEWAY=${GATEWAY:-http://localhost:4000}
ADMIN_TOKEN=${ADMIN_TOKEN:-dev-admin-token-change-me}
COMPOSE=${COMPOSE:-docker compose -f compose.yaml}
EMAIL="smoke-$(date +%s)@example.com"

say() { printf "\n\033[1;36m== %s ==\033[0m\n" "$1"; }

say "health"
curl -fsS "$GATEWAY/api/v1/health" | tee /dev/stderr

say "signup $EMAIL"
curl -fsS -X POST "$GATEWAY/api/v1/waitlist" \
  -H "content-type: application/json" \
  -d "{\"name\":\"Smoke User\",\"email\":\"$EMAIL\"}" | tee /dev/stderr

# Recover the verify URL from the dryrun email log. Wait briefly for
# the fire-and-forget email job to land in the container's log.
sleep 1
say "recover verify token from dryrun email log"
LOG=$($COMPOSE logs --since 30s gateway 2>/dev/null || true)
URL=$(printf "%s" "$LOG" | grep -oE 'http[^"]+/api/v1/waitlist/verify\?token=[a-f0-9]+' | tail -1)
if [[ -z "$URL" ]]; then
  echo "ERROR: could not find verify URL in gateway logs"
  exit 1
fi
TOKEN=${URL##*token=}
echo "token=$TOKEN"

say "verify email"
curl -fsS "$GATEWAY/api/v1/waitlist/verify?token=$TOKEN" | tee /dev/stderr

say "admin list (pending)"
LIST=$(curl -fsS "$GATEWAY/api/v1/admin/waitlist?status=pending&per_page=5" \
  -H "authorization: Bearer $ADMIN_TOKEN")
echo "$LIST"
ID=$(printf "%s" "$LIST" | grep -oE '"id":"[^"]+"' | head -1 | cut -d'"' -f4)
echo "id=$ID"

say "admin approve"
APPROVE=$(curl -fsS -X POST "$GATEWAY/api/v1/admin/waitlist/approve" \
  -H "authorization: Bearer $ADMIN_TOKEN" \
  -H "content-type: application/json" \
  -d "{\"ids\":[\"$ID\"],\"send_emails\":true}")
echo "$APPROVE"
KEY=$(printf "%s" "$APPROVE" | grep -oE '"key":"tc_[^"]+"' | head -1 | cut -d'"' -f4)
echo "key=$KEY"

say "login with key"
LOGIN=$(curl -fsS -X POST "$GATEWAY/api/v1/user/login" \
  -H "content-type: application/json" \
  -d "{\"api_key\":\"$KEY\"}")
echo "$LOGIN"
SESSION=$(printf "%s" "$LOGIN" | grep -oE '"session_token":"sess_[^"]+"' | head -1 | cut -d'"' -f4)
echo "session=$SESSION"

say "profile (session)"
curl -fsS "$GATEWAY/api/v1/user/profile" \
  -H "authorization: Bearer $SESSION" | tee /dev/stderr

say "rotate key"
ROTATE=$(curl -fsS -X POST "$GATEWAY/api/v1/user/rotate-key" \
  -H "authorization: Bearer $SESSION")
echo "$ROTATE"
NEW_SESSION=$(printf "%s" "$ROTATE" | grep -oE '"session_token":"sess_[^"]+"' | head -1 | cut -d'"' -f4)
echo "new_session=$NEW_SESSION"

say "old session is dead after rotation"
OLD_STATUS=$(curl -s -o /dev/null -w '%{http_code}' \
  "$GATEWAY/api/v1/user/profile" \
  -H "authorization: Bearer $SESSION")
if [[ "$OLD_STATUS" != "401" ]]; then
  echo "ERROR: expected 401 from old session, got $OLD_STATUS"
  exit 1
fi
echo "old session → 401 ✓"

say "new session works"
curl -fsS "$GATEWAY/api/v1/user/profile" \
  -H "authorization: Bearer $NEW_SESSION" | tee /dev/stderr

say "logout"
curl -fsS -X POST "$GATEWAY/api/v1/user/logout" \
  -H "authorization: Bearer $NEW_SESSION" | tee /dev/stderr

say "post-logout session is dead"
OUT_STATUS=$(curl -s -o /dev/null -w '%{http_code}' \
  "$GATEWAY/api/v1/user/profile" \
  -H "authorization: Bearer $NEW_SESSION")
if [[ "$OUT_STATUS" != "401" ]]; then
  echo "ERROR: expected 401 after logout, got $OUT_STATUS"
  exit 1
fi
echo "post-logout → 401 ✓"

say "SMOKE PASSED"
