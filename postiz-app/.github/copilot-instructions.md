
# Copilot instructions for the application workspace

Read [root AGENTS.md](../../AGENTS.md) first. Use [repository routing](../../docs/brain/REPOSITORY_ROUTING.md) for subsystem ownership and the [handoff protocol](../../docs/brain/CHATGPT_CODEX_HANDOFF.md) for pushed-HEAD CI and independent review. The paths and commands below are relative to `postiz-app/`; they do not authorize dependency installs, database changes, local stack startup, or production operations.

## Project Architecture
- pnpm workspace, with applications in `apps/` and shared code in `libraries/`.
- Main services: `frontend` (Next.js), `backend` (NestJS), and `orchestrator` (Temporal/NestJS); additional workspaces include `commands`, `extension`, and `sdk`.
- Data layer uses Prisma ORM (`libraries/nestjs-libraries/src/database/prisma/schema.prisma`) with PostgreSQL as the default database.
- Temporal orchestration lives in `apps/orchestrator/` and `libraries/nestjs-libraries/src/temporal/`; consult the owning subsystem for Redis usage.
- Email notifications via Resend.
- Social login integrations (Instagram, Facebook) and Make.com/N8N integrations.

## Developer Workflows
- Follow `package.json`: Node `>=22.12.0 <23.0.0`, Volta `22.20.0`, and `pnpm@10.6.1`. CI uses Node `22.20.0`; Docker uses the `22.20` image series.
- When dependency installation is authorized, use the existing pnpm lockfile. Adding dependencies requires explicit approval under root instructions.
- Build frontend, backend, and orchestrator: `pnpm run build`
- Run the applications selected by the root dev script: `pnpm run dev`
- Test: `pnpm test` (Jest, coverage enabled)
- Individual app scripts are in each app's `package.json` (e.g., `pnpm --filter ./apps/backend run dev`).
- For database, Docker, environment, or local-stack work, read [OPERATING-MANUAL.md](../../OPERATING-MANUAL.md) first and retain its approval gates. Do not run schema/reset or stack-start commands as routine setup.

## Conventions & Patterns
- Use conventional commits (`feat:`, `fix:`, `chore:`).
- PRs should include clear descriptions, related issue links, and UI screenshots/GIFs if relevant.
- Comments are required for complex logic.
- Shared code lives in `libraries/` (e.g., helpers, React shared libraries, NestJS modules).
- Environment variables are managed via `.env` and referenced in Docker and scripts.
- Make sure to keep the `.env.example` file updated with new environment variables.

## Integration Points
- External APIs: Social media (Instagram, Facebook), Make.com, N8N, Resend, Stripe, etc.
- SDK (`apps/sdk`) provides programmatic access to Postiz features.
- Extension (`apps/extension`) is built with Vite, React, TypeScript, and Tailwind CSS.

## Key Files & Directories
- `apps/` — Main services and applications
- `libraries/` — Shared code and modules
- `docker-compose.dev.yaml` — Local development Docker setup
- `.env` — Environment configuration
- `jest.config.ts` — Test configuration
- `pnpm-workspace.yaml` — Workspace package management
- `README.md` — General project overview
- `libraries/nestjs-libraries/src/database/prisma/schema.prisma` — Database schema

## Documentation
- Main docs: https://docs.postiz.com/
- Developer guide: https://docs.postiz.com/developer-guide
- Public API: https://docs.postiz.com/public-api

---

# Logs

- Where logs are used, ensure Sentry is imported using `import * as Sentry from "@sentry/nextjs"`
- Enable logging in Sentry using `Sentry.init({ enableLogs: true })`
- Reference the logger using `const { logger } = Sentry`
- Sentry offers a `consoleLoggingIntegration` that can be used to log specific console error types automatically without instrumenting the individual logger calls

## Configuration

The Sentry initialization needs to be updated to enable the logs feature.

### Baseline

```javascript
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  enableLogs: true,
});
```

### Logger Integration

```javascript
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  integrations: [
    // send console.log, console.error, and console.warn calls as logs to Sentry
    Sentry.consoleLoggingIntegration({ levels: ["log", "error", "warn"] }),
  ],
});
```

## Logger Examples

`logger.fmt` is a template literal function that should be used to bring variables into the structured logs.

```javascript
import * as Sentry from "@sentry/nextjs";

const { logger } = Sentry;

logger.trace("Starting database connection", { database: "users" });
logger.debug(logger.fmt`Cache miss for user: ${userId}`);
logger.info("Updated profile", { profileId: 345 });
logger.warn("Rate limit reached for endpoint", {
  endpoint: "/api/results/",
  isEnterprise: false,
});
logger.error("Failed to process payment", {
  orderId: "order_123",
  amount: 99.99,
});
logger.fatal("Database connection pool exhausted", {
  database: "users",
  activeConnections: 100,
});
```

---

For questions or unclear conventions, check the main README or ask for clarification in your PR description.

