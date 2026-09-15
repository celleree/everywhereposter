# Deployment Performance Roadmap

Updated: 2026-09-14

## Purpose

Reduce the elapsed time for EverywherePoster pull-request CI, production image builds, GHCR transfer, and Hetzner deployment without weakening correctness, reviewability, rollback safety, or the current GitHub -> GHCR -> Hetzner architecture.

This roadmap is coordinated by a long-running root/orchestrator session. Implementation and independent review should happen in bounded Codex sessions so the root context stays small.

## Success criteria

The work is complete when:

- representative PR CI runs are materially faster than the current baseline;
- source-only changes avoid unnecessary Docker packaging where safely possible;
- production image build/export/push time is materially reduced;
- the production runtime image is significantly smaller than the current development-style image;
- normal Hetzner deploys reuse layers instead of routinely discarding them first;
- fixed startup sleeps are replaced with bounded readiness checks;
- exact-SHA deployment and rollback guarantees remain intact;
- all performance changes are measured before and after;
- operating documentation matches the verified final behavior.

Do not set a target solely by comparison with Vercel. EverywherePoster runs a different containerized stack. Optimize for the fastest safe version of the current architecture.

## Orchestration model

### Root / orchestrator

Recommended route:

- Model: Astra
- Reasoning: High
- Role: architecture, sequencing, phase status, PR sizing, model routing, integration decisions, checkpoint ownership

The root orchestrator should not ingest large terminal logs or implement every phase itself. After each bounded implementation/review session, keep only a compact checkpoint containing:

- phase/status;
- branch/base/head SHA;
- files changed;
- verified result;
- measured before/after timings;
- risks/blockers;
- next bounded action.

### Implementation sessions

Use the cheapest model likely to complete the bounded task correctly:

- Terra / Medium: straightforward workflow or script edits once the design is settled.
- Sol / High: Docker architecture, BuildKit/cache design, unfamiliar infrastructure debugging, substantial independent review.
- Astra / High: only for cross-phase architecture, repeated failures, or unusually consequential infrastructure decisions.

Use a fresh independent reviewer when repository policy requires it. Infrastructure/deployment safeguards should be treated as high risk.

## General constraints

- Preserve exact full-SHA image deployment.
- Preserve GHCR as the production image registry unless a separately approved architecture decision changes it.
- Preserve GitHub Actions as the deterministic CI/build gate unless separately approved.
- Preserve the ability to roll back to a known-good image.
- Do not trade correctness for speed by skipping required tests without evidence.
- Do not merge broad unrelated cleanup into performance PRs.
- Prefer the smallest coherent PR per phase or sub-phase.
- Record timings from actual workflow/build/deploy evidence, not estimates.
- Do not run destructive Docker-volume or database operations as part of performance work.

### Roadmap-specific merge authorization

For pull requests bounded to this roadmap, the root orchestrator or assigned responsible agent may merge without another confirmation only when the independent exact-HEAD review passes, all required CI/checks are green, the reviewed HEAD is unchanged, GitHub reports the PR mergeable, and no review finding remains unresolved. The authoritative procedure is in `docs/brain/ORCHESTRATOR_PROTOCOL.md`.

This exception authorizes merge only. It does not authorize an otherwise blocked implementation or production deployment, and it does not change merge gates outside this roadmap. After merging, verify live `main`, reconcile affected worktrees and dependencies, and continue newly unblocked roadmap work.

## Phase 0 — Baseline and dependency graph

### Status

COMPLETE.

### Goal

Measure the current pipeline and identify the real critical path before changing implementation.

### Scope

Audit only. No workflow, Dockerfile, deployment-script, dependency, or runtime edits.

Measure at least:

- PR CI total elapsed time;
- repository guard time;
- dependency install time;
- typecheck/test time;
- Docker-classifier behavior;
- Docker build compile time;
- image export time;
- BuildKit cache export time;
- production image size and major layers;
- post-merge production image build/push time;
- GHCR pull/extract time on Hetzner;
- routine image-prune time when enabled;
- container recreate/startup time;
- current fixed wait time;
- external readiness/health-check time.

Also identify duplicated work between PR CI and post-merge image builds.

### Deliverable

A concise benchmark table and dependency graph with:

- current critical path;
- top three bottlenecks by elapsed time;
- cold-cache versus warm-cache observations where available;
- smallest Phase 1 change recommended by evidence.

### Exit gate

Do not start Phase 1 until the baseline is recorded and the first optimization can be tied to measured evidence.

## Phase 1 — Low-risk CI and deploy quick wins

### Status

COMPLETE.

