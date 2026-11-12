#!/bin/sh
# Local nonproduction only. No provider credentials, workers, reset, or cleanup.
set -eu
fail() { echo "ERROR: $*" >&2; exit 1; }
ACTION=${1:-}
EXPECTED_ENGINE=${2:-}
case "$ACTION" in check|up|start|status|stop|smoke) ;; *) fail "Usage: sh tools/new-user-test/run.sh check|up|start|status|stop|smoke VERIFIED_NONPRODUCTION_ENGINE_ID" ;; esac
[ -n "$EXPECTED_ENGINE" ] || fail "Provide the independently verified local nonproduction Docker engine ID."
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd -P)
[ "$ROOT" != /home/arund/dev/everywhereposter ] || fail "Use an isolated worktree, never canonical main."
case "$ROOT" in /home/*/dev/ep-new-user-*) ;; *) fail "Use a named WSL-native ep-new-user-* worktree." ;; esac
[ "$(git -C "$ROOT" branch --show-current)" != main ] || fail "Never run on main."
for directory in "$ROOT" "$ROOT/postiz-app" "$ROOT/postiz-app/apps/frontend" "$ROOT/postiz-app/apps/backend"; do
  if find "$directory" -maxdepth 1 -name '.env*' ! -name '.env.example' ! -name '.env.sample' | grep -q .; then
    fail "Refusing a checkout carrying environment files."
  fi
done
unset DOCKER_HOST DOCKER_CONTEXT DOCKER_TLS_VERIFY DOCKER_CERT_PATH
ENGINE=$(docker --host unix:///var/run/docker.sock info --format '{{.ID}}')
[ "$ENGINE" = "$EXPECTED_ENGINE" ] || fail "Docker engine identity mismatch."
[ "$ENGINE" != 5ff76524-8647-4307-9a86-ea6ef47af563 ] || fail "Known production engine is forbidden."
[ -d "$ROOT/postiz-app/node_modules" ] && [ ! -L "$ROOT/postiz-app/node_modules" ] || fail "Install/copy owned dependencies first; shared dependency symlinks are forbidden."
compose() {
  env -i PATH="$PATH" HOME="$HOME" QA_ROOT="$ROOT" QA_UID="$(id -u)" QA_GID="$(id -g)" \
    docker --host unix:///var/run/docker.sock compose --env-file /dev/null \
    --project-name ep-new-user-20261107 --project-directory "$ROOT" \
    -f "$ROOT/tools/new-user-test/compose.yaml" "$@"
}
STATE="$ROOT/postiz-app/tmp/new-user-environment"
SCHEMA="$ROOT/postiz-app/libraries/nestjs-libraries/src/database/prisma"
schema_hash() { (cd "$SCHEMA" && { sha256sum schema.prisma; find migrations -name migration.sql -type f | sort | xargs sha256sum; }) | sha256sum | cut -d' ' -f1; }
owned() {
  [ -f "$STATE/created" ] && [ "$(cat "$STATE/created")" = "$ENGINE" ] || fail "No matching task-owned fixture."
}
data_owned() {
  owned
  for volume in ep-new-user-20261107_app-db ep-new-user-20261107_temporal-db; do
    [ "$(docker --host unix:///var/run/docker.sock volume inspect "$volume" --format '{{index .Labels "com.docker.compose.project"}}')" = ep-new-user-20261107 ] || fail "Fixture volume ownership mismatch."
  done
}
dependencies() { compose up -d --wait --wait-timeout 180 qa-postgres qa-redis qa-temporal; }
apps() {
  branding="$ROOT/postiz-app/apps/frontend/public/branding"
  if [ -e "$branding" ] || [ -L "$branding" ]; then
    [ -L "$branding" ] && [ "$(readlink "$branding")" = ../../../../site/branding ] || fail "Refusing to replace existing branding assets."
  else
    ln -s ../../../../site/branding "$branding"
  fi
  compose run --rm --no-deps --interactive=false qa-build
  compose up -d --wait --wait-timeout 180 qa-backend
  compose up -d --wait --wait-timeout 300 qa-frontend
  compose up -d --no-deps qa-ingress
}
case "$ACTION" in
  check)
    compose config --quiet
    compose config --images | sort -u | while read -r image; do
      docker --host unix:///var/run/docker.sock image inspect "$image" >/dev/null
    done
    echo "PASS: local engine, env-free owned worktree, installed images, Compose configuration."
    ;;
  up)
    [ ! -e "$STATE/created" ] || fail "This fixture already exists; inspect status or use start instead."
    [ -z "$(docker --host unix:///var/run/docker.sock ps -aq --filter label=com.docker.compose.project=ep-new-user-20261107)" ] || fail "Project already exists; do not adopt its resources."
    for name in ep-new-user-20261107_app-db ep-new-user-20261107_temporal-db; do
      if docker --host unix:///var/run/docker.sock volume inspect "$name" >/dev/null 2>&1; then fail "Fixture volume already exists."; fi
    done
    for name in ep-new-user-20261107_isolated ep-new-user-20261107_ingress; do
      if docker --host unix:///var/run/docker.sock network inspect "$name" >/dev/null 2>&1; then fail "Fixture network already exists."; fi
    done
    sh "$0" check "$EXPECTED_ENGINE"
    umask 077
    mkdir -p "$STATE/uploads"
    printf '%s\n' "$ENGINE" > "$STATE/created"
    dependencies
    compose run --rm --no-deps --interactive=false qa-migrate
    schema_hash > "$STATE/schema-ready"
    apps
    echo "Started isolated local environment. Run smoke for actual acceptance."
    ;;
  start)
    data_owned
    [ -f "$STATE/schema-ready" ] && [ "$(cat "$STATE/schema-ready")" = "$(schema_hash)" ] || fail "No matching successful migration receipt; inspect instead of retrying migrations."
    sh "$0" check "$EXPECTED_ENGINE"
    dependencies
    apps
    ;;
  status)
    owned
    compose ps -a
    ;;
  stop)
    owned
    compose stop
    echo "Only this fixture stopped. Its data remains; no resources deleted."
    ;;
  smoke)
    data_owned
    cd "$ROOT/postiz-app"
    env -i PATH="$PATH" HOME="$HOME" node "$ROOT/tools/new-user-test/smoke.cjs"
    ;;
esac
