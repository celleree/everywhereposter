#!/bin/sh
set -eu

cd /app
if [ "${SKIP_PRISMA_DB_PUSH:-false}" = "true" ]; then
  echo "Skipping Prisma db push because SKIP_PRISMA_DB_PUSH=true"
else
  pnpm run prisma-db-push
fi

# Start MCP in the background so the app can still boot even if MCP init is
# slow. Operators can still disable it entirely with DISABLE_POSTIZ_MCP=true.
node <<'EOF'
const fs = require('fs');
const backendMain = '/app/apps/backend/dist/apps/backend/src/main.js';
const original = '    await (0, start_mcp_1.startMcp)(app);\n';
const previousPatched = `    if (process.env.DISABLE_POSTIZ_MCP !== 'true') {
        await (0, start_mcp_1.startMcp)(app);
    }
`;
const patched = `    setTimeout(() => {
        if (process.env.DISABLE_POSTIZ_MCP === 'true') {
            console.log('MCP bootstrap disabled by DISABLE_POSTIZ_MCP=true');
            return;
        }
        Promise.resolve((0, start_mcp_1.startMcp)(app))
            .then(() => console.log('MCP bootstrap completed.'))
            .catch((err) => console.error('MCP bootstrap failed.', err));
    }, 0);
`;

if (fs.existsSync(backendMain)) {
  const source = fs.readFileSync(backendMain, 'utf8');
  if (source.includes('MCP bootstrap completed.')) {
    console.log('MCP bootstrap patch already present.');
  } else if (source.includes(previousPatched)) {
    fs.writeFileSync(backendMain, source.replace(previousPatched, patched));
    console.log('Updated backend startup patch to use background MCP bootstrap.');
  } else if (source.includes(original)) {
    fs.writeFileSync(backendMain, source.replace(original, patched));
    console.log('Patched backend startup to use background MCP bootstrap.');
  }
}
EOF

# Surface swallowed social integration auth errors in container logs.
node <<'EOF'
const fs = require('fs');
const integrationsController = '/app/apps/backend/dist/apps/backend/src/api/routes/integrations.controller.js';
const original = `        catch (err) {\n            return { err: true };\n        }\n`;
const patched = `        catch (err) {\n            console.error('Failed to generate integration URL for', integration, err);\n            return { err: true };\n        }\n`;

if (fs.existsSync(integrationsController)) {
  const source = fs.readFileSync(integrationsController, 'utf8');
  if (source.includes(original) && !source.includes('Failed to generate integration URL for')) {
    fs.writeFileSync(integrationsController, source.replace(original, patched));
    console.log('Patched integrations controller to log provider auth failures.');
  }
}
EOF

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
