# Current Work

Updated: 2026-09-14

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
- Phase 1A — COMPLETE via PR #100. PR CI fell from the 13m46s–13m55s baseline to 10m05s on the measured post-change run, with 3m56s of actual quality/Docker overlap (about 27% faster).
- Phase 1B — COMPLETE via PR #101 and controlled deployment run [34910728355](https://github.com/celleree/everywhereposter/actions/runs/34910728355). The deploy script measured 56s total at whole-second resolution: pull 2s, runtime-image preparation 0s, migration 3s, recreate 3s, fixed wait 45s, container verification 0s, and proxy reload 3s. The full workflow took 91s.
- Controlled runtime/public smoke — LIMITED PASS: Nginx-proxied backend `/api/`, frontend `/auth/login`, and orchestrator `/health/status` returned HTTP 200; the orchestrator response was `{"status":"ok"}`. A fresh anonymous browser context rendered `/auth/login` with the expected title and login controls. One React hydration error #418 appeared; authenticated login, form submission, and publishing were not tested.
- Phase 4 — REPOSITORY COMPLETE via PR #103 for the bounded excluded-Markdown classifier change; no production timing claim is attached to it.
- Phase 2 — FINAL CI: PR #106 is at independently reviewed head `b833635ce7a9fbf117a16bf7a209253e6e9d7f1b`. Merge and production adoption remain gated; Phase 3 still waits for the settled image.
- Phase 3 — READ-ONLY ANALYSIS COMPLETE: implementation waits for a settled Phase 2 image and representative post-Phase-2 measurements.
- Phase 5 — REPOSITORY COMPLETE; COMBINED DEPLOYMENT VALIDATION PENDING. Phase 5A internal readiness was production-verified via PR #105/run [34914337122](https://github.com/celleree/everywhereposter/actions/runs/34914337122). Phase 5B bounded public retry/backoff merged via PR #108 (merge `a4cd3c16e63729d5afb65d8a7b6e6efb16109a11`; reviewed head `a1386c62d93f88ab62250eadb120679517f10b80`). Exact-head CI run [34915571174](https://github.com/celleree/everywhereposter/actions/runs/34915571174) passed, and a merged-helper live probe returned HTTP 307 on attempt 1 in 1s. No deployment ran after PR #108, so the combined internal/public workflow stage still requires a separately approved production validation.
- Phase 6 — PARTIAL: docs-only PR #104 run [34912004960](https://github.com/celleree/everywhereposter/actions/runs/34912004960) completed in 313s with a 285s active critical path and skipped Docker validation/package work. This single observation does not establish causal speedup or complete the representative matrix.
- Do not rerun Phase 0 unless new evidence materially contradicts the recorded baseline.

Remaining roadmap:

1. Phase 2 — complete and verify the production multi-stage runtime image under Issue #15.
2. Phase 3 — optimize BuildKit/pnpm caching against the settled Phase 2 image and measurements.
3. Phase 5 — run a separately approved production validation of the combined internal and public readiness path under Issue #18.
4. Phase 6 — finish the representative frontend, backend, dependency, Docker, and config benchmark matrix and update operating documentation to verified behavior.

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
- PR #100 — Phase 1A parallel PR Docker validation, measured at 10m05s versus the 13m46s–13m55s baseline.
- PR #101 — Phase 1B observational deployment-stage timing instrumentation, exercised successfully in controlled run [34910728355](https://github.com/celleree/everywhereposter/actions/runs/34910728355).
- PR #103 — Phase 4 Docker classifier skips explicitly excluded Markdown changes while retaining fail-closed behavior.
- PR #104 — deployment-performance policy and measurement checkpoint; its docs-only CI run skipped Docker validation/package work.
- PR #105 — bounded application readiness and deployment health polling; internal readiness production-verified in controlled run [34914337122](https://github.com/celleree/everywhereposter/actions/runs/34914337122).
- PR #108 — bounded public readiness retry/backoff; repository-complete with a direct live-helper HTTP 307 response, while combined deployment verification remains pending.

A merged production/config fix is not proof of runtime behavior until the applicable production deployment/configuration has been verified.

## Parked / not current by default

- PR #83 prompt-guided video editor work is not a current priority. Do not resume it unless the user explicitly reactivates it.
- PR #82 Codex verification-loop automation remains separate from ordinary local Codex orchestration. Do not treat the draft PR as required for the root orchestrator protocol.
- Broad rebrand cleanup in Issue #47 is a tracker. Use its outstanding items when they block launch or external verification rather than reopening completed rebrand work.

## Next bounded engineering task

Phase 2 PR #106 is under final CI, and Phase 3 waits for that image to settle. Phase 5 repository work is complete; the combined internal/public deployment path awaits separate production approval. Phase 6 has one docs-only observation, with the remaining representative matrix and final consolidation pending.

The deployment-performance auto-merge authorization does not authorize production deployment. All other existing human gates remain unchanged.

## Update rule

Update this file only when a material workstream changes state, a new priority supersedes the current one, or a roadmap checkpoint is completed. Do not turn it into a chronological activity log.

When updating it:

- verify live GitHub state first;
- distinguish repository-complete, production-verified, and externally-verified states;
- reference durable Issues/PRs where useful;
- remove stale next-step instructions;
- never store passwords, tokens, reviewer credentials, production secrets, or raw logs here.
