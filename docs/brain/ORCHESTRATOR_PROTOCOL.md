# Root Orchestrator Protocol

Updated: 2026-10-23

## Purpose

Define the default hands-off coordination loop for EverywherePoster when a long-running Codex Desktop root session is orchestrating bounded implementation, review, repair, CI, and roadmap progression.

Automatic merge is authorized only for pull requests bounded to `docs/brain/DEPLOYMENT_PERFORMANCE_ROADMAP.md` and only under the five conditions below. Production deployment and all merges outside that roadmap remain explicit human gates.

## Model and reasoning routing

Permitted coding-agent model IDs:

- `gpt-6-luna`: lighter inspection, extraction, mechanical work, and bounded evidence reporting.
- `gpt-6.1-sol`: ordinary coding, coordination, debugging, and independent review.
- `gpt-6-astra`: only when the permitted smaller models cannot adequately handle the task.

Choose model and reasoning separately. Preserve the configured model and effort unless the user authorizes a change; these role recommendations do not switch a running session. Verify current supported options before recommending a different setting. Do not guess pricing or availability. If a configured model is outside this allowlist, resolve the conflict before launching another agent.

Record observed model, effort, elapsed time, rework, and usage when available; leave unknown values unknown. Do not retry a failed configuration unchanged without new evidence. Model choice never replaces fresh reviewer context or a safety/release gate.

## Bounded release coordinator

