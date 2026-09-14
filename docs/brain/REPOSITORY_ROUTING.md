# Repository Routing Map

Use this file to choose the smallest initial file set for an EverywherePoster task. Expand only when evidence requires it. Runtime code/tests remain authoritative for implementation behavior.

## Product and workflow UI

- Main application frontend: `postiz-app/apps/frontend/`
- Guided composer / create flow: start in `postiz-app/apps/frontend/src/components/create/` and `postiz-app/apps/frontend/src/components/new-launch/`, then load only the relevant focused frontend tests.
- Account connection / social destination UI: start from the frontend integration/account components plus the backend integrations route only when server behavior is involved.

## Authentication and accounts

- Backend auth entry points: `postiz-app/apps/backend/src/api/routes/auth.controller.ts`
- Authentication/account supporting services: inspect only the directly referenced backend/library files reached from the route.
- Authentication, authorization, reviewer-account, and security changes are high-risk. Do not parallelize or deploy autonomously.

## Social integrations and publishing

- Integration API entry point: `postiz-app/apps/backend/src/api/routes/integrations.controller.ts`
- Platform/provider implementations: route from the integration/provider referenced by the failing behavior rather than scanning every provider.
- Post creation, scheduling, retry, or publishing: start from the specific published-post route/service and relevant orchestrator workflow; use focused `published-posts` tests.
- Platform verification/dashboard work is external-system work. Repository configuration does not prove provider approval.

## Copy generation and AI adaptation

- Copy-generation backend/library code: start in the copy-generation area under `postiz-app/libraries/nestjs-libraries/src/` and the API route that invokes it.
- Focused tests: `postiz-app/tests/copy-generation/` and maintained copy-generation Jest config.
- Knowledge-base behavior: start from `knowledge-base.controller.ts` and its directly referenced library/service code; use knowledge-base tests.
- Verify current implementation before treating planning/spec docs as live behavior.

## Media, transcription, frames, and future media intelligence

- Media upload/acquisition: start from `media.controller.ts`, the directly referenced media service/storage code, and focused media/copy-generation tests.
- Guided transcription: begin from the guided composer source-media state plus the backend transcription/media path reached by that flow.
- Video/frame analysis: start from the existing copy-generation video-media/frame services and `postiz-app/tests/copy-generation/` frame/media tests.
- Before importing TRA media-intelligence concepts, audit EverywherePoster contracts first; do not copy TRA-specific business rules or permissions.

## Image assets and image generation

- Image asset API entry point: `postiz-app/apps/backend/src/api/routes/image-assets.controller.ts`
- Follow only the image-generation/storage services referenced by that route and the UI surface invoking them.
- For the planned TRA-quality image-intelligence workstream, first read `docs/brain/CURRENT_WORK.md`, then perform a bounded audit of existing image/media/copy-generation paths before proposing architecture changes.

## Analytics and imported/historical content

- Analytics API entry point: `postiz-app/apps/backend/src/api/routes/analytics.controller.ts`
- Load only the selected platform analytics implementation and focused tests.
- Preserve product truth: missing data is not zero, and historical/imported posts remain read-only unless a separately approved duplicate/edit flow exists.

## Billing

- Billing API entry point: `postiz-app/apps/backend/src/api/routes/billing.controller.ts`
- Billing/payment changes are high-risk. Inspect the specific provider path, contracts, and tests; require explicit approval for behavior or production changes.

## Database and persistence

- Prisma schema: `postiz-app/libraries/nestjs-libraries/src/database/prisma/schema.prisma`
- Do not infer migration safety from code alone. Read `OPERATING-MANUAL.md` and relevant open issue/plan before database changes.
- Database schema/migration and production-data work is high-risk and must not be unattended or parallelized.

## Orchestration and scheduled work

- Runtime orchestrator: `postiz-app/apps/orchestrator/`
- Load the exact workflow/activity invoked by the affected route/service.
- Temporal behavior should be changed with focused workflow tests and compatibility awareness; do not scan all workflows by default.

## Deployment, Docker, CI, and production operations

Read `OPERATING-MANUAL.md` first.

- Production image build: `.github/workflows/build-postiz-ghcr.yml`
- Pull-request CI: `.github/workflows/pull-request-ci.yml`
- Production deploy: `.github/workflows/deploy-production.yml`
- Docker build classification: `scripts/classify-docker-build.sh`
- App image definition: currently `postiz-app/Dockerfile.dev`; GitHub Issue #15 owns the planned production multi-stage runtime image.
- Compose/runtime: `docker-compose.yaml` and deployment scripts referenced by the production workflow.
- Health/readiness: GitHub Issue #18 owns real application health-check work.

Infrastructure/deployment work is high-risk. Default to one implementation agent and require explicit human merge/deploy approval.

## Agent workflow and project state

- Entry rules: `AGENTS.md`
- Current priorities/checkpoint: `docs/brain/CURRENT_WORK.md`
- Product promises/contracts: `docs/brain/PRODUCT_TRUTH.md`
- ChatGPT/Codex handoff: `docs/brain/CHATGPT_CODEX_HANDOFF.md`
- Implementation/review lifecycle: `docs/brain/CODEX_WORKFLOW.md`
- Multi-agent roles: `docs/brain/DEVELOPMENT_AGENT_SYSTEM.md`
- Operations: `OPERATING-MANUAL.md`

Do not recursively load all brain documents. Start with the narrowest governing source for the task.
