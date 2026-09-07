#!/usr/bin/env bash
# Build all Livepeer Transcode Docker images in dependency order.
#
# Adapted from:
#   livepeer-network-modules/infra/scripts/build-images.sh
#
# Usage:
#   ./infra/scripts/build-images.sh
#   ./infra/scripts/build-images.sh codecs-builder transcode-runner
#   ./infra/scripts/build-images.sh abr-runner-nvidia live-runner-nvidia
#
# Filters are substring matches against the build key and image name. A
# filtered runner build expects REGISTRY/codecs-builder:TAG to exist locally;
# include codecs-builder explicitly when it does not.
#
# Env:
#   REGISTRY  default: tztcloud
#   TAG       default: v0.1.0 (from infra/build/image-versions.env)
#   VERSION   default: derived from the exact git tag or git SHA
#   PUSH      set to 1 to push deployable release images after each build

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

VERSION_ENV_FILE="${ROOT}/infra/build/image-versions.env"
if [[ -f "$VERSION_ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  . "$VERSION_ENV_FILE"
fi

REGISTRY="${REGISTRY:-tztcloud}"
TAG="${TAG:-${IMAGE_TAG_DEFAULT:-v0.1.0}}"
PUSH="${PUSH:-0}"
DEFAULT_VERSION="$(VERSION_PREFIX="$TAG" FALLBACK_VERSION="$TAG" ./infra/build/git-version.sh)"
VERSION="${VERSION:-$DEFAULT_VERSION}"
REVISION="$(git rev-parse HEAD 2>/dev/null || true)"
SOURCE_URL="${SOURCE_URL:-https://github.com/Cloud-SPE/livepeer-modules-transcode}"

log()  { printf '\033[1;34m[build]\033[0m %s\n' "$*" >&2; }
ok()   { printf '\033[1;32m[ ok ]\033[0m %s\n' "$*" >&2; }
fail() { printf '\033[1;31m[fail]\033[0m %s\n' "$*" >&2; exit 1; }

case "$PUSH" in
  0|1) ;;
  *) fail "PUSH must be 0 or 1, got: $PUSH" ;;
esac

# A local image is disposable. A pushed image must map to an exact, clean
# commit so another operator can reproduce it, including the absence of
# untracked build inputs.
if [[ "$PUSH" == "1" ]]; then
  git rev-parse --is-inside-work-tree >/dev/null 2>&1 || \
    fail "refusing to push outside a git work tree"
  if [[ -n "$(git status --porcelain --untracked-files=normal)" ]]; then
    printf '\033[1;31m[fail]\033[0m refusing to push: working tree has uncommitted changes\n' >&2
    printf '       version would be %s, which no commit can reproduce.\n' "$VERSION" >&2
    git status --short >&2
    exit 1
  fi
fi

declare -a GLOBAL_BUILD_ARGS=(
  "--build-arg=REGISTRY=${REGISTRY}"
  "--build-arg=TAG=${TAG}"
  "--build-arg=GO_VERSION=${GO_VERSION:-1.25.7}"
  "--build-arg=NODE_VERSION=${NODE_VERSION:-24}"
  "--build-arg=UBUNTU_VERSION=${UBUNTU_VERSION:-24.04}"
  "--build-arg=CUDA_VERSION=${CUDA_VERSION:-12.9.1}"
  "--label=org.opencontainers.image.source=${SOURCE_URL}"
  "--label=org.opencontainers.image.version=${VERSION}"
)
if [[ -n "$REVISION" ]]; then
  GLOBAL_BUILD_ARGS+=("--label=org.opencontainers.image.revision=${REVISION}")
fi

