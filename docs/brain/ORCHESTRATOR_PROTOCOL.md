# Root Orchestrator Protocol

Updated: 2026-09-14

## Purpose

Define the default hands-off coordination loop for EverywherePoster when a long-running Codex Desktop root session is orchestrating bounded implementation, review, repair, CI, and roadmap progression.

Automatic merge is authorized only for pull requests bounded to `docs/brain/DEPLOYMENT_PERFORMANCE_ROADMAP.md` and only under the five conditions below. Production deployment and all merges outside that roadmap remain explicit human gates.

## Recommended root route

- Primary: GPT-6 Astra / High
- Fallback: GPT-5.6 Sol / High when Astra is unavailable
- Local worker: `qwen3:8b` through Ollama under the Codex `--oss` harness for cheap, bounded, low-risk work
- Default non-local implementation worker: GPT-5.6 Terra / Medium
- Mechanical cloud worker: GPT-5.6 Luna / Low or Medium
- Independent reviewer: GPT-5.6 Sol / High
- Escalate difficult architecture, repeated failures, high-risk root-cause work, or large-context integration decisions to GPT-6 Astra / High

Choose model and reasoning separately. Optimize for the lowest expected total cost of a correct verified result, including retries and rework.

### Local worker routing

Use `qwen3:8b` first when the task is narrowly bounded and low risk, especially for:

- repository inspection and targeted file reading;
- extraction, classification, and summarization;
- simple documentation edits;
- repetitive or mechanical edits;
- straightforward tests and test updates;
- very bounded low-risk code changes with clear acceptance criteria.

Run it through the local Ollama-backed Codex harness, for example:

`codex --oss -m qwen3:8b`

Escalate from the local worker to Terra / Medium when:

- implementation contains meaningful business or application logic;
- scope grows beyond the original bounded contract;
- requirements or root cause are ambiguous;
- local verification fails;
- the local worker struggles, stalls, or produces low-confidence output.

Do not use the local worker as the final independent reviewer or for architecture, authentication/security, database migrations, deployment/infrastructure decisions, destructive operations, or other high-risk work.

The local worker is an optional lowest-cost tier, not a requirement. If Ollama or the local model is unavailable, route directly to the appropriate cloud worker instead of blocking the task.

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
3. Confirm local `main` matches current `origin/main` before creating worker branches.
4. Read `AGENTS.md`.
5. Read `docs/brain/CURRENT_WORK.md`.
6. Read only the active roadmap or subsystem documents needed for the current workstream.
7. Verify live GitHub state for current `main`, relevant open PRs, issues, and CI before trusting checkpoint text.
8. Select the highest-priority bounded task that is not externally blocked.

Do not recursively load all repository docs, old PRs, or Git history.

## Bounded execution loop

For each task:

1. Define a narrow task contract with objective, scope, explicit exclusions, verification, and return format.
2. Choose the cheapest model/reasoning combination likely to complete it correctly.
3. Create an isolated WSL-native branch/worktree from current `main`.
4. Dispatch one implementation worker by default.
5. Let the worker investigate and implement only the approved bounded scope.
6. Require focused verification and an exact branch/base/HEAD handoff.
7. Open a pull request when implementation is ready, unless the worker already opened it under the approved workflow.
8. Inspect the exact PR HEAD, diff, verification evidence, and CI state.
9. When independent review is required, dispatch a fresh reviewer against the exact HEAD SHA. The implementer may not serve as the final independent reviewer.
10. Send only concrete review findings or CI failures back to a repair worker/session.
11. If HEAD changes after a required exact-SHA review, obtain fresh review of the new HEAD. A trivial repair may receive a narrowly scoped fresh review.
12. Recheck CI and required gates.
13. When review and CI are complete, apply the roadmap-specific merge authorization below; otherwise stop at the human merge gate.
14. After any merge, verify live `main`, reconcile affected worktrees and dependencies, record any material durable checkpoint, and continue newly unblocked work.
15. Select the next bounded task and repeat; merge readiness alone does not end the orchestration loop.

## State machine

Use these task states when useful:

- READY
- IMPLEMENTING
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

Do not run `scripts/start-change.sh` in the canonical checkout during orchestrated worktree mode; that script switches the active checkout. The root should create the worker branch/worktree directly from current `main` instead.

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
- Repeated failure or ambiguous root cause: escalate reasoning/model strength before widening scope.
- Two failed automated attempts on the same task should trigger root reassessment rather than blind retry.
- Cross-phase architectural conflicts, repeated verification failure, or expensive-to-get-wrong infrastructure decisions should escalate to Astra / High.

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

After an authorized merge, verify that live `main` contains the merged result, reconcile affected worktrees and dependency assumptions, and continue the next newly unblocked roadmap task.

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

For `docs/brain/DEPLOYMENT_PERFORMANCE_ROADMAP.md`:

- Phase 0 is complete.
- Phase 1A is complete via PR #100.
- Phase 1B instrumentation is repository-complete via PR #101; production timings remain unmeasured until an explicitly approved controlled deployment.
- Phase 4's excluded-Markdown classifier change is repository-complete via PR #103.
- The planned Phase 2 patch remains blocked by the prior pre-edit automatic approval review; the merge exception above does not itself authorize that rejected action.
- Phase 3 read-only analysis is complete; implementation waits for a settled Phase 2 image and representative measurements.
- Phase 5 waits for the approved instrumented deployment. Phase 6 benchmark preparation is complete; final measurements remain pending.
- Do not redo Phase 0 unless new evidence materially contradicts the recorded baseline.
