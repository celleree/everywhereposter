# Development Agent System

## Purpose

Use ChatGPT, Codex, GitHub, and CI as a controlled multi-agent development workflow without requiring a paid orchestration API.

This system is intentionally human-supervised. Agents may plan, investigate, implement, review, repair, document, and prepare releases. They may not merge, deploy, access production secrets, or perform destructive operations without explicit human approval.

## Core Roles

### 1. Planner and Investigator

Responsibilities:

- Turn a product request or bug report into a bounded GitHub issue.
- Identify the likely code area and smallest useful file set.
- Check product contracts and operating rules.
- Define acceptance criteria, risks, exclusions, and validation.
- Do not edit implementation files.

Required output:

- Problem statement.
- Current and intended behavior.
- Exact acceptance criteria.
- Likely files or directories.
- Risks and required approvals.
- Recommended validation commands.

### 2. Implementer

Responsibilities:

- Work from an agent-ready issue.
- Create a short-lived branch from current `main`.
- Run repository guardrails before editing.
- Change only the agreed scope.
- Add or update focused tests.
- Show the diff and validation evidence.

The implementer must not review or approve its own work as the final reviewer.

### 3. Reviewer and Verifier

Responsibilities:

- Review the issue, complete diff, tests, and CI evidence.
- Check acceptance criteria and product contracts.
- Look for scope drift, regressions, security issues, unsafe operations, unsupported claims, missing tests, and documentation drift.
- Report findings without silently rewriting the implementation.

The reviewer should assume something may be wrong and provide file-specific evidence.

### 4. Repair Agent

Responsibilities:

- Address only verified review findings or CI failures.
- Make the smallest correction.
- Rerun the narrowest relevant validation.
- Stop after the finding is resolved.

Maximum default repair cycles: two. After two failed repair cycles, return the task for human reassessment.

### 5. Memory and Release Coordinator

Responsibilities:

- Prepare the PR summary and release notes.
- Propose durable learning entries after completed work.
- Update brain files only when evidence supports a reusable lesson.
- Track the exact commit and required deployment verification.
- Never merge or deploy without explicit human approval.

## Verification Model Policy

- CI diagnosis and CI repair use `gpt-5.6-terra` with medium reasoning. CI failures are bounded, evidence-heavy tasks where Terra is the pragmatic workhorse.
- Independent PR review uses `gpt-5.6-sol` with high reasoning because it is the quality-first, adversarial judgment step.
- PR repair uses `gpt-5.6-terra` with medium reasoning and may address only evidence-backed review findings.
- Verification roles must pass the model and reasoning effort explicitly. They must not inherit the runner's Codex default or user configuration.

## CI Verification Loop

1. Run pull-request CI for the exact current head commit.
2. When CI fails, a read-only CI verifier inspects only the current failed run, failed-step logs, PR diff, and repository guidance.
3. The verifier reports the first actionable root cause, smallest safe repair, and exact validation command. It does not edit.
4. A human decides whether to launch `ci-repair`.
5. CI repair fixes only the verified failure, pushes one focused commit, and dispatches pull-request CI again.
6. Stop after CI succeeds or after the shared two-repair limit; unresolved or apparently transient failures return to a human.

## PR Verification Loop

1. Start independent PR review only after pull-request CI succeeds for the exact current head and the PR is no longer a draft.
2. The read-only reviewer checks the PR context, complete diff, tests, and product contracts after the trusted current-head CI gate, then posts findings and a pass/fail recommendation.
3. A human decides whether to launch `repair` for evidence-backed findings.
4. PR repair pushes one focused commit and returns the new head to the CI verification loop.
5. After CI succeeds for that new head, run a fresh independent PR review.
6. Stop after review passes or after the shared two-repair limit; a human still decides whether to merge.

## Standard Workflow

1. A ChatGPT project conversation defines the desired outcome.
2. The planner creates or improves a GitHub issue using the agent-ready template.
3. A human approves the issue scope.
4. The implementer creates a branch from current `main` and performs the work.
5. Focused local validation runs.
6. A draft pull request is opened.
7. The CI verification loop runs until the current head is green or reaches the repair limit.
8. The PR is marked ready, and the PR verification loop reviews the green current head.
9. Any approved PR repair returns to the CI loop before another independent review.
10. A human decides whether to merge.
11. The coordinator prepares deployment steps and a proposed memory update.
12. A human explicitly approves any production deployment.

## Parallel Work Rules

Parallel Codex agents are allowed only when all of the following are true:

- The issue has clear acceptance criteria.
- Tasks are independently scoped.
- Each task has its own branch or isolated worktree.
- Each agent has explicit file ownership.
- Agents are not editing the same files.
- One named integrator is responsible for combining changes.

Do not use parallel agents for:

- Urgent production fixes.
- Authentication or security changes.
- Database migrations.
- Destructive data changes.
- Deployment or infrastructure changes.
- Tasks with unclear product behavior.
- Tasks that substantially overlap in files.

## Human Approval Gates

Explicit human approval is required before:

- Broad architectural changes.
- Adding dependencies.
- Database schema changes or migrations.
- Changing authentication or permissions.
- Changing product promises or billing behavior.
- Merging a pull request.
- Deploying to production.
- Accessing production data or secrets.
- Running destructive Docker, database, filesystem, or Git commands.

## Tool Boundaries

### ChatGPT Project

Use for product decisions, issue definition, architecture discussion, prioritization, and human approval.

### Codex

Use for repository investigation, implementation, focused testing, review, repair, and PR preparation.

### GitHub

Use as the durable task, branch, review, CI, and release record.

### GitHub Actions

Use for deterministic checks. An agent opinion never replaces tests, type checks, repository guards, or builds.

### Repository Brain

Use `docs/brain/` for durable product and engineering memory. Do not store speculation, temporary state, secrets, or raw logs.

## Memory Update Protocol

After a merged, rejected, or reverted PR, the coordinator may propose an entry for one of:

- `PRODUCT_TRUTH.md`
- `WORKED_LEARNINGS.md`
- `FAILED_APPROACHES.md`
- `KNOWN_ISSUES.md`
- `DEPLOYMENT_NOTES.md`

A proposed entry must include:

- Context.
- Verified finding.
- Future action.
- Evidence such as an issue, PR, commit, test, or manual verification.

The proposal must be reviewed before it becomes canonical memory.

## Forbidden Autonomous Actions

Agents must not:

- Push directly to `main`.
- Force-push.
- Merge pull requests.
- Deploy to production.
- Run destructive database or Docker commands.
- Modify production secrets.
- Approve their own code as the final reviewer.
- Continue indefinitely through self-review loops.
- Expand issue scope without human approval.

## Definition of Done

A development task is complete only when:

- Acceptance criteria are satisfied.
- The diff stays within scope.
- Focused validation passes.
- Required CI passes.
- A separate review is complete.
- Product or operating documentation is updated when needed.
- Remaining risks are disclosed.
- Human approval is obtained for merge and deployment actions.
