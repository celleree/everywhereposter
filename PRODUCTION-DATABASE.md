# Production Database Setup

Use a managed PostgreSQL database before onboarding real users. The bundled Docker Postgres service is useful for local testing and short-lived private trials, but it is not the recommended long-term public/user database.

## What `DATABASE_URL` Is

`DATABASE_URL` tells EverywherePoster which PostgreSQL database to use.

Production URLs usually look like this:

```text
postgresql://USERNAME:PASSWORD@DATABASE_HOST:5432/DATABASE_NAME?sslmode=require
```

The exact value comes from your PostgreSQL provider. Never commit the real URL, password, connection string, or copied provider credentials to git.

## Managed PostgreSQL Providers

You can use any managed PostgreSQL provider that gives you a normal PostgreSQL connection string, including Supabase, Neon, Railway, Render, DigitalOcean Managed Databases, AWS RDS, and similar services.

Provider-agnostic setup:

1. Create a managed PostgreSQL database.
2. Copy the provider's PostgreSQL connection string.
3. Put it in `.env` as `DATABASE_URL`.
4. Set the public URLs:

   ```text
   PUBLIC_BASE_URL=https://app.everywhereposter.com
   PUBLIC_BACKEND_URL=https://app.everywhereposter.com/api
   ```

5. Set this for normal production restarts:

   ```text
   SKIP_PRISMA_DB_PUSH=true
   ```

6. Take a backup before migration or deploy.
7. Run schema setup intentionally, not automatically on every restart.
8. Verify row counts and key app flows after deploy.

## Local Docker Postgres Is Not Production

This local URL points at the bundled Docker database:

```text
postgresql://postiz-user:postiz-password@postiz-postgres:5432/postiz-db-local
```

`postiz-postgres` is only the Docker service hostname inside this compose stack. It should not be used as the public production database unless you have deliberately reviewed and accepted the risk.

The public domain guardrail blocks `app.everywhereposter.com` from using the bundled local Docker database unless this reviewed exception is set:

```text
ALLOW_PUBLIC_DOMAIN_WITH_LOCAL_DB=true
```

That exception is only for temporary, deliberate use. It is not recommended for onboarding new users.

## Switching Checklist

Before switching from local Docker Postgres to managed production Postgres:

1. Create the managed PostgreSQL database.
2. Confirm the provider connection string includes SSL when required, often `?sslmode=require`.
3. Save the managed connection string only in `.env` or your deployment secret manager.
4. Confirm `.env` is not committed.
5. Back up the current local database:

   ```sh
   scripts/backup-postgres.sh
   ```

6. Plan how data will be moved, if you need existing local data in production.
7. Run schema setup intentionally against the managed database after the backup and before public traffic.
8. Set `SKIP_PRISMA_DB_PUSH=true` for normal production restarts.
9. Start the stack with the managed `DATABASE_URL`.
10. Verify login, organizations, integrations, posts, media, and scheduled publishing behavior.
11. Compare table row counts before and after migration/deploy.

Example row count check:

```sh
psql "$DATABASE_URL" -Atc "select schemaname || '.' || relname || ' ' || n_live_tup from pg_stat_user_tables order by 1;"
```

`n_live_tup` is approximate, but it is useful for a quick before/after sanity check.

## Never Do This In Production

Do not run these against production data:

- `docker compose down -v`
- `docker volume rm`
- `docker volume prune`
- `prisma migrate reset`
- `prisma db push --force-reset`

Also never commit:

- `.env`
- database passwords
- provider connection strings
- backup files that contain user data

## Temporary Bundled Docker Postgres Use

If you keep using bundled Docker Postgres temporarily with the public domain:

1. Set `ALLOW_PUBLIC_DOMAIN_WITH_LOCAL_DB=true` only after deliberate review.
2. Take a backup before deploy.
3. Understand that Docker volumes can be deleted by destructive Docker commands.
4. Move to managed PostgreSQL before onboarding users.

## Safety Check Script

Run this before a public deploy:

```sh
scripts/check-production-db-safety.sh
```

It prints the public URL, a redacted database URL, whether the database appears to be bundled local Docker Postgres, whether the public-domain/local-DB guardrail would block startup, and whether `SKIP_PRISMA_DB_PUSH` is set.
