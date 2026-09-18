#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="${ROOT}/infra/scripts/build-images.sh"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

export DOCKER_LOG="${TMP_DIR}/docker.log"

cat >"${TMP_DIR}/docker" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"$DOCKER_LOG"
if [[ "${1:-}" == "inspect" ]]; then
  image="${@: -1}"
  printf '%s@sha256:test-digest\n' "${image%:*}"
fi
EOF

cat >"${TMP_DIR}/git" <<'EOF'
#!/usr/bin/env bash
case "${1:-} ${2:-}" in
  "rev-parse --short=12") printf '%s\n' '0123456789ab' ;;
  "rev-parse HEAD") printf '%s\n' '0123456789abcdef0123456789abcdef01234567' ;;
  "rev-parse --is-inside-work-tree") printf '%s\n' 'true' ;;
  "describe --tags") exit 1 ;;
  "status --porcelain") [[ "${FAKE_GIT_DIRTY:-0}" == "1" ]] && printf '%s\n' ' M dirty-file' ;;
  "status --short") [[ "${FAKE_GIT_DIRTY:-0}" == "1" ]] && printf '%s\n' ' M dirty-file' ;;
  *) exit 1 ;;
esac
EOF

chmod +x "${TMP_DIR}/docker" "${TMP_DIR}/git"

PATH="${TMP_DIR}:${PATH}" REGISTRY=example.test TAG=test "$SCRIPT" >/dev/null 2>&1
[[ "$(wc -l <"$DOCKER_LOG")" -eq 13 ]]
sed -n '1p' "$DOCKER_LOG" | grep -Fq 'build -t example.test/codecs-builder:test -f codecs-builder/Dockerfile'
sed -n '2p' "$DOCKER_LOG" | grep -Fq 'build -t example.test/transcode-runner:test-runtime-nvidia -f transcode-runner/Dockerfile'
sed -n '2p' "$DOCKER_LOG" | grep -Fq -- '--target runtime-nvidia .'
sed -n '8p' "$DOCKER_LOG" | grep -Fq 'build -t example.test/live-runner-nvidia:test -f live-runner/Dockerfile'
sed -n '8p' "$DOCKER_LOG" | grep -Fq -- '--target runtime-nvidia .'
sed -n '9p' "$DOCKER_LOG" | grep -Fq 'build -t example.test/live-runner-intel:test -f live-runner/Dockerfile'
sed -n '9p' "$DOCKER_LOG" | grep -Fq -- '--target runtime-intel .'
sed -n '10p' "$DOCKER_LOG" | grep -Fq 'build -t example.test/live-runner-amd:test -f live-runner/Dockerfile'
sed -n '10p' "$DOCKER_LOG" | grep -Fq -- '--target runtime-amd .'
sed -n '11p' "$DOCKER_LOG" | grep -Fq 'build -t example.test/live-runner-cpu:test -f live-runner/Dockerfile'
sed -n '11p' "$DOCKER_LOG" | grep -Fq -- '--target runtime-cpu .'
sed -n '13p' "$DOCKER_LOG" | grep -Fq 'build -t example.test/transcode-tester:test -f transcode-tester/Dockerfile'

: >"$DOCKER_LOG"
PATH="${TMP_DIR}:${PATH}" REGISTRY=example.test TAG=test "$SCRIPT" abr-runner-intel >/dev/null 2>&1
[[ "$(wc -l <"$DOCKER_LOG")" -eq 1 ]]
grep -Fq 'example.test/abr-runner:test-runtime-intel' "$DOCKER_LOG"
grep -Fq -- '--target runtime-intel .' "$DOCKER_LOG"

# The selected release tag must reach the codec base, independently of output tags.
grep -Fq -- '--build-arg=CODECS_IMAGE=example.test/codecs-builder:test' "$DOCKER_LOG"
: >"$DOCKER_LOG"
PATH="${TMP_DIR}:${PATH}" CODECS_IMAGE=example.test/codecs@sha256:reviewed \
  TAG=test "$SCRIPT" transcode-runner-nvidia >/dev/null 2>&1
grep -Fq -- '--build-arg=CODECS_IMAGE=example.test/codecs@sha256:reviewed' "$DOCKER_LOG"

