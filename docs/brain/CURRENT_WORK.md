# Current Work

Updated: 2026-09-13

Use this file when the user asks to continue the project, continue a roadmap, decide what to do next, or coordinate work across multiple EverywherePoster workstreams. Do not load it for a narrow bug with an already-named issue or file unless the current priority matters.

This file is a routing/checkpoint document, not proof that code is deployed or that an external provider dashboard is configured. Live GitHub state, runtime code/tests, and direct external verification remain authoritative for those facts.

For long-running local Codex Desktop orchestration, also follow `docs/brain/ORCHESTRATOR_PROTOCOL.md`.

## Current release objective

Get EverywherePoster to a safe early paid launch with the core repurposing/publishing workflow usable, external social-app reviews completed, and production operations verified.

## Priority workstreams

### 1. External platform verification — ACTIVE

- Meta Facebook/Instagram/Threads review evidence is being completed outside the repository.
- TikTok app verification and reviewer access are in progress outside the repository.
- GitHub Issue #47 still tracks Meta and TikTok as external systems that require direct verification.
- Repository callback URLs, legal links, or configuration are not proof that a provider has approved the app.
- Do not claim a provider review is complete unless the provider dashboard or the user confirms it.

### 2. Launch readiness — ACTIVE / PARTIAL

Before calling the product launch-ready or recommending that paid acquisition begin, confirm the applicable release gates rather than inferring them from merged code:

- required Meta/TikTok provider review is complete;
- signup/authentication and transactional email work in production;
- billing/payment behavior intended for launch is confirmed;
- the intended publishing paths pass controlled smoke tests;
- the exact production revision and configuration are verified.

Do not turn launch-readiness work into broad cleanup. Fix only blockers that materially affect launch.

### 3. CI / Docker / Hetzner deployment performance — ACTIVE

Canonical roadmap: `docs/brain/DEPLOYMENT_PERFORMANCE_ROADMAP.md`.

The current pipeline is much slower than the TRA/Vercel workflow because EverywherePoster performs full GitHub Actions validation, Docker packaging/cache export, GHCR transfer, image extraction, and container startup work.

Current checkpoint:

- Phase 0 baseline / dependency graph — COMPLETE.
- Phase 1A — NEXT: parallelize PR Docker validation with quality checks while preserving the existing final `Docker build` gate as fail-closed.
- Do not rerun Phase 0 unless new evidence materially contradicts the recorded baseline.

Remaining roadmap:

1. Phase 1 — low-risk CI/deploy improvements supported by the Phase 0 evidence.
2. Phase 2 — production multi-stage runtime image. GitHub Issue #15 owns the production Dockerfile objective.
3. Phase 3 — BuildKit/pnpm cache optimization and safe build concurrency based on measured evidence.
4. Phase 4 — avoid unnecessary Docker packaging for changes that do not require it while preserving deterministic CI gates.
5. Phase 5 — optimize exact-SHA Hetzner deployment and readiness verification. GitHub Issue #18 owns meaningful application health/readiness checks.
6. Phase 6 — benchmark representative frontend, backend, dependency, Docker, and config-only changes and update operating documentation to the proven workflow.

Preserve the GitHub -> GHCR -> Hetzner architecture unless a separately approved architecture decision changes it.

### 4. TRA-quality media intelligence and image generation — PLANNED

The desired direction is to bring the useful planning/intelligence patterns from `tra-ai-marketing` into EverywherePoster so source media can produce higher-quality image/post assets.

Before implementation:

- audit the current EverywherePoster transcription, frame/media analysis, copy generation, knowledge-base, and image-generation paths;
- compare contracts and behavior, not just filenames;
- identify the smallest reusable concepts worth porting;
- keep source-content-first product positioning intact;
- do not copy TRA-specific tax-relief claims, data models, brand assumptions, or advertising permissions;
- do not introduce a claim that one uploaded video becomes many newly generated AI videos.

Create a bounded issue/plan before runtime implementation.

### 5. Known guided-composer product gaps — BACKLOG / LAUNCH RELEVANCE VARIES

- Issue #86: silent/no-transcript media handling and future visual-context generation.
- Issue #87: YouTube guided-publish description mapping and AI title generation.
- Issue #80: stale source state when replacing an active video with Media Library media.

Do not automatically prioritize these above provider verification or release blockers; assess whether each one is required for the intended launch slice.

## Recently completed repository work

- PR #93 — public Terms/Privacy links from signup for reviewer access.
- PR #94 — Docker dependency-install cache layering.
- PR #95 — production deploy path uses the verified `noreply@everywhereposter.com` sender and checks the container value.
- PR #96 — agent grounding/current-work system.
- PR #97 — deployment-performance roadmap.
- Deployment-performance Phase 0 — completed as an audit-only checkpoint with no repository or production changes.

A merged production/config fix is not proof of runtime behavior until the applicable production deployment/configuration has been verified.

## Parked / not current by default

- PR #83 prompt-guided video editor work is not a current priority. Do not resume it unless the user explicitly reactivates it.
- PR #82 Codex verification-loop automation remains separate from ordinary local Codex orchestration. Do not treat the draft PR as required for the root orchestrator protocol.
- Broad rebrand cleanup in Issue #47 is a tracker. Use its outstanding items when they block launch or external verification rather than reopening completed rebrand work.

## Next bounded engineering task

The default next engineering task is **CI / Docker / Hetzner performance Phase 1A: parallelize PR Docker validation with quality checks while preserving the existing final `Docker build` gate as fail-closed.**

Keep Phase 1A narrow. Do not combine cache redesign, readiness changes, pruning changes, test deduplication, production image redesign, production publishing changes, branch-protection changes, or classifier allowlist changes.

After implementation, measure actual job overlap and total PR time against the Phase 0 baseline. Use a fresh GPT-5.6 Sol / High independent review against the exact PR HEAD before merge. Merge remains a human approval gate.

## Update rule

Update this file only when a material workstream changes state, a new priority supersedes the current one, or a roadmap checkpoint is completed. Do not turn it into a chronological activity log.

When updating it:

- verify live GitHub state first;
- distinguish repository-complete, production-verified, and externally-verified states;
- reference durable Issues/PRs where useful;
- remove stale next-step instructions;
- never store passwords, tokens, reviewer credentials, production secrets, or raw logs here.
