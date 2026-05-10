#!/bin/sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
REPO_ROOT="$(CDPATH= cd -- "${SCRIPT_DIR}/.." && pwd)"
COMPOSE_FILE="${REPO_ROOT}/docker-compose.yaml"

SERVICE="postiz-postgres"
DB_USER="postiz-user"
DB_NAME="postiz-db-local"
BACKUP_DIR="${REPO_ROOT}/backups"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_FILE="${BACKUP_DIR}/postiz-${TIMESTAMP}.sql"

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

command -v docker >/dev/null 2>&1 || fail "docker is not installed or not on PATH."
docker compose version >/dev/null 2>&1 || fail "docker compose is unavailable."
[ -f "$COMPOSE_FILE" ] || fail "Could not find docker-compose.yaml at ${COMPOSE_FILE}."

if ! docker compose -f "$COMPOSE_FILE" ps --status running --services | grep -qx "$SERVICE"; then
  fail "${SERVICE} is not running. Start the stack before taking a backup."
fi

mkdir -p "$BACKUP_DIR"

echo "Creating Postgres backup at ${BACKUP_FILE}..."
docker compose -f "$COMPOSE_FILE" exec -T "$SERVICE" pg_dump -U "$DB_USER" -d "$DB_NAME" > "$BACKUP_FILE" || {
  rm -f "$BACKUP_FILE"
  fail "pg_dump failed. No backup was kept."
}

echo "Backup created: ${BACKUP_FILE}"
