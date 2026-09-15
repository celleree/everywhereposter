#!/bin/sh
set -eu

IMAGE_TAG="${1:?usage: verify-production-image.sh IMAGE_TAG}"
CONTAINER_NAME="postiz-runtime-check-$$"

cleanup() {
  docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

docker run --rm --entrypoint /bin/sh "$IMAGE_TAG" -ec '
  command -v node >/dev/null
  command -v pnpm >/dev/null
  command -v nginx >/dev/null
  command -v ffmpeg >/dev/null
  command -v ffprobe >/dev/null

  ! command -v g++ >/dev/null
  ! command -v make >/dev/null
  ! command -v python3 >/dev/null
  ! command -v pip >/dev/null
  ! command -v pm2 >/dev/null
  test ! -e /app/node_modules/jest
  test ! -e /app/apps/frontend/.next/cache
  ! find /app/apps/backend/dist /app/apps/orchestrator/dist \
      -type f \( -name "*.d.ts" -o -name "*.tsbuildinfo" \) | grep -q .

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
  node -e "const p=require(\"prisma/package.json\"); if(p.version!==\"6.5.0\") process.exit(1)"
  CHECKPOINT_DISABLE=1 PRISMA_HIDE_UPDATE_MESSAGE=1 \
    DATABASE_URL=postgresql://runtime:runtime@127.0.0.1:5432/runtime \
    /app/node_modules/.bin/prisma validate \
      --schema /app/libraries/nestjs-libraries/src/database/prisma/schema.prisma >/dev/null
  node <<"NODE"
const bcrypt = require("bcrypt");
const sharp = require("sharp");
const { PrismaClient } = require("@prisma/client");
require("@temporalio/worker");

if (!bcrypt.compareSync("runtime-check", bcrypt.hashSync("runtime-check", 4))) {
  throw new Error("bcrypt runtime check failed");
}

Promise.all([
  sharp({ create: { width: 1, height: 1, channels: 4, background: "#000000" } })
    .png()
    .toBuffer(),
  new PrismaClient().$disconnect(),
]).then(([image]) => {
  if (image[0] !== 0x89 || image.toString("ascii", 1, 4) !== "PNG") {
    throw new Error("sharp runtime check failed");
  }
}).catch((error) => {
  console.error(error.message);
  process.exit(1);
});
NODE
'

docker run -d \
  --name "$CONTAINER_NAME" \
  --entrypoint /bin/sh \
  "$IMAGE_TAG" \
  -ec 'cd /app && pnpm --filter ./apps/frontend start' >/dev/null

ATTEMPT=0
until docker exec "$CONTAINER_NAME" node -e '
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
    docker logs "$CONTAINER_NAME"
    exit 1
  fi
  sleep 1
done

echo "Production image artifact, native dependency, and frontend checks passed for $IMAGE_TAG"
