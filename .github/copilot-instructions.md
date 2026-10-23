# EverywherePoster repository instructions

Follow [AGENTS.md](../AGENTS.md) for task scope, source precedence, verification, and approval gates. Use [REPOSITORY_ROUTING.md](../docs/brain/REPOSITORY_ROUTING.md) to select the smallest relevant source and focused tests; use [PRODUCT_TRUTH.md](../docs/brain/PRODUCT_TRUTH.md) for product claims and [CURRENT_WORK.md](../docs/brain/CURRENT_WORK.md) for project continuation.

The app workspace is `postiz-app/`. Read its Node engine and exact pnpm pin from [package.json](../postiz-app/package.json). Use its [test guide](../postiz-app/tests/README.md) and existing scripts for focused validation.

Read [OPERATING-MANUAL.md](../OPERATING-MANUAL.md) before runtime, database, environment, or deployment work. Preserve dirty work; do not start local services, reset a database, enable telemetry, add dependencies, merge, or deploy merely to set up an unrelated task. Existing explicit authorization and human gates govern those actions.

For app-specific coding conventions, see [CLAUDE.md](../postiz-app/CLAUDE.md). Keep this adapter aligned with canonical guidance rather than copying operational commands or model defaults here.