Phase 1A is complete via PR #100. The measured Docker-required PR elapsed time fell from 13m46s–13m55s to 10m05s in the first post-change observation, with 3m56s of actual quality/Docker overlap (about 27% faster). This proves the serialized quality wait was removed; it does not demonstrate faster image compilation or cache export.

Phase 1B is complete via PR #101 and controlled deployment run [34910728355](https://github.com/celleree/everywhereposter/actions/runs/34910728355). At whole-second resolution the deploy script measured: pull 2s, runtime-image preparation 0s, migration 3s, recreate 3s, fixed startup wait 45s, container verification 0s, proxy reload 3s, and total 56s; the full workflow took 91s.

The run redeployed the same already-running full-SHA image with pruning disabled and no pending or applied migrations. Treat the 2s pull as a warm/no-change observation, not a cold-pull benchmark.

### Goal

Remove avoidable waiting and serialization without redesigning the production image.

### Candidate changes

Only implement items supported by Phase 0 evidence. Likely candidates include:

- run independent PR checks in parallel rather than forcing Docker validation to wait for unrelated quality work;
- replace fixed startup sleeps with bounded readiness polling;
- avoid routine `docker image prune -af` before every normal deployment;
- retain the current and previous known-good image/layers for rollback and reuse;
- add timing output around major deploy stages;
- improve failure diagnostics when readiness times out.

### Safety requirements

- do not weaken required PR gates;
- do not hide failed checks behind `continue-on-error` without an enforcement step;
- do not delete rollback images blindly;
- do not change application runtime behavior in this phase.

### Verification

Compare representative before/after PR and deploy timings.

