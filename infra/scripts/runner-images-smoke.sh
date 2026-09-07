#!/bin/sh
set -eu

smoke_tag=${TAG:-v2-dev}
smoke_registry=${REGISTRY:-tztcloud}
script_dir=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
repo_root=$(CDPATH='' cd -- "$script_dir/../.." && pwd)
smoke_suffix=$$
smoke_names=""

cleanup() {
  for smoke_name in $smoke_names; do
    docker rm --force --volumes "$smoke_name" >/dev/null 2>&1 || true
  done
}
trap cleanup EXIT INT TERM

start_runner() {
  runner_kind=$1
  runner_target=$2
  runner_capability=$3
  runner_image="$smoke_registry/$runner_kind-runner:$smoke_tag-runtime-$runner_target"
  runner_name="$runner_kind-$runner_target-image-smoke-$smoke_suffix"
  runner_presets="$repo_root/$runner_kind-runner/testdata/image-smoke-presets.yaml"
  smoke_names="$smoke_names $runner_name"

  docker run --detach --name "$runner_name" \
    --publish 127.0.0.1::8080 \
    --env PRESETS_FILE=/smoke-presets.yaml \
    --mount "type=bind,src=$runner_presets,dst=/smoke-presets.yaml,readonly" \
    --label "livepeer.smoke.capability=$runner_capability" \
    "$runner_image" >/dev/null
}

for target in nvidia intel amd; do
  start_runner transcode "$target" video:transcode.vod
  start_runner abr "$target" video:transcode.abr
done

attempt=0
while [ "$attempt" -lt 45 ]; do
  pending=0
  for smoke_name in $smoke_names; do
    health=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' "$smoke_name")
    if [ "$health" = unhealthy ]; then
      docker logs "$smoke_name" >&2
      echo "$smoke_name became unhealthy" >&2
      exit 1
    fi
    if [ "$health" != healthy ]; then
      pending=1
    fi
  done
  if [ "$pending" -eq 0 ]; then
    break
  fi
  attempt=$((attempt + 1))
  sleep 1
done

if [ "$pending" -ne 0 ]; then
  for smoke_name in $smoke_names; do
    docker inspect --format '{{.Name}} state={{.State.Status}} health={{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' "$smoke_name" >&2
    docker logs "$smoke_name" >&2
  done
  exit 1
fi

for smoke_name in $smoke_names; do
  host_port=$(docker port "$smoke_name" 8080/tcp | sed -n '1s/.*://p')
  expected_capability=$(docker inspect --format '{{index .Config.Labels "livepeer.smoke.capability"}}' "$smoke_name")
  contract=$(curl --fail --silent --show-error "http://127.0.0.1:$host_port/.well-known/livepeer-runner")
  printf '%s' "$contract" | grep -F '"protocol":"paid-job/v1"' >/dev/null
  printf '%s' "$contract" | grep -F "\"capability_id\":\"$expected_capability\"" >/dev/null
  echo "$smoke_name healthy; discovery contract verified"
done

cleanup
trap - EXIT INT TERM