for component in transcode-runner abr-runner; do
  : >"$DOCKER_LOG"
  PATH="${TMP_DIR}:${PATH}" make -s -C "$ROOT/$component" image \
    REGISTRY=example.test TAG=test TARGET=runtime-intel >/dev/null 2>&1
  grep -Fq -- '--build-arg CODECS_IMAGE=example.test/codecs-builder:test' "$DOCKER_LOG"
  grep -Fq -- "-t example.test/$component:test-runtime-intel" "$DOCKER_LOG"
  grep -Fq -- 'org.opencontainers.image.revision=0123456789abcdef0123456789abcdef01234567' "$DOCKER_LOG"
  : >"$DOCKER_LOG"
  PATH="${TMP_DIR}:${PATH}" make -s -C "$ROOT/$component" image \
    TAG=test CODECS_IMAGE=example.test/codecs@sha256:reviewed >/dev/null 2>&1
  grep -Fq -- '--build-arg CODECS_IMAGE=example.test/codecs@sha256:reviewed' "$DOCKER_LOG"
done

: >"$DOCKER_LOG"
PATH="${TMP_DIR}:${PATH}" PUSH=1 REGISTRY=example.test TAG=test "$SCRIPT" transcode-tester >/dev/null 2>&1
[[ "$(wc -l <"$DOCKER_LOG")" -eq 1 ]]
if grep -q '^push ' "$DOCKER_LOG"; then
  echo "local-only transcode-tester was pushed" >&2
  exit 1
fi

: >"$DOCKER_LOG"
push_output="$(PATH="${TMP_DIR}:${PATH}" PUSH=1 REGISTRY=example.test TAG=test "$SCRIPT" transcode-gateway 2>&1)"
[[ "$(grep -c '^push ' "$DOCKER_LOG")" -eq 1 ]]
grep -Fq 'example.test/transcode-gateway@sha256:test-digest' <<<"$push_output"

: >"$DOCKER_LOG"
if PATH="${TMP_DIR}:${PATH}" FAKE_GIT_DIRTY=1 PUSH=1 "$SCRIPT" live-runner-nvidia >"${TMP_DIR}/dirty.out" 2>&1; then
  echo "dirty push unexpectedly succeeded" >&2
  exit 1
fi
grep -Fq 'refusing to push: working tree has uncommitted changes' "${TMP_DIR}/dirty.out"
[[ ! -s "$DOCKER_LOG" ]]

: >"$DOCKER_LOG"
push_output="$(PATH="${TMP_DIR}:${PATH}" PUSH=1 REGISTRY=example.test TAG=test "$SCRIPT" codecs-builder 2>&1)"
[[ "$(grep -c '^push ' "$DOCKER_LOG" || true)" -eq 0 ]]
grep -Fq 'local-only image; skipping push for example.test/codecs-builder:test' <<<"$push_output"

for target in nvidia intel amd cpu; do
  grep -Fq "FROM runtime-ubuntu-base AS runtime-$target" "${ROOT}/live-runner/Dockerfile" || \
    [[ "$target" == nvidia && "$(grep -Fc ' AS runtime-nvidia' "${ROOT}/live-runner/Dockerfile")" -eq 1 ]]
  grep -Fq "LIVE_RUNNER_HARDWARE=$target" "${ROOT}/live-runner/Dockerfile"
done

# Published FFmpeg binaries must remain redistributable. libnpp requires
# FFmpeg's --enable-nonfree switch; the runners use scale_cuda instead.
if grep -Fq -- '--enable-nonfree' \
  "${ROOT}/transcode-runner/Dockerfile" \
  "${ROOT}/abr-runner/Dockerfile"; then
  echo "pushable runner image enables non-redistributable FFmpeg" >&2
  exit 1
fi
if grep -Fq -- '--enable-libnpp' \
  "${ROOT}/transcode-runner/Dockerfile" \
  "${ROOT}/abr-runner/Dockerfile"; then
  echo "pushable runner image enables non-redistributable libnpp" >&2
  exit 1
fi
if grep -Fq -- '--enable-cuda-nvcc' \
  "${ROOT}/transcode-runner/Dockerfile" \
  "${ROOT}/abr-runner/Dockerfile"; then
  echo "pushable runner image enables non-redistributable cuda_nvcc" >&2
  exit 1
fi

# Keep the runner probes in Docker's exec form. Appending shell syntax to the
# JSON array silently turns it into a broken CMD-SHELL health check.
[[ "$(grep -Fc 'CMD ["/usr/local/bin/transcode-runner", "-healthcheck"]' "${ROOT}/transcode-runner/Dockerfile")" -eq 3 ]]
[[ "$(grep -Fc 'CMD ["/usr/local/bin/abr-runner", "-healthcheck"]' "${ROOT}/abr-runner/Dockerfile")" -eq 3 ]]
if grep -Fq '"] ||' "${ROOT}/transcode-runner/Dockerfile" "${ROOT}/abr-runner/Dockerfile"; then
  echo "runner image health check contains shell syntax after exec form" >&2
  exit 1
fi

echo "build-images tests passed"
