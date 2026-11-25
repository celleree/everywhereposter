#!/bin/sh
# Launcher used by the isolated, deliberately restricted release rehearsal.
set -eu

test -z "${RUN_CRON+x}"
test "${DISABLE_POSTIZ_MCP:-}" = true
test "${DISABLE_REGISTRATION:-}" = true

cd /app/apps/backend
node --experimental-require-module ./dist/apps/backend/src/main.js &
backend=$!
cd /app/apps/frontend
/app/node_modules/.bin/next start -H 0.0.0.0 -p 4200 &
frontend=$!

stop_children() {
    kill -TERM "$backend" "$frontend" 2>/dev/null || true
    wait "$backend" "$frontend" 2>/dev/null || true
}
trap 'stop_children; exit 0' INT TERM
while kill -0 "$backend" "$frontend" 2>/dev/null; do
    sleep 1
done
stop_children
exit 1