# Fields: key|image|context|dockerfile|target|tag_suffix|pushable
# The complete build keeps codecs-builder ahead of all images that FROM it.
declare -a IMAGES=(
  "codecs-builder|codecs-builder|codecs-builder|codecs-builder/Dockerfile|||0"
  "transcode-runner-nvidia|transcode-runner|.|transcode-runner/Dockerfile|runtime-nvidia|-runtime-nvidia|1"
  "transcode-runner-intel|transcode-runner|.|transcode-runner/Dockerfile|runtime-intel|-runtime-intel|1"
  "transcode-runner-amd|transcode-runner|.|transcode-runner/Dockerfile|runtime-amd|-runtime-amd|1"
  "abr-runner-nvidia|abr-runner|.|abr-runner/Dockerfile|runtime-nvidia|-runtime-nvidia|1"
  "abr-runner-intel|abr-runner|.|abr-runner/Dockerfile|runtime-intel|-runtime-intel|1"
  "abr-runner-amd|abr-runner|.|abr-runner/Dockerfile|runtime-amd|-runtime-amd|1"
  "live-runner-nvidia|live-runner-nvidia|.|live-runner/Dockerfile|runtime-nvidia||1"
  "live-runner-intel|live-runner-intel|.|live-runner/Dockerfile|runtime-intel||1"
  "live-runner-amd|live-runner-amd|.|live-runner/Dockerfile|runtime-amd||1"
  "live-runner-cpu|live-runner-cpu|.|live-runner/Dockerfile|runtime-cpu||1"
  "transcode-gateway|transcode-gateway|.|transcode-gateway/Dockerfile|runtime||1"
  "transcode-tester|transcode-tester|transcode-tester|transcode-tester/Dockerfile|||0"
)

filter_args=("$@")
declare -a SELECTED=()
if [[ ${#filter_args[@]} -eq 0 ]]; then
  SELECTED=("${IMAGES[@]}")
else
  for entry in "${IMAGES[@]}"; do
    IFS='|' read -r key image _ <<<"$entry"
    for filter in "${filter_args[@]}"; do
      if [[ "$key" == *"$filter"* || "$image" == *"$filter"* ]]; then
        SELECTED+=("$entry")
        break
      fi
    done
  done
  if [[ ${#SELECTED[@]} -eq 0 ]]; then
    fail "No images matched filter(s): ${filter_args[*]}"
  fi
fi

step=0
total=${#SELECTED[@]}
declare -a PUSHED_DIGESTS=()

log "registry=${REGISTRY} tag=${TAG} version=${VERSION} push=${PUSH} building ${total} image(s)"

for entry in "${SELECTED[@]}"; do
  step=$((step + 1))
  IFS='|' read -r key image context dockerfile target tag_suffix pushable <<<"$entry"
  full_tag="${REGISTRY}/${image}:${TAG}${tag_suffix}"

  args=(build -t "$full_tag" -f "$dockerfile")
  args+=("${GLOBAL_BUILD_ARGS[@]}")
  [[ -n "$target" ]] && args+=(--target "$target")
  args+=("$context")

  log "[$step/$total] $key -> $full_tag"
  docker "${args[@]}" || fail "build failed for $full_tag"
  ok "[$step/$total] $full_tag"

  if [[ "$PUSH" == "1" ]]; then
    if [[ "$pushable" != "1" ]]; then
      ok "[$step/$total] local-only image; skipping push for $full_tag"
      continue
    fi
    log "[$step/$total] pushing $full_tag"
    docker push "$full_tag" || fail "push failed for $full_tag"
    digest="$(docker inspect --format '{{if .RepoDigests}}{{index .RepoDigests 0}}{{end}}' "$full_tag" 2>/dev/null || true)"
    PUSHED_DIGESTS+=("${key}|${digest:-$full_tag (digest unavailable)}")
    ok "[$step/$total] pushed $full_tag"
  fi
done

ok "all $total image(s) built (registry=${REGISTRY} tag=${TAG})"

if [[ "$PUSH" == "1" && ${#PUSHED_DIGESTS[@]} -gt 0 ]]; then
  echo
  echo "Pin these digests in deployment configuration:"
  for entry in "${PUSHED_DIGESTS[@]}"; do
    printf '  %-28s %s\n' "${entry%%|*}" "${entry#*|}"
  done
fi
