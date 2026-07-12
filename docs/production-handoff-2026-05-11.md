# Production Deployment Handoff

> Current operational summary. `OPERATING-MANUAL.md` is the source of truth when this file and another note disagree.

## Current Production Model

- Canonical branch: `main`
- Server checkout: `/home/arund/publish-everywhere-git`
- Public URL: `https://publisheverywhere.halowebsites.com`
- Application image: `ghcr.io/celleree/publish-everywhere-postiz:<full-commit-sha>`
- Local runtime tag: `publish-everywhere/postiz-app:custom`
- Runtime container: `postiz`
- Production images are built by GitHub Actions and pulled by exact full commit SHA.
- App-only deployments recreate only the `postiz` container.

## Safe Deployment Flow

1. Merge a reviewed pull request into `main`.
2. Confirm the `Build Postiz image` workflow succeeds for the exact merge commit.
3. Confirm the Hetzner checkout is clean and points at the intended commit.
4. Pull the exact full-SHA GHCR image.
5. Tag that image as `publish-everywhere/postiz-app:custom`.
6. Recreate only `postiz` without building locally.
7. Check container state and logs.
8. Verify the public route and the exact changed behavior in the browser.

Reference commands:

```bash
cd /home/arund/publish-everywhere-git

git status --short
git rev-parse HEAD

FULL_SHA=$(git rev-parse HEAD)
docker pull ghcr.io/celleree/publish-everywhere-postiz:${FULL_SHA}
docker tag \
  ghcr.io/celleree/publish-everywhere-postiz:${FULL_SHA} \
  publish-everywhere/postiz-app:custom

docker compose up -d --no-build --no-deps --force-recreate postiz
sleep 45
docker inspect postiz --format 'status={{.State.Status}} image={{.Image}} restart_count={{.RestartCount}}'
docker logs --tail 120 postiz
curl -ksSL -o /dev/null -w 'HTTP=%{http_code} URL=%{url_effective}\n' \
  https://publisheverywhere.halowebsites.com/
```

Use the full commit SHA. Do not deploy from `latest` alone.

## Obsolete 2026-05-11 Instructions

The following details from the original handoff are historical and must not be used for current deployments:

- The `snapshot/local-working-state-2026-04-29` branch
- `/opt/publish-everywhere` as the active source checkout
- `rsync` from a local machine into production
- `docker compose ... up --build`
- Rebuilding `public-web` for an app-only code change
- Treating the production folders as a non-Git source tree

Git history preserves the original 2026-05-11 handoff if historical investigation is required.

## Production Safety

Never perform these actions as part of a routine app deploy:

```bash
docker compose down -v
docker volume prune
docker system prune --volumes
prisma migrate reset
prisma db push --force-reset
```

Additional rules:

- Do not build the full application image on Hetzner.
- Do not restart every service for an app-only change.
- Do not run Prisma schema commands casually against production.
- Do not claim deployment success from GitHub Actions alone.
- Do not delete the previous known-good image before rollback needs are understood.

## Rollback

1. Identify the last known-good full commit SHA or retained rollback image.
2. Pull it from GHCR if it is not already local.
3. Tag it as `publish-everywhere/postiz-app:custom`.
4. Recreate only `postiz` with `--no-build --no-deps`.
5. Check logs and manually verify the public app.

Do not remove or recreate database, Redis, Temporal, config, or uploads volumes during an application rollback.
