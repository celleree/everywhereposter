#!/usr/bin/env bash
set -euo pipefail

TARGET_SHA="${1:-}"
IMAGE_REPOSITORY="${IMAGE_REPOSITORY:-ghcr.io/celleree/publish-everywhere-postiz}"
RUNTIME_IMAGE="${RUNTIME_IMAGE:-publish-everywhere/postiz-app:custom}"
ROLLBACK_IMAGE="${ROLLBACK_IMAGE:-publish-everywhere/postiz-app:previous}"
SERVICE_NAME="${SERVICE_NAME:-postiz}"
CONTAINER_NAME="${CONTAINER_NAME:-postiz}"
PUBLIC_WEB_CONTAINER="${PUBLIC_WEB_CONTAINER:-publish-everywhere-web}"
STARTUP_TIMEOUT_SECONDS="${STARTUP_TIMEOUT_SECONDS:-180}"
STARTUP_POLL_SECONDS="${STARTUP_POLL_SECONDS:-2}"
PRUNE_UNUSED_IMAGES="${PRUNE_UNUSED_IMAGES:-false}"
ROLLBACK_GUARD_CONTAINER="${ROLLBACK_GUARD_CONTAINER:-everywhereposter-rollback-prune-guard}"
PRODUCTION_EMAIL_FROM_ADDRESS="${PRODUCTION_EMAIL_FROM_ADDRESS:-noreply@everywhereposter.com}"
DEPLOY_STARTED_SECONDS=$SECONDS

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

log_timing() {
  local stage="$1"
  local started_seconds="$2"
  printf 'DEPLOY_TIMING stage=%s seconds=%s\n' "$stage" "$((SECONDS - started_seconds))"
}

cleanup_rollback_guard() {
  docker rm -f "$ROLLBACK_GUARD_CONTAINER" >/dev/null 2>&1 || true
}

trap cleanup_rollback_guard EXIT

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

if [ "$PRUNE_UNUSED_IMAGES" = "true" ]; then
  PRUNE_STARTED_SECONDS=$SECONDS
  cleanup_rollback_guard

  if docker image inspect "$ROLLBACK_IMAGE" >/dev/null 2>&1; then
    docker create --name "$ROLLBACK_GUARD_CONTAINER" "$ROLLBACK_IMAGE" >/dev/null
    printf 'Protected %s from pruning with temporary container %s.\n' \
      "$ROLLBACK_IMAGE" "$ROLLBACK_GUARD_CONTAINER"
  fi

  docker image prune -af
  cleanup_rollback_guard
  log_timing prune_unused_images "$PRUNE_STARTED_SECONDS"
fi

PULL_STARTED_SECONDS=$SECONDS
docker pull "$TARGET_IMAGE"
EXPECTED_IMAGE_ID="$(docker image inspect "$TARGET_IMAGE" --format '{{.Id}}')"
log_timing pull_image "$PULL_STARTED_SECONDS"

PREPARE_STARTED_SECONDS=$SECONDS
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

docker tag "$TARGET_IMAGE" "$RUNTIME_IMAGE"
log_timing prepare_runtime_image "$PREPARE_STARTED_SECONDS"

export EMAIL_FROM_ADDRESS="$PRODUCTION_EMAIL_FROM_ADDRESS"

MIGRATION_STARTED_SECONDS=$SECONDS
docker compose run --rm --no-deps --entrypoint /bin/sh \
  "$SERVICE_NAME" -lc \
  'cd /app && pnpm exec prisma migrate deploy --schema libraries/nestjs-libraries/src/database/prisma/schema.prisma'
log_timing migration "$MIGRATION_STARTED_SECONDS"

RECREATE_STARTED_SECONDS=$SECONDS
docker compose up -d --no-build --no-deps --force-recreate "$SERVICE_NAME"
log_timing recreate_container "$RECREATE_STARTED_SECONDS"

STARTUP_READINESS_STARTED_SECONDS=$SECONDS
bash scripts/wait-for-container-health.sh \
  "$CONTAINER_NAME" "$STARTUP_TIMEOUT_SECONDS" "$STARTUP_POLL_SECONDS"
log_timing startup_readiness "$STARTUP_READINESS_STARTED_SECONDS"

VERIFY_STARTED_SECONDS=$SECONDS
RUNNING="$(docker inspect "$CONTAINER_NAME" --format '{{.State.Running}}')"
RUNNING_RESTART_COUNT="$(docker inspect "$CONTAINER_NAME" --format '{{.RestartCount}}')"
RUNNING_IMAGE_ID="$(docker inspect "$CONTAINER_NAME" --format '{{.Image}}')"
RUNNING_EMAIL_FROM_ADDRESS="$(docker inspect "$CONTAINER_NAME" --format '{{range .Config.Env}}{{println .}}{{end}}' | sed -n 's/^EMAIL_FROM_ADDRESS=//p' | head -n 1)"

if [ "$RUNNING" != "true" ]; then
  docker logs --tail 120 "$CONTAINER_NAME" || true
  fail "The ${CONTAINER_NAME} container is not running."
fi

if [ "$RUNNING_RESTART_COUNT" != "0" ]; then
  docker logs --tail 120 "$CONTAINER_NAME" || true
  fail "The ${CONTAINER_NAME} container restarted during deployment verification."
fi

if [ "$RUNNING_IMAGE_ID" != "$EXPECTED_IMAGE_ID" ]; then
  docker logs --tail 120 "$CONTAINER_NAME" || true
  fail "The running container image does not match the requested full-SHA image."
fi

if [ "$RUNNING_EMAIL_FROM_ADDRESS" != "$PRODUCTION_EMAIL_FROM_ADDRESS" ]; then
  docker logs --tail 120 "$CONTAINER_NAME" || true
  fail "The running container does not use the expected production email sender."
fi
log_timing verify_container "$VERIFY_STARTED_SECONDS"

PROXY_RELOAD_STARTED_SECONDS=$SECONDS
if ! docker inspect "$PUBLIC_WEB_CONTAINER" >/dev/null 2>&1; then
  fail "The public proxy container ${PUBLIC_WEB_CONTAINER} does not exist."
fi

PUBLIC_WEB_RUNNING="$(docker inspect "$PUBLIC_WEB_CONTAINER" --format '{{.State.Running}}')"
if [ "$PUBLIC_WEB_RUNNING" != "true" ]; then
  fail "The public proxy container ${PUBLIC_WEB_CONTAINER} is not running."
fi

docker exec "$PUBLIC_WEB_CONTAINER" nginx -t
docker exec "$PUBLIC_WEB_CONTAINER" nginx -s reload
sleep 2
printf 'Reloaded %s so Nginx resolves the recreated %s container.\n' \
  "$PUBLIC_WEB_CONTAINER" "$CONTAINER_NAME"
log_timing reload_public_proxy "$PROXY_RELOAD_STARTED_SECONDS"

docker logs --tail 120 "$CONTAINER_NAME"
printf 'DEPLOYED_SHA=%s\n' "$TARGET_SHA"
printf 'DEPLOYED_IMAGE_ID=%s\n' "$RUNNING_IMAGE_ID"
printf 'EMAIL_FROM_ADDRESS=%s\n' "$RUNNING_EMAIL_FROM_ADDRESS"
printf 'ROLLBACK_IMAGE_ID=%s\n' "${PREVIOUS_IMAGE_ID:-not-updated}"
log_timing total "$DEPLOY_STARTED_SECONDS"
