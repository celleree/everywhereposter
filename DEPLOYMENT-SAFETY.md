# Deployment Safety

Use this checklist before any public deploy or tunnel exposure.

## Before Deploy

- Take a database backup first: `scripts/backup-postgres.sh`.
- Confirm `DATABASE_URL` points at the intended database. The bundled `postiz-postgres` Docker service is a local database, not production data.
- Confirm `PUBLIC_BASE_URL` and `PUBLIC_BACKEND_URL` are explicitly set for the environment being started.
- Never run `docker compose down -v` against production.
- Never run `docker volume rm` or `docker volume prune` for production volumes.

## Public Tunnel

Cloudflared is opt-in. Normal `docker compose up -d` should not expose this stack publicly.

Start the public tunnel only when intended:

```sh
docker compose --profile public-tunnel up -d cloudflared
```

Before enabling it, confirm the domain and database belong together. A public domain pointed at the bundled local Docker DB can make real user data look deleted because the app is serving from a fresh database.

## Required Public Env Vars

- `PUBLIC_BASE_URL`
- `PUBLIC_BACKEND_URL`
- `DATABASE_URL`
- `JWT_SECRET`
- `CLOUDFLARED_CREDENTIALS_FILE` when using the `public-tunnel` profile

Startup refuses `publisheverywhere.halowebsites.com` with the bundled local Docker Postgres unless `ALLOW_PUBLIC_DOMAIN_WITH_LOCAL_DB=true` is set after a deliberate review.

Prisma `db push` is skipped by default in public-domain mode. Set `RUN_PRISMA_DB_PUSH_IN_PUBLIC_MODE=true` only when schema changes are intended, or set `SKIP_PRISMA_DB_PUSH=true` to skip it explicitly.

## Rollback / Restore Basics

1. Stop public traffic or disable the tunnel.
2. Keep the current failed state intact until a backup is taken, if possible.
3. Restore from the latest known-good SQL backup into the intended database.
4. Start the stack with the expected `DATABASE_URL`.
5. Verify login, organization data, integrations, posts, and media before re-enabling public traffic.
