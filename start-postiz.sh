#!/bin/sh
set -eu

cd /app
pnpm run prisma-db-push

# Postiz's MCP bootstrap can block backend startup in this containerized setup.
# Patch the compiled backend entrypoint at runtime so the web app can still boot.
if [ "${DISABLE_POSTIZ_MCP:-false}" = "true" ]; then
  node <<'EOF'
const fs = require('fs');
const backendMain = '/app/apps/backend/dist/apps/backend/src/main.js';
const original = '    await (0, start_mcp_1.startMcp)(app);\n';
const patched = `    if (process.env.DISABLE_POSTIZ_MCP !== 'true') {
        await (0, start_mcp_1.startMcp)(app);
    }
`;

if (fs.existsSync(backendMain)) {
  const source = fs.readFileSync(backendMain, 'utf8');
  if (source.includes(original) && !source.includes('DISABLE_POSTIZ_MCP')) {
    fs.writeFileSync(backendMain, source.replace(original, patched));
    console.log('Patched backend startup to skip MCP bootstrap.');
  }
}
EOF
fi

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

nginx -g 'daemon off;' &
NGINX_PID=$!

cd /app/apps/backend
pnpm start &
BACKEND_PID=$!

cd /app/apps/frontend
pnpm start &
FRONTEND_PID=$!

cd /app/apps/orchestrator
pnpm start &
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
