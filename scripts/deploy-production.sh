#!/usr/bin/env bash
set -euo pipefail

TARGET_SHA="${1:-}"
IMAGE_REPOSITORY="${IMAGE_REPOSITORY:-ghcr.io/celleree/publish-everywhere-postiz}"
RUNTIME_IMAGE="${RUNTIME_IMAGE:-publish-everywhere/postiz-app:custom}"
ROLLBACK_IMAGE="${ROLLBACK_IMAGE:-publish-everywhere/postiz-app:previous}"
SERVICE_NAME="${SERVICE_NAME:-postiz}"
CONTAINER_NAME="${CONTAINER_NAME:-postiz}"
STARTUP_WAIT_SECONDS="${STARTUP_WAIT_SECONDS:-45}"
PRUNE_UNUSED_IMAGES="${PRUNE_UNUSED_IMAGES:-false}"

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

case "$TARGET_SHA" in
  ''|*[!0-9a-f]*) fail "TARGET_SHA must be a lowercase 40-character commit SHA." ;;
esac

[ "${#TARGET_SHA}" -eq 40 ] || fail "TARGET_SHA must be a lowercase 40-character commit SHA."

REPO_ROOT="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

[ "$(git branch --show-current)" = "main" ] || fail "The server checkout must be on main."
[ -z "$(git status --porcelain)" ] || fail "The server checkout is dirty; refusing to deploy."

TARGET_IMAGE="${IMAGE_REPOSITORY}:${TARGET_SHA}"
PREVIOUS_IMAGE_ID=""

if [ "$PRUNE_UNUSED_IMAGES" != "true" ] && [ "$PRUNE_UNUSED_IMAGES" != "false" ]; then
  fail "PRUNE_UNUSED_IMAGES must be true or false."
fi

docker pull "$TARGET_IMAGE"
EXPECTED_IMAGE_ID="$(docker image inspect "$TARGET_IMAGE" --format '{{.Id}}')"

if docker inspect "$CONTAINER_NAME" >/dev/null 2>&1; then
  PREVIOUS_CONTAINER_RUNNING="$(docker inspect "$CONTAINER_NAME" --format '{{.State.Running}}')"

  if [ "$PREVIOUS_CONTAINER_RUNNING" = "true" ]; then
    PREVIOUS_IMAGE_ID="$(docker inspect "$CONTAINER_NAME" --format '{{.Image}}')"
    docker image inspect "$PREVIOUS_IMAGE_ID" >/dev/null 2>&1 || \
      fail "The running ${CONTAINER_NAME} container image is unavailable locally."

    if [ "$PREVIOUS_IMAGE_ID" = "$EXPECTED_IMAGE_ID" ]; then
      printf 'The requested image %s is already running; preserving %s unchanged.\n' \
        "$EXPECTED_IMAGE_ID" "$ROLLBACK_IMAGE"
      PREVIOUS_IMAGE_ID=""
    else
      docker tag "$PREVIOUS_IMAGE_ID" "$ROLLBACK_IMAGE"
      printf 'Retained running container image %s as %s.\n' "$PREVIOUS_IMAGE_ID" "$ROLLBACK_IMAGE"
    fi
  else
    printf 'The existing %s container is not running; preserving the current %s tag unchanged.\n' \
      "$CONTAINER_NAME" "$ROLLBACK_IMAGE"
  fi
fi

if [ "$PRUNE_UNUSED_IMAGES" = "true" ]; then
  docker image prune -af
fi

docker tag "$TARGET_IMAGE" "$RUNTIME_IMAGE"

docker compose up -d --no-build --no-deps --force-recreate "$SERVICE_NAME"
sleep "$STARTUP_WAIT_SECONDS"

RUNNING="$(docker inspect "$CONTAINER_NAME" --format '{{.State.Running}}')"
RUNNING_IMAGE_ID="$(docker inspect "$CONTAINER_NAME" --format '{{.Image}}')"

if [ "$RUNNING" != "true" ]; then
  docker logs --tail 120 "$CONTAINER_NAME" || true
  fail "The ${CONTAINER_NAME} container is not running."
fi

if [ "$RUNNING_IMAGE_ID" != "$EXPECTED_IMAGE_ID" ]; then
  docker logs --tail 120 "$CONTAINER_NAME" || true
  fail "The running container image does not match the requested full-SHA image."
fi

docker logs --tail 120 "$CONTAINER_NAME"
printf 'DEPLOYED_SHA=%s\n' "$TARGET_SHA"
printf 'DEPLOYED_IMAGE_ID=%s\n' "$RUNNING_IMAGE_ID"
printf 'ROLLBACK_IMAGE_ID=%s\n' "${PREVIOUS_IMAGE_ID:-not-updated}"
