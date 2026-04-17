#!/bin/sh
set -eu

cd /app
pnpm run prisma-db-push

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
