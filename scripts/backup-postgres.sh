#!/bin/sh
set -eu
umask 077

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
REPO_ROOT="$(CDPATH= cd -- "${SCRIPT_DIR}/.." && pwd)"
COMPOSE_FILE="${REPO_ROOT}/docker-compose.yaml"

SERVICE="postiz-postgres"
DB_USER="postiz-user"
DB_NAME="postiz-db-local"
BACKUP_DIR="${REPO_ROOT}/backups"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_FILE=""
CHECKSUM_FILE=""
COMPLETE=false

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

cleanup() {
  if [ "$COMPLETE" != true ]; then
    [ -z "$BACKUP_FILE" ] || rm -f -- "$BACKUP_FILE"
    [ -z "$CHECKSUM_FILE" ] || rm -f -- "$CHECKSUM_FILE"
  fi
}
trap cleanup 0
trap 'exit 1' HUP INT TERM

command -v sha256sum >/dev/null 2>&1 || fail "sha256sum is unavailable."
command -v mktemp >/dev/null 2>&1 || fail "mktemp is unavailable."
command -v docker >/dev/null 2>&1 || fail "docker is not installed or not on PATH."
docker compose version >/dev/null 2>&1 || fail "docker compose is unavailable."
[ -f "$COMPOSE_FILE" ] || fail "Could not find docker-compose.yaml at ${COMPOSE_FILE}."

if ! docker compose -f "$COMPOSE_FILE" ps --status running --services | grep -qx "$SERVICE"; then
  fail "${SERVICE} is not running. Start the stack before taking a backup."
fi

mkdir -p "$BACKUP_DIR"
# Unique, mode-0600 files avoid overwriting an earlier backup in the same second.
BACKUP_FILE="$(mktemp "${BACKUP_DIR}/postiz-${TIMESTAMP}.XXXXXX.sql")"
CHECKSUM_FILE="$(mktemp "${BACKUP_FILE}.XXXXXX.sha256")"

echo "Creating Postgres backup at ${BACKUP_FILE}..."
docker compose -f "$COMPOSE_FILE" exec -T "$SERVICE" pg_dump -U "$DB_USER" -d "$DB_NAME" > "$BACKUP_FILE" || {
  fail "pg_dump failed. No backup was kept."
}

[ -s "$BACKUP_FILE" ] || fail "pg_dump returned an empty backup. No backup was kept."
# Relative entries verify the copied artifact after transfer to protected storage.
(
  cd "$BACKUP_DIR"
  sha256sum "$(basename -- "$BACKUP_FILE")" > "$CHECKSUM_FILE"
  sha256sum --check "$(basename -- "$CHECKSUM_FILE")" >/dev/null
) || fail "Backup checksum verification failed."
COMPLETE=true

echo "Backup created: ${BACKUP_FILE}"
echo "Checksum verified: ${CHECKSUM_FILE}"
echo "Scope: bundled ${SERVICE}/${DB_NAME} only; no Temporal, media, or managed database backup."
echo "An isolated restore/schema/data check is still required before release approval."
