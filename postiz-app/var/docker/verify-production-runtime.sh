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
const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequire } = require('node:module');
const appRequire = createRequire('/app/package.json');
assert.equal(appRequire('next/package.json').version, '16.4.5');
const nextRequire = createRequire(appRequire.resolve('next/package.json'));
const { PrismaClient } = require('@prisma/client');
require('@temporalio/worker');

if (!bcrypt.compareSync('runtime-check', bcrypt.hashSync('runtime-check', 4))) {
  throw new Error('bcrypt runtime check failed');
}

// Fixed benign 2x1 fixtures exercise decoders independently of encoders.
const fixtures = {
  png: 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAD0lEQVR4nGNwSetwSesAAAfdAmUdxQbZAAAAAElFTkSuQmCC',
  jpeg: '/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAABAAIDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAABf/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AJQA0If/2Q==',
  avif: 'AAAAHGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZgAAAOptZXRhAAAAAAAAACFoZGxyAAAAAAAAAABwaWN0AAAAAAAAAAAAAAAAAAAAAA5waXRtAAAAAAABAAAAImlsb2MAAAAAREAAAQABAAAAAAEOAAEAAAAAAAAAGgAAACNpaW5mAAAAAAABAAAAFWluZmUCAAAAAAEAAGF2MDEAAAAAamlwcnAAAABLaXBjbwAAABNjb2xybmNseAABAA0ABoAAAAAMYXYxQ4EgAgAAAAAUaXNwZQAAAAAAAAACAAAAAQAAABBwaXhpAAAAAAMICAgAAAAXaXBtYQAAAAAAAAABAAEEAYIDBAAAACJtZGF0EgAKBzgAJhAQ0GkyDRgAAABAALATqdaq5IA=',
};
function atLeast(actual, minimum) {
  assert.ok(actual, `missing native version (minimum ${minimum})`);
  const a = actual.split('.').map(Number), b = minimum.split('.').map(Number);
  const first = b.findIndex((part, index) => a[index] !== part);
  assert.ok(first < 0 || a[first] > b[first], `${actual} is below ${minimum}`);
}
async function verifySharp(label, resolveFrom) {
  const sharp = resolveFrom('sharp');
  const sharpRequire = createRequire(resolveFrom.resolve('sharp'));
  assert.equal(sharpRequire(path.join(path.dirname(resolveFrom.resolve('sharp')), '../package.json')).version, '0.35.5');
  assert.equal(sharp.versions.sharp, '0.35.5');
  assert.equal(sharpRequire('@img/sharp-linux-x64/package').version, '0.35.5');
  assert.equal(sharpRequire('@img/sharp-libvips-linux-x64/package').version, '1.3.4');
  for (const [name, floor] of Object.entries({ vips: '8.18.7', heif: '1.23.5', rsvg: '2.63.2' })) {
    atLeast(sharp.versions[name], floor);
  }
  console.log(`${label}: ${resolveFrom.resolve('sharp')} ${JSON.stringify(sharp.versions)}`);
  for (const [format, encoded] of Object.entries(fixtures)) {
    const input = Buffer.from(encoded, 'base64');
    const metadata = await sharp(input).metadata();
    assert.equal(metadata.width, 2);
    assert.equal(metadata.height, 1);
    assert.equal(metadata.format, format === 'avif' ? 'heif' : format);
    const { data, info } = await sharp(input).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    assert.equal(info.width, 2);
    assert.equal(info.height, 1);
    assert.equal(data.length, 6);
    assert.ok(data.every((value, index) => Math.abs(value - [68, 102, 136][index % 3]) <= 8));
  }
  const encoded = await sharp({ create: { width: 1, height: 1, channels: 4, background: '#000000' } }).png().toBuffer();
  assert.equal(encoded[0], 0x89);
  assert.equal(encoded.toString('ascii', 1, 4), 'PNG');
  const svg = await sharp('/app/apps/frontend/public/icons/github.svg').raw().toBuffer({ resolveWithObject: true });
  assert.equal(svg.info.width, 41);
  assert.equal(svg.info.height, 40);
  assert.equal(svg.data.length, 41 * 40 * svg.info.channels);
  assert.ok(svg.data.some((value) => value !== 0));
}
Promise.all([
  verifySharp('app Sharp', appRequire),
  verifySharp('Next Sharp', nextRequire),
  new PrismaClient().$disconnect(),
]).catch((error) => {
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
