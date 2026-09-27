#!/usr/bin/env bash
set -euo pipefail

CONTAINER_NAME="${1:-publish-everywhere-web}"
SERVICE_NAME="${2:-public-web}"
CONFIG_PATH=/etc/nginx/conf.d/default.conf

# Git replaces files during checkout. A single-file bind mount may retain the
# old inode even after nginx reloads, so compare the live mount with its source.
CONFIG_SOURCE="$(docker inspect "$CONTAINER_NAME" --format '{{range .Mounts}}{{if eq .Destination "/etc/nginx/conf.d/default.conf"}}{{.Source}}{{end}}{{end}}')"
[ -f "$CONFIG_SOURCE" ] || { echo 'ERROR: public proxy config source is missing.' >&2; exit 1; }
SOURCE_HASH="$(sha256sum "$CONFIG_SOURCE")"
MOUNT_HASH="$(docker exec "$CONTAINER_NAME" sha256sum "$CONFIG_PATH")"

if [ "${SOURCE_HASH%% *}" != "${MOUNT_HASH%% *}" ]; then
  # The one-off container mounts the new file without taking live traffic.
  docker compose run --rm --no-deps --entrypoint nginx "$SERVICE_NAME" -t
  docker compose up -d --no-build --no-deps --force-recreate "$SERVICE_NAME"
fi

docker exec "$CONTAINER_NAME" nginx -t
docker exec "$CONTAINER_NAME" nginx -s reload
