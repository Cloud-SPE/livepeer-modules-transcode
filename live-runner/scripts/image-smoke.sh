#!/bin/sh
set -eu

smoke_image=${1:?image reference is required}
smoke_name="live-runner-image-smoke-$$"

cleanup() {
  docker rm --force "$smoke_name" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

docker run --detach --name "$smoke_name" \
  --env LIVE_RUNNER_MASTER_KEY=bW1tbW1tbW1tbW1tbW1tbW1tbW1tbW1tbW1tbW1tbW0= \
  --env LIVE_RUNNER_BROKER_TOKEN=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb \
  --env LIVE_RUNNER_INTERNAL_MEDIA_TOKEN=iiiiiiiiiiiiiiiiiiiiiiiiiiiiiiii \
  --env LIVE_RUNNER_PUBLIC_RTMP_URL=rtmp://runner.invalid/ingest \
  --env LIVE_RUNNER_PUBLIC_HLS_BASE=https://runner.invalid \
  --env LIVE_RUNNER_PUBLIC_API_BASE=https://runner.invalid \
  "$smoke_image" >/dev/null

smoke_attempt=0
while [ "$smoke_attempt" -lt 60 ]; do
  smoke_health=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' "$smoke_name")
  if [ "$smoke_health" = healthy ]; then
    break
  fi
  if [ "$smoke_health" = unhealthy ]; then
    echo "live-runner image became unhealthy" >&2
    exit 1
  fi
  smoke_attempt=$((smoke_attempt + 1))
  sleep 1
done
if [ "$smoke_health" != healthy ]; then
  echo "live-runner image did not become healthy" >&2
  exit 1
fi

docker stop --timeout 10 "$smoke_name" >/dev/null
smoke_exit=$(docker inspect --format '{{.State.ExitCode}}' "$smoke_name")
if [ "$smoke_exit" -ne 0 ]; then
  echo "live-runner image exited with status $smoke_exit" >&2
  exit 1
fi

cleanup
trap - EXIT INT TERM
