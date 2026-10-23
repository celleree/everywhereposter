# Current Work

Updated: 2026-10-23

Use this file when the user asks to continue the project, continue a roadmap, decide what to do next, or coordinate work across multiple EverywherePoster workstreams. Do not load it for a narrow bug with an already-named issue or file unless the current priority matters.

This file is a routing/checkpoint document, not proof that code is deployed or that an external provider dashboard is configured. Live GitHub state, runtime code/tests, and direct external verification remain authoritative for those facts.

For long-running local Codex Desktop orchestration, also follow `docs/brain/ORCHESTRATOR_PROTOCOL.md`.

## Current release objective

Get EverywherePoster to a safe early paid launch with the core repurposing/publishing workflow usable, external social-app reviews completed, and production operations verified.

## Priority workstreams

### Agent context consistency — bounded remediation

The current documentation repair reconciles assistant entry instructions, subsystem routing, model guidance, and stale checkpoints. Remaining work is separate: immutable candidate review and review receipts; context-validation/recovery checks; dispatch-CI identity and runner diagnosis; approved-path and validation-evidence safeguards before any unattended write activation. Documentation changes do not establish those executable protections or authorize their activation.

### Video Editor — integration merged; design checkpoint separate

Verified against GitHub on 2026-10-23: [PR #214](https://github.com/celleree/everywhereposter/pull/214) merged on October 17. Do not reopen it as an unfinished integration. Use [VIDEO-EDITOR-BACKEND.md](../VIDEO-EDITOR-BACKEND.md) and current code/tests for implemented behavior.

[PR #251](https://github.com/celleree/everywhereposter/pull/251) remains an open draft design preview; its description records a visual-feedback checkpoint and paused production integration. Recheck that PR's current evidence and user direction before resuming its implementation. Preserve the separate paused billing candidate and existing entitlement behavior.

The previous ordinary-release authorization expired on October 19 Pacific. It is historical evidence, not current permission. A new release must have applicable current authorization; this checkpoint grants none.

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

### 3. CI / Docker / Hetzner deployment performance — REPOSITORY CHECKPOINT

Verified on 2026-10-23 against GitHub and repository sources:

- [Issue #15](https://github.com/celleree/everywhereposter/issues/15), the production runtime image, is closed. Both image-build workflows use `postiz-app/Dockerfile.production`.
- [Issue #16](https://github.com/celleree/everywhereposter/issues/16), removing automatic Prisma db push from routine startup, is closed. The operating manual owns explicit schema preparation and migration procedures.
- [Issue #18](https://github.com/celleree/everywhereposter/issues/18), application health checks, is closed. Existing readiness entry points are listed in [REPOSITORY_ROUTING.md](REPOSITORY_ROUTING.md#deployment-docker-ci-and-production-operations).
- [Issue #17](https://github.com/celleree/everywhereposter/issues/17), Temporal persistence/backup work, remains open; selecting it requires its own bounded operational plan and applicable approvals.

[DEPLOYMENT_PERFORMANCE_ROADMAP.md](DEPLOYMENT_PERFORMANCE_ROADMAP.md) retains historical measurements and phase acceptance criteria. Old repair/blocker descriptions and timings are not current task status or evidence of current performance. Verify remaining benchmark/cache work before selecting it; do not repeat Phase 0 without contradictory new evidence.

Use [OPERATING-MANUAL.md](../../OPERATING-MANUAL.md) for current procedures and [RELEASE-LEDGER.md](../RELEASE-LEDGER.md) for recorded release evidence. Closed issues and implemented scripts do not prove current production or feature acceptance. Preserve the GitHub -> GHCR -> Hetzner architecture unless separately approved.

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

## Repository completion and release evidence

Use the dated checkpoints above and live Issues/PRs for repository completion. Historical performance measurements remain in the roadmap; verified release records belong in [RELEASE-LEDGER.md](../RELEASE-LEDGER.md). A merged change is not proof of runtime or external-provider acceptance.

## Parked / not current by default

- PR #83 prompt-guided video editor work remains parked. PR #214 is merged; PR #251 is a separate design checkpoint, not authorization for replacement implementation.
- PR #82 Codex verification-loop automation remains separate from ordinary local Codex orchestration. Do not treat the draft PR as required for the root orchestrator protocol.
- Broad rebrand cleanup in Issue #47 is a tracker. Use its outstanding items when they block launch or external verification rather than reopening completed rebrand work.

## Next bounded agent-system task

After the documentation consistency change, pin automated review to an immutable candidate/base and preserve exact-SHA review evidence. Decide whether automated review is advisory or required before changing GitHub enforcement. Runner recovery, CI-dispatch repair, context checks, and unattended-write safeguards stay separate bounded tasks. Follow the active user request when choosing the next workstream; this list does not authorize merge, deployment, provider calls, or runner activation.

## Update rule

Update this file only when a material workstream changes state, a new priority supersedes the current one, or a roadmap checkpoint is completed. Do not turn it into a chronological activity log.

When updating it:

- verify live GitHub state first;
- distinguish repository-complete, production-verified, and externally-verified states;
- reference durable Issues/PRs where useful;
- remove stale next-step instructions;
- never store passwords, tokens, reviewer credentials, production secrets, or raw logs here.