Phase 1B instrumentation remains observational only: it emits major-stage timings without changing waits, readiness checks, pruning defaults, rollback semantics, image selection, migrations, or service recreation behavior. Run [34910728355](https://github.com/celleree/everywhereposter/actions/runs/34910728355) supplies the first controlled measurement; retain the instrumentation for representative future deployments.

## Phase 2 — Production multi-stage runtime image

Related issue: GitHub Issue #15.

### Status

BLOCKED BEFORE EDITS by the prior automatic approval review of the planned Dockerfile/workflow patch. The roadmap merge exception does not itself unblock that rejected action.

### Goal

Replace the development-style production image with a production-oriented multi-stage image.

### Desired architecture

A builder stage may contain compilers, development dependencies, pnpm tooling, source code, and build tooling. The final runtime stage should contain only the artifacts, runtime dependencies, binaries, configuration, and scripts actually needed to run EverywherePoster.

Preserve required production behavior including:

- frontend;
- backend;
- orchestrator/Temporal workers;
- FFmpeg/ffprobe where runtime features require them;
- Nginx behavior where currently required;
- Prisma client/runtime requirements;
- uploads/config mounts;
- the approved startup contract.

### Measure

Before and after:

- compressed image size;
- unpacked image/layer size;
- build/export duration;
- GHCR push duration;
- Hetzner pull/extract duration;
- startup behavior.

### Risk

Infrastructure/high risk. Require fresh independent review of the final exact HEAD before merge.

### Exit gate

Do not adopt the new image for production until CI builds it successfully and a controlled runtime verification demonstrates functional parity for the required services.

## Phase 3 — BuildKit and dependency-cache optimization

### Status

READ-ONLY ANALYSIS COMPLETE. Implementation waits for a settled Phase 2 runtime image and representative post-Phase-2 measurements.

### Goal

Make normal source-only image builds reuse dependency and intermediate build work effectively.

### Investigate

- pnpm cache mounts;
- dependency-layer invalidation boundaries;
- current `cache-from` / `cache-to` behavior;
- `mode=max` versus lower-cost cache export strategies;
- whether cache export is on the critical path;
- workspace build concurrency and runner memory limits;
- whether frontend/backend/orchestrator can safely build with limited parallelism;
- whether repeated Prisma/package postinstall work can be reduced without changing correctness.

### Rules

- optimize warm builds without making cold builds fragile;
- preserve lockfile reproducibility;
- do not increase concurrency until memory/stability evidence supports it;
- measure cache-hit and cold-cache cases separately.

### Verification

Run at least one representative source-only change and one dependency-affecting change.

## Phase 4 — Avoid unnecessary Docker work

### Status

REPOSITORY COMPLETE via PR #103 for the bounded excluded-Markdown classifier change. It preserves fail-closed classification for other paths; no production timing claim is attached to this change.

### Goal

Do not build/package a production container when a change cannot affect that artifact, while retaining deterministic validation.

### Scope

Review and improve the existing Docker-build classifier/path logic.

Potential safe-only classes may include documentation and other explicitly proven non-runtime changes. Do not broadly exempt source areas without evidence.

Consider separating:

- application correctness/build validation;
- Dockerfile/container-contract validation;
- full runtime image packaging/export.

### Rules

- fail closed when classification is ambiguous;
- Docker/dependency/runtime-config changes must still get appropriate image validation;
- do not use path filtering to bypass tests required for affected runtime behavior.

### Verification

Test classifier behavior against representative safe-only and Docker-required diffs.

## Phase 5 — Hetzner deployment and readiness optimization

Related issue: GitHub Issue #18 for meaningful application readiness checks.

### Status

BOUNDED IMPLEMENTATION UNDERWAY. In the first controlled measurement, frontend readiness appeared about 31.5s after container start and orchestrator Nest startup appeared about 50.9s after start. This proves the fixed 45s process check can run before all managed processes report startup; it does not prove full application readiness or determine the final readiness timeout. Post-deploy container-local checks confirmed HTTP 200 from frontend `/api/` and `/auth/login` and from orchestrator `/health/status`; the existing orchestrator route checks the Temporal namespace.

### Goal

Make production deployment mostly: pull changed layers -> tag exact SHA -> run required migration procedure -> recreate only the app service -> become ready -> verify.

### Target improvements

- preserve exact approved SHA throughout deployment;
- retain reusable Docker layers during normal deploys;
- make cleanup explicit/periodic or disk-pressure-driven rather than automatic destructive pruning;
- replace fixed sleeps with bounded internal readiness polling;
- verify public readiness with retry/backoff after the internal app is ready;
- print stage timings and useful diagnostics;
- preserve previous known-good image metadata for rollback;
- avoid restarting unrelated persistent services.

### Safety

- no Docker-volume pruning;
- no database reset/push shortcuts;
- migrations/schema changes remain separately controlled;
- infrastructure/deployment changes require fresh independent review of the final exact HEAD.

### Verification

Run a controlled exact-SHA deployment and capture:

- pull/extract duration;
- recreate duration;
- internal readiness duration;
- external readiness duration;
- total deployment duration;
- rollback evidence if the change modifies rollback mechanics.

## Phase 6 — Benchmark, consolidate, and document

### Status

BENCHMARK PREPARATION COMPLETE. Final representative measurements and consolidation have not started.

### Goal

Prove the accumulated improvements and leave a maintainable operating model.

### Representative benchmark matrix

Measure at least:

- docs-only change;
- frontend/source-only change;
- backend/source-only change;
- dependency/lockfile change;
- Dockerfile/runtime-image change;
- deployment/config-only change where the architecture supports it.

For each, record:

- PR CI duration;
- whether Docker validation/package work ran;
- production image build/push duration when applicable;
- image size when applicable;
- Hetzner deployment duration when applicable.

### Documentation cleanup

Update only after behavior is verified:

- `OPERATING-MANUAL.md`;
- `docs/brain/CURRENT_WORK.md`;
- `docs/brain/DEPLOYMENT_NOTES.md` where useful;
- relevant issues/PRs.

Remove stale instructions such as mandatory fixed sleeps or routine cache destruction once the replacement workflow is proven.

### Completion gate

The roadmap is complete only when the optimized path is measured, CI is green, deployment behavior is verified where changed, documentation matches reality, and remaining risks/follow-ups are explicitly recorded.

## Phase sequencing and PR boundaries

Default sequence:

1. Phase 0 audit.
2. Phase 1 low-risk quick wins.
3. Phase 2 production runtime image.
4. Phase 3 build/cache optimization.
5. Phase 4 unnecessary-Docker-work reduction.
6. Phase 5 Hetzner/readiness optimization.
7. Phase 6 benchmark and documentation.

This ordering may change after Phase 0 if evidence shows a safer/higher-value dependency order. The root orchestrator owns sequencing decisions.

Do not assume one PR per numbered phase. Split a phase when a coherent high-risk change deserves its own review/rollback boundary, and combine only tiny tightly coupled changes when the combined PR is easier to verify than separate PRs.

## Roadmap status protocol

The root orchestrator should classify each phase as:

- NOT STARTED
- ACTIVE
- PARTIAL
- BLOCKED
- COMPLETE

After each merged PR:

1. verify live GitHub state;
2. update the relevant benchmark/checkpoint evidence;
3. reassess the active phase;
4. select the next bounded task;
5. update `CURRENT_WORK.md` only when the durable checkpoint materially changes.

Do not turn this roadmap into a raw chronological log. Use PRs/issues and measured benchmark evidence for detailed history.
