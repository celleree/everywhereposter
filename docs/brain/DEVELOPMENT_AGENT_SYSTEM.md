# Development Agent System

## Purpose

Use ChatGPT, Codex, GitHub, and CI as a controlled multi-agent development workflow without requiring a paid orchestration API.

This system is intentionally human-supervised. Agents may plan, investigate, implement, review, repair, document, and prepare releases. They may not merge, deploy, access production secrets, or perform destructive operations without explicit human approval.

For manual ChatGPT <-> Codex handoffs, routing headers, review depth, PR reviewability, and parallel decisions, follow `CHATGPT_CODEX_HANDOFF.md`.

## Core Roles

### 1. Planner and Investigator

Responsibilities:

- Turn a product request or bug report into a bounded GitHub issue.
- Identify the likely code area and smallest useful file set.
- Check product contracts and operating rules.
- Define acceptance criteria, risks, exclusions, and validation.
- Estimate whether the planned PR is reviewably scoped.
- Do not edit implementation files.

Required output:

- Problem statement.
- Current and intended behavior.
- Exact acceptance criteria.
- Likely files or directories.
- Risks and required approvals.
- Recommended validation commands.
- Expected PR size/split recommendation when material.

### 2. Implementer

Responsibilities:

- Work from an agent-ready issue or ChatGPT-approved bounded plan.
- Create a short-lived branch from current `main`.
- Run repository guardrails before editing.
- Change only the agreed scope.
- Add or update focused tests.
- Show the diff and validation evidence.

The implementer must not review or approve its own work as the final reviewer.

### 3. Reviewer and Verifier

Responsibilities:

- Review the issue, exact current HEAD/diff, tests, and CI evidence.
- Check acceptance criteria and product contracts.
- Look for scope drift, regressions, realistic edge cases, security issues, unsafe operations, unsupported claims, missing tests, and documentation drift.
- Report findings without silently rewriting the implementation.
- Identify the exact commit/SHA reviewed when the review is a merge gate.

The reviewer should assume something may be wrong and provide file-specific evidence.

### 4. Repair Agent

Responsibilities:

- Address only verified review findings or CI failures.
- Make the smallest correction.
- Rerun the narrowest relevant validation.
- Stop after the finding is resolved.

### 5. Memory and Release Coordinator

Responsibilities:

- Prepare the PR summary and release notes.
- Propose durable learning only when evidence supports future reuse.
- Prefer tests, guards, helpers, and code/config enforcement over extra Markdown when practical.
- Update brain files only when stronger enforcement is not the better home.
- Track the exact commit and required deployment verification.
- Never merge or deploy without explicit human approval.

## Standard Workflow

1. A ChatGPT project conversation defines the desired outcome.
2. The planner creates or improves a bounded GitHub issue or investigation plan.
3. A human/ChatGPT checkpoint approves scope before meaningful implementation.
4. The implementer creates a branch from current `main` and performs only the approved work.
5. Focused local validation runs.
6. A draft pull request is opened.
7. A separate fresh-context reviewer checks the exact current HEAD, issue, diff, tests, and product contracts.
8. The original implementation session or repair agent addresses verified findings.
9. Verification and, when required, fresh exact-SHA review run again after any HEAD change. For a trivial follow-up commit, the fresh review may be scoped to the new diff, but the new HEAD SHA must still be reviewed and recorded.
10. GitHub Actions runs the full pull-request checks.
11. A human decides whether to merge.
12. The coordinator prepares deployment steps and any proposed durable learning.
13. A human explicitly approves any production deployment.

## Review Depth

Default to a maximum of three independent broad review passes for one bounded change. The goal is realistic coverage, not infinite hypothetical edge-case enumeration.

- Pass 1: correctness, acceptance criteria, regressions, realistic edge cases, product contracts, and safety.
- Pass 2: verify repairs and target missed realistic edge cases/shared contracts.
- Pass 3: final bounded challenge pass when warranted.

After three passes, ordinary residual edge cases are documented as remaining risk or follow-up work rather than causing another automatic broad review cycle.

Continue broad review beyond three passes only while an unresolved or newly discovered material high-severity risk remains, including security/authentication/authorization failures, exposed secrets, destructive production behavior, persistent customer-data loss/corruption, billing/payment risk, unauthorized publishing, or another comparably consequential failure.

Any HEAD change after a required exact-SHA review invalidates that review. For a trivial follow-up commit, the fresh review may be scoped to the new diff, but the new HEAD SHA must still be reviewed and recorded.

After pass 3, when a concrete finding is repaired and changes HEAD, the required fresh exact-SHA review may be narrowly scoped to the repair and the interactions needed to validate it. This scoped repair verification does not count as a new broad review pass and must not resume unrelated edge-case discovery. If it finds a concrete defect in the repair, fix and re-verify the new SHA in the same narrow scope.

## PR Reviewability

Prefer the smallest coherent, self-contained PR that leaves the repository valid.

- Preferred target: <=200 substantive changed lines when practical.
- Normal soft ceiling: <=400 substantive changed lines.
- Split or explicitly justify when more than 10 substantive files are touched.
- High-risk work should prefer <=200 substantive changed lines.
- Mechanical/generated changes do not count the same as substantive handwritten review work.
- Do not batch a fixed number of tasks by default.
- Batch tiny related low-risk work only when the combined PR remains easier to understand, test, review, and roll back.
- If splitting would reduce correctness or create an invalid intermediate state, keep the PR coherent and document the justification and review order.

## Parallel Work Rules

Default to one implementation agent.

Recommend a second concurrent implementation agent only when all of the following are true:

- There are at least two bounded tasks with clear finish lines.
- Neither task depends on an unresolved shared contract, schema, API, central type, storage design, or product decision.
- File/subsystem overlap is low enough to give each agent explicit ownership.
- Each task can be developed and verified independently on an isolated branch/worktree.
- Concurrent work is likely to save meaningful time after coordination, review, and merge cost.

Start with at most two concurrent implementation agents unless the user explicitly approves more.

When parallel work is used:

- Each task has its own branch or isolated worktree.
- Each agent has explicit file ownership and a `DO NOT MODIFY` boundary.
- One named integrator owns merge sequencing.
- Agents do not independently redesign the same shared contract.
- If a workstream discovers a shared-contract dependency, stop that workstream and return the dependency instead of inventing a competing design.
- After one branch merges, remaining branches sync with updated `main` when relevant and re-run verification.

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

Use for product decisions, issue definition, architecture discussion, routing/model/session recommendations, prioritization, orchestration checkpoints, and human approval.

### Codex

Use for repository investigation, implementation, focused testing, independent review, repair, and PR preparation.

### GitHub

Use as the durable task, branch, review, CI, and release record.

### GitHub Actions

Use for deterministic checks. An agent opinion never replaces tests, type checks, repository guards, or builds.

### Repository Brain

Use `docs/brain/` for durable product and engineering memory that cannot be better enforced in code/tests/config. Do not store speculation, temporary state, secrets, or raw logs.

## Memory Update Protocol

After a merged, rejected, or reverted PR, first ask whether the learning belongs in a test/eval, deterministic guard, reusable helper, or code/config contract. Only then propose a brain entry when documentation is the best durable home.

Possible brain destinations:

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

Do not capture routine debugging, expected failed experiments, transient service failures, or low-value implementation noise.

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
- The diff stays within coherent scope.
- Focused validation passes.
- Required CI passes.
- Required separate review is complete against the correct HEAD.
- Product or operating documentation is updated when needed.
- Remaining risks are disclosed.
- Human approval is obtained for merge and deployment actions.
