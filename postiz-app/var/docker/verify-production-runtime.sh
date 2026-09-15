#!/bin/sh
set -eu

command -v node >/dev/null
command -v pnpm >/dev/null
command -v nginx >/dev/null
command -v ffmpeg >/dev/null
command -v ffprobe >/dev/null

assert_command_absent() {
  if command -v "$1" >/dev/null 2>&1; then
    echo "ERROR: production runtime includes forbidden command: $1" >&2
    return 1
  fi
}

assert_command_absent g++
assert_command_absent make
assert_command_absent python3
assert_command_absent pip
assert_command_absent pm2
test ! -e /app/node_modules/jest
test ! -e /app/apps/frontend/.next/cache
if find /app/apps/backend/dist /app/apps/orchestrator/dist \
    -type f \( -name '*.d.ts' -o -name '*.tsbuildinfo' \) | grep -q .; then
  echo 'ERROR: production runtime includes TypeScript build metadata.' >&2
  exit 1
fi

test -f /app/apps/frontend/.next/BUILD_ID
test -f /app/apps/frontend/next.config.js
test -d /app/apps/frontend/public
test -f /app/apps/backend/dist/apps/backend/src/main.js
test -f /app/apps/orchestrator/dist/apps/orchestrator/src/main.js
test -f /app/libraries/nestjs-libraries/src/database/prisma/schema.prisma
test -f /app/libraries/nestjs-libraries/src/database/prisma/migrations/migration_lock.toml
test "$(find /app/libraries/nestjs-libraries/src/database/prisma/migrations \
    -name migration.sql -type f | wc -l)" -ge 1
test -x /app/node_modules/.bin/prisma
test -d /config
test -d /uploads

nginx -t
ffmpeg -version >/dev/null
ffprobe -version >/dev/null
node --check /app/apps/backend/dist/apps/backend/src/main.js
node --check /app/apps/orchestrator/dist/apps/orchestrator/src/main.js
node -e 'const p=require("prisma/package.json"); if(p.version!=="6.5.0") process.exit(1)'
CHECKPOINT_DISABLE=1 PRISMA_HIDE_UPDATE_MESSAGE=1 \
  DATABASE_URL=postgresql://runtime:runtime@127.0.0.1:5432/runtime \
  pnpm exec prisma validate \
    --schema /app/libraries/nestjs-libraries/src/database/prisma/schema.prisma >/dev/null

node <<'NODE'
const bcrypt = require('bcrypt');
const sharp = require('sharp');
const { PrismaClient } = require('@prisma/client');
require('@temporalio/worker');

if (!bcrypt.compareSync('runtime-check', bcrypt.hashSync('runtime-check', 4))) {
  throw new Error('bcrypt runtime check failed');
}

Promise.all([
  sharp({ create: { width: 1, height: 1, channels: 4, background: '#000000' } })
    .png()
    .toBuffer(),
  new PrismaClient().$disconnect(),
]).then(([image]) => {
  if (image[0] !== 0x89 || image.toString('ascii', 1, 4) !== 'PNG') {
    throw new Error('sharp runtime check failed');
  }
}).catch((error) => {
  console.error(error.message);
  process.exit(1);
});
NODE

FRONTEND_LOG=/tmp/postiz-frontend-check.log
cd /app
pnpm --filter ./apps/frontend start >"$FRONTEND_LOG" 2>&1 &
FRONTEND_PID=$!

cleanup() {
  kill "$FRONTEND_PID" >/dev/null 2>&1 || true
  wait "$FRONTEND_PID" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

ATTEMPT=0
until node -e '
  const request = require("http").get("http://127.0.0.1:4200/auth/login", (response) => {
    let body = "";
    response.setEncoding("utf8");
    response.on("data", (chunk) => { body += chunk; });
    response.on("end", () => {
      process.exit(response.statusCode === 200 && body.includes("Sign In") ? 0 : 1);
    });
  });
  request.on("error", () => process.exit(1));
  request.setTimeout(1000, () => request.destroy());
'; do
  ATTEMPT=$((ATTEMPT + 1))
  if [ "$ATTEMPT" -ge 45 ]; then
    cat "$FRONTEND_LOG"
    exit 1
  fi
  sleep 1
done

echo 'Production runtime artifact, native dependency, and frontend checks passed.'
