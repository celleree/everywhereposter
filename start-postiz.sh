#!/bin/sh
set -eu

cd /app

PRODUCTION_DOMAIN="publisheverywhere.halowebsites.com"
PUBLIC_DOMAIN_MODE="false"
LOCAL_DOCKER_DB="false"

case "${MAIN_URL:-} ${FRONTEND_URL:-}" in
  *"$PRODUCTION_DOMAIN"*) PUBLIC_DOMAIN_MODE="true" ;;
esac

case "${DATABASE_URL:-}" in
  *"@postiz-postgres:"*|*"postiz-postgres:5432/postiz-db-local"*) LOCAL_DOCKER_DB="true" ;;
esac

if [ "$PUBLIC_DOMAIN_MODE" = "true" ] && [ "$LOCAL_DOCKER_DB" = "true" ] && [ "${ALLOW_PUBLIC_DOMAIN_WITH_LOCAL_DB:-false}" != "true" ]; then
  cat >&2 <<EOF
ERROR: Refusing to start Publish Everywhere with the public production domain and the bundled local Docker Postgres database.

This protects users from accidentally serving production traffic from a fresh/local DB, which can make real profile/data appear deleted.

Use a local URL for MAIN_URL/FRONTEND_URL, point DATABASE_URL at the intended production database, or set ALLOW_PUBLIC_DOMAIN_WITH_LOCAL_DB=true only after a deliberate safety review.
EOF
  exit 1
fi

if [ "${SKIP_PRISMA_DB_PUSH:-false}" = "true" ]; then
  echo "Skipping Prisma db push because SKIP_PRISMA_DB_PUSH=true"
elif [ "$PUBLIC_DOMAIN_MODE" = "true" ] && [ "${RUN_PRISMA_DB_PUSH_IN_PUBLIC_MODE:-false}" != "true" ]; then
  echo "Skipping Prisma db push in public-domain mode. Set RUN_PRISMA_DB_PUSH_IN_PUBLIC_MODE=true to run it intentionally."
else
  echo "WARNING: Running Prisma db push against DATABASE_URL. Set SKIP_PRISMA_DB_PUSH=true to skip."
  pnpm run prisma-db-push
fi

wait_for_tcp() {
  HOST="$1"
  PORT="$2"
  LABEL="$3"
  TIMEOUT_SECONDS="${4:-90}"

  echo "Waiting for ${LABEL} on ${HOST}:${PORT}..."

  node - "$HOST" "$PORT" "$LABEL" "$TIMEOUT_SECONDS" <<'EOF'
const net = require('net');

const [host, portValue, label, timeoutValue] = process.argv.slice(2);
const port = Number(portValue);
const timeoutMs = Number(timeoutValue) * 1000;
const deadline = Date.now() + timeoutMs;

function attempt() {
  const socket = net.connect({ host, port });
  let settled = false;

  const finish = (ok, message) => {
    if (settled) {
      return;
    }

    settled = true;
    socket.destroy();

    if (ok) {
      console.log(message);
      process.exit(0);
    }

    if (Date.now() >= deadline) {
      console.error(message);
      process.exit(1);
    }

    setTimeout(attempt, 1000);
  };

  socket.setTimeout(1000);
  socket.on('connect', () => finish(true, `${label} is ready on ${host}:${port}`));
  socket.on('timeout', () => finish(false, `Timed out waiting for ${label} on ${host}:${port}`));
  socket.on('error', () => finish(false, `Still waiting for ${label} on ${host}:${port}`));
}

attempt();
EOF
}

nginx -g 'daemon off;' &
NGINX_PID=$!

wait_for_tcp temporal 7233 "Temporal" 90

cd /app/apps/backend
node --experimental-require-module ./dist/apps/backend/src/main.js &
BACKEND_PID=$!

wait_for_tcp 127.0.0.1 3000 "Backend" 90

cd /app
pnpm --filter ./apps/frontend start &
FRONTEND_PID=$!

pnpm --filter ./apps/orchestrator start &
ORCHESTRATOR_PID=$!

cleanup() {
  kill "$NGINX_PID" "$BACKEND_PID" "$FRONTEND_PID" "$ORCHESTRATOR_PID" 2>/dev/null || true
  wait "$NGINX_PID" "$BACKEND_PID" "$FRONTEND_PID" "$ORCHESTRATOR_PID" 2>/dev/null || true
}

trap cleanup INT TERM

while true; do
  for pid in "$NGINX_PID" "$BACKEND_PID" "$FRONTEND_PID" "$ORCHESTRATOR_PID"; do
    if ! kill -0 "$pid" 2>/dev/null; then
      wait "$pid" || STATUS=$?
      cleanup
      exit "${STATUS:-1}"
    fi
  done
  sleep 2
done