After bounded implementation, use the [release-coordinator lifecycle](../GITHUB-HOSTED-DEPLOYMENT.md#bounded-release-coordinator-lifecycle) to coordinate commit/push, PR, CI, exact-HEAD independent review, and subsequent release gates. It owns release transitions; this protocol retains implementation/review roles and existing human gates.

Apply the model and effort policy above to release coordination. Routine evidence checking and reporting can use the lighter route; substantive diagnosis follows the ordinary coding route. Escalation itself does not authorize repair.

Model names are routing guidance, not safety mechanisms. Repository gates and matching live evidence remain authoritative. The release coordinator cannot replace the independent reviewer, general merge approval, or production approval. The roadmap-specific merge exception below remains narrowly scoped.

## Canonical local environment

The normal development checkout is the WSL-native ext4 repository:

`/home/arund/dev/everywhereposter`

Do not use the old Windows-mounted checkout:

`/mnt/c/dev/everywhereposter`

The canonical checkout should remain clean and on `main`. Worker implementation and review sessions should use isolated WSL-native Git worktrees/branches created from current `main`.

Hetzner SSH is reserved for production-specific measurements, runtime verification, and explicitly approved deployment work.

## Root responsibilities

The root orchestrator owns:

- architecture and cross-phase decisions;
- roadmap sequencing and checkpoint status;
- dependency decisions;
- PR sizing and split decisions;
- model/reasoning routing;
- deciding whether parallel work is safe;
- interpreting measurements and CI evidence;
- selecting the next bounded task;
- keeping `CURRENT_WORK.md` and the active roadmap aligned after material checkpoints;
- stopping at human approval gates.

The root should not perform broad implementation itself when a bounded worker session can do the work with a smaller context.

## Startup loop

At the start of a project-continuation cycle:

1. Confirm the canonical checkout path is `/home/arund/dev/everywhereposter`.
2. Confirm the canonical checkout is on `main` and clean.
3. Confirm local `main` matches freshly fetched `origin/main` before START; create each worker using `scripts/start-change.sh ... --worktree` so canonical `main` stays in place and provenance is recorded.
4. Read `AGENTS.md`.
5. Read `docs/brain/CURRENT_WORK.md`.
6. Read only the active roadmap or subsystem documents needed for the current workstream.
7. Verify live GitHub state for current `main`, relevant open PRs, issues, and CI before trusting checkpoint text.
8. Select the highest-priority bounded task that is not externally blocked.

Do not recursively load all repository docs, old PRs, or Git history.

## Bounded execution loop

For each task:

1. Define a narrow task contract with objective, scope, explicit exclusions, verification, and return format.
2. Apply the model and reasoning policy above while preserving the configured session settings.
3. Create an isolated WSL-native branch/worktree from current `main` with START provenance.
4. Dispatch one implementation worker by default.
5. Let the worker investigate and implement only the approved bounded scope.
6. Require focused verification and an exact branch/base/HEAD handoff.
7. Open a pull request when implementation is ready, unless the worker already opened it under the approved workflow.
8. Inspect the PR diff and focused evidence. The named integrator selects one candidate, fetches/synchronizes main if needed, passes `--integrate`, pushes its final HEAD, and waits for matching CI before final review.
9. When independent review is required, dispatch a fresh reviewer against the exact HEAD SHA. The implementer may not serve as the final independent reviewer.
10. Send only concrete review findings or CI failures back to a repair worker/session.
11. If HEAD changes after a required exact-SHA review, obtain fresh review of the new HEAD. A trivial repair may receive a narrowly scoped fresh review.
12. Recheck CI and required gates.
13. When review and CI are complete, apply the roadmap-specific merge authorization below; otherwise stop at the human merge gate.
14. After any merge, verify live `main` and record material checkpoints. Leave waiting/working PRs frozen; do not routinely synchronize or revalidate them just because main advanced.
15. Select the next bounded task and repeat; merge readiness alone does not end the orchestration loop.

## State machine

Use these task states when useful:

- READY
- IMPLEMENTING
- WAITING FOR INTEGRATION
- INTEGRATING
- REVIEWING
- REPAIRING
- CI / VERIFICATION
- AWAITING HUMAN MERGE APPROVAL
- MERGED
- BLOCKED
- COMPLETE

Do not mark work COMPLETE merely because code was written. Required verification, review, and CI must be satisfied first.

## Worktree ownership

The root orchestrator owns worktree lifecycle.

- Keep the canonical checkout on clean `main`.
- Create worker worktrees under a WSL-native path beneath `/home/arund/dev/`.
- One implementation branch/worktree per bounded task.
- Reviewers should inspect the exact PR/HEAD and should not reuse the implementer's conversational context.
- Remove stale local worktrees only after their branch/PR state is understood and no uncommitted work would be lost.
- Never create orchestrated worktrees under `/mnt/c`.

Run `scripts/start-change.sh <branch> --worktree /home/arund/dev/<worker-name>` from the clean canonical checkout on current `main`. START fetches and verifies `origin/main`, creates the worker from that exact SHA, records branch-bound provenance, and leaves canonical `main` in place. Workers use `scripts/check-repository-state.sh --continue`; it requires clean state and valid provenance but allows `origin/main` to advance beyond worker HEAD. The no-argument check remains strict/current-main for existing unattended callers.

Waiting and working PRs do not synchronize routinely. One named integrator owns merge order. For the single selected candidate, fetch `main`, synchronize once with a normal non-force operation if needed, pass `--integrate`, push final HEAD, wait for matching CI, then request fresh independent exact-HEAD review. Recheck live HEAD, main, CI, review, findings, and mergeability immediately before the existing guarded merge. If main advances and strict GitHub protection blocks merge, repeat integration only for this candidate; a changed HEAD invalidates review. Final exact-HEAD review covers committed, pushed work only.

## Parallelism

Default to one implementation worker.

Use parallel implementation only when:

- tasks have independent finish lines;
- no unresolved shared contract, schema, API, central type, storage design, or product decision connects them;
- file/subsystem overlap is low;
- each task has its own worktree and explicit ownership;
- each task can be verified independently;
- parallel execution is likely to save meaningful time after review and integration cost.

Start with at most two concurrent implementation workers unless a broader plan is explicitly approved.

Do not use parallel implementation for authentication, security, migrations, destructive data changes, deployment, infrastructure, or unclear product behavior.

## Retry and escalation policy

Do not repeat the same failed approach without new evidence.

- First failure: inspect the failure evidence and make the smallest bounded correction.
- Repeated failure or ambiguous root cause: reassess the evidence and approach; recommend a model/effort change only under the policy above.
- Two failed automated attempts on the same task should trigger root reassessment rather than blind retry.
- Use `gpt-6-astra` only when the permitted smaller models cannot adequately handle the task and the model change is authorized.

## Bound coordination cost

- Prefer existing CI completion notifications. If unavailable, use one bounded watcher with backoff and change-only output; avoid short polling loops that repeatedly wake the model or reload unchanged logs.
- Stabilize the selected candidate before broad CI and final review. Reuse passing evidence for the exact SHA and scope; rerun only checks invalidated by changes, failures, or unmet acceptance criteria. Preserve required repository checks and fresh exact-HEAD review.
- Keep coordination context to scope, branch/base/HEAD, evidence paths, concrete blockers, and the next executable action. Retrieve raw logs only to resolve a specific failure.
- Default to one bounded implementer. Delegate only when independent work saves total effort after handoff, review, and integration costs; avoid duplicate investigations.
- Bound side investigations by a concrete question and finish line. Surface missing access, inputs, or authorization early, and continue only independent work that can change the outcome.
- Ask each approval question once. While it is pending, do useful independent work; when none remains, stop at the gate instead of repeating unchanged status checks. Never infer approval from elapsed time.
- When accounting is available, distinguish observed requests, uncached input, cached input, and output from billed credits. Leave unknown costs unknown; do not infer charges from raw token totals.

## Required compact handoff

Workers and reviewers should return:

```text
STATUS
BRANCH
BASE SHA
HEAD SHA
PR
FILES CHANGED
IMPLEMENTATION / FINDINGS
VERIFICATION
MEASURED RESULT
RISKS
REMAINING
NEXT ACTION
```

Keep raw logs and large diffs out of the root context unless they are required to resolve a blocker.

## Human approval gates

The orchestrator must stop for explicit human approval before:

- merging a pull request outside the deployment-performance roadmap exception below;
- deploying to production;
- accessing production secrets or production data;
- destructive Git, filesystem, Docker, or database operations;
- database schema changes or migrations;
- authentication/permission changes;
- adding dependencies;
- changing billing behavior or durable product promises;
- broad architecture changes not already approved by the active roadmap or issue.

An already-approved bounded architecture/roadmap does not require repeated human confirmation for every reversible branch-local implementation step.

### Deployment-performance roadmap merge authorization

For a pull request bounded to `docs/brain/DEPLOYMENT_PERFORMANCE_ROADMAP.md`, the user authorizes the root orchestrator or assigned responsible agent to merge without another confirmation only when all five conditions are true at the same time:

1. An independent reviewer reports PASS against the exact current HEAD SHA.
2. All required CI jobs and status checks are green.
3. The reviewed HEAD SHA is still the current PR HEAD.
4. GitHub reports the pull request mergeable.
5. No review finding remains unresolved.

Immediately before merging, re-read the live PR HEAD, review result, required checks, mergeability, and unresolved findings. If any condition is false or unknown, repair, wait, or use the applicable human gate. This authorization covers merge only; it does not authorize a previously blocked implementation, broaden scope, access production, deploy, or alter any other approval gate.

After an authorized merge, verify that live `main` contains the merged result and continue the next newly unblocked roadmap task. Waiting/working branches may continue implementation with `--continue`; synchronize only the next selected integration candidate.

## Production boundary

Local WSL worktrees are the default development environment.

Use Hetzner only when the task specifically requires production-state evidence, such as:

- measuring image pull/extract or startup time;
- checking production container/runtime behavior;
- verifying an approved deployment;
- performing an explicitly approved deployment or rollback.

Preserve the existing production architecture unless separately approved:

`GitHub -> GHCR exact-SHA image -> Hetzner`

## Relationship to GitHub unattended automation

This root protocol describes local Codex Desktop orchestration. It does not relax the separate safety rules in `docs/brain/CODEX_AUTOMATION.md` for GitHub-hosted unattended issue workflows.

The GitHub unattended queue may remain more restrictive than the local root orchestrator. In particular, Docker, GitHub Actions, infrastructure, deployment, dependency, database, and other high-risk categories may remain blocked from unattended GitHub implementation even when a human-approved local orchestrator is allowed to coordinate bounded work in those areas.

## Current deployment-performance roadmap

Use [CURRENT_WORK.md](CURRENT_WORK.md#3-ci--docker--hetzner-deployment-performance--repository-checkpoint) for the dated repository checkpoint and [DEPLOYMENT_PERFORMANCE_ROADMAP.md](DEPLOYMENT_PERFORMANCE_ROADMAP.md) for historical measurements and phase acceptance criteria. Recheck the referenced live Issues/PRs before choosing remaining work. This protocol does not duplicate phase status or turn an old blocker or measurement into current evidence.
