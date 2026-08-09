# Deployment Notes

Deployment memory for EverywherePoster. `OPERATING-MANUAL.md` remains the source of truth; this file captures durable deployment lessons and reminders.

## Current Model

- GitHub Actions builds the app image.
- Deploy using the full commit SHA image from GHCR.
- Tag the exact pulled image locally as `publish-everywhere/postiz-app:custom`.
- Restart only the `postiz` container for app-only deploys.
- Confirm logs and manually verify the changed behavior.

## Safety Rules

- Do not use short SHAs for deployment.
- Do not prune Docker volumes casually.
- Do not run destructive Prisma/database commands in production.
- Do not treat GitHub Actions success alone as deployed.
- Do not start local WSL Docker/cloudflared unless local work is intentional.

## Prisma Migration Baseline

The first checked-in Prisma migration is
`20260808000000_existing_schema_baseline`. It represents the schema that
already existed before migration history was added. The guided transcription
tables are in the separate
`20260809000000_media_transcription_lifecycle` migration.

For a new empty database, run the normal deploy path. `prisma migrate deploy`
must apply both migrations; do not mark the baseline manually.

For an existing EverywherePoster database, complete this one-time preparation
before the first deploy containing these migrations:

1. Confirm the target `DATABASE_URL` and take a database backup.
2. Pull the exact full-SHA target image and tag it as
   `publish-everywhere/postiz-app:custom` without restarting the running
   container.
3. Mark only the pre-feature baseline as applied:

```bash
docker compose run --rm --no-deps --entrypoint /bin/sh postiz -lc \
  'cd /app && pnpm exec prisma migrate resolve --applied 20260808000000_existing_schema_baseline --schema libraries/nestjs-libraries/src/database/prisma/schema.prisma'
```

4. Run `scripts/deploy-production.sh` with the same full commit SHA. The deploy
   script runs `prisma migrate deploy` before replacing the current container,
   so a migration failure leaves the existing application container running.

Never resolve the feature migration manually, and never use `prisma db push`,
`migrate reset`, or force/reset commands for this rollout.

## Entry Template

```md
## YYYY-MM-DD - Short Title

- Context:
- Finding:
- Safe command or check:
- Evidence:
```
