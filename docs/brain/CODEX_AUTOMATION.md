# Codex Automation

## Status

This document describes the gated Codex development workflows in `.github/workflows/codex-development-agents.yml` and `.github/workflows/codex-issue-queue.yml`.

These workflows are inactive until all of the following are true:

1. The pull request adding the workflow has been reviewed and merged into `main`.
2. A dedicated self-hosted runner has been registered for this private repository.
3. The runner has been authenticated to Codex and verified to have no persistent GitHub credentials or production access.
4. A harmless planning dry run and a documentation-only implementation dry run have passed.

This is a human-gated system. It must never merge or deploy automatically. The issue queue reduces repeated dispatches, but it does not remove readiness, risk, review, merge, or deployment gates.

## Human Gates

Human approval remains required for:

1. Applying the `agent-ready` label to an issue.
2. Authorizing implementation either by launching the `implement` workflow manually or by including an already-ready issue in an owner-triggered unattended queue.
3. Marking a draft pull request ready for review.
4. Deciding whether review findings warrant a manually launched `repair` run.
5. Merging the pull request.
6. Deploying or changing production.

High-risk authentication, authorization, security-sensitive, billing, payment, database, schema, migration, infrastructure, dependency or package-upgrade, container or Docker, GitHub Actions or workflow, deployment, and production-operations work is excluded from unattended implementation.

## Trusted Runner Requirements

Use a dedicated self-hosted Linux runner with the labels:

- `self-hosted`
- `linux`
- `codex`

The runner must:

- Be used only for the private `celleree/publish-everywhere` repository.
- Run under a dedicated operating-system user.
- Have `git`, `gh`, `jq`, `base64`, `bubblewrap`, and the Codex CLI installed.
- Be authenticated to Codex using the intended ChatGPT/Codex account.
- Have no production database credentials, application secrets, deployment keys, SSH agent, Docker socket, or Docker-volume access.
- Have no persistent GitHub CLI login, Git credential helper, SSH Git key, or broad personal access token.
- Receive repository access only through the short-lived GitHub Actions token supplied to each workflow run.
- Never process pull requests from forks or untrusted external contributors.
- Store Codex credentials in the dedicated user's protected home directory and nowhere in the repository or GitHub secrets.

OpenAI recommends API-key authentication as the default for programmatic CI. Reusing cached ChatGPT/Codex authentication is an advanced option for a trusted private runner and may require periodic reauthentication. This project uses that advanced route to consume the existing Codex allowance rather than API billing.

## Activation Sequence

The workflow file must exist on the default branch before issue-label, pull-request, or manual-dispatch events can use it. Follow this order:

1. Review the complete pull request diff and merge it into `main`.
2. Create or select a dedicated non-production Linux machine or virtual machine.
3. Create a dedicated operating-system user for the runner.
4. Install the required tools.
5. Confirm there is no persistent GitHub authentication:

   ```bash
   gh auth logout --hostname github.com || true
   gh auth status
   ```

   The final `gh auth status` should report that no account is authenticated.

6. Authenticate Codex under the dedicated runner user:

   ```bash
   codex login --device-auth
   codex login status
   ```

7. Register the GitHub Actions runner for this repository and add the `codex` custom label.
8. Start the runner service.
9. Run the planning dry run described below.
10. Run the documentation-only implementation dry run described below.
11. Keep merge and deployment approvals manual.

Do not run this automation from the production application checkout or from a user account containing production credentials.

## Automated Triggers

### Plan

Applying `agent-ready` to an issue automatically runs the read-only planner and posts its plan to the issue. The issue template does not apply this label automatically.

### Implement

Run the `Codex development agents` workflow manually with:

- mode: `implement`
- number: the approved issue number

The issue must be `agent-ready` and non-high-risk. The job creates an `agent/issue-N` branch, runs Codex in workspace-write mode without GitHub credentials, checks the resulting scope, commits, pushes, opens a draft pull request, and explicitly dispatches the existing pull-request CI workflow.

### Review

Marking an owner-controlled draft pull request ready for review automatically runs an independent read-only reviewer and posts evidence-backed findings.

### Repair

Run the workflow manually with:

- mode: `repair`
- number: the draft pull request number

Repair is restricted to an open, owner-controlled `agent/issue-N` pull request targeting `main`. Each repair requires another explicit human launch. No more than two unattended repair commits are permitted.

### Memory

Merging a pull request automatically runs the read-only memory coordinator and posts proposed brain or release-ledger updates. It does not edit canonical memory.

### Unattended issue queue

The repository owner may explicitly launch `Codex unattended issue queue` from `main` with `workflow_dispatch` after typing the confirmation phrase. Dispatches from any other ref are rejected. It has no scheduled, issue-label, pull-request, or repository event trigger.

The owner supplies an ordered issue list and an optional implementation subset. Queue parsing accepts comma-separated issue numbers, rejects malformed values, removes duplicates while preserving the first occurrence, and rejects implementation numbers that are absent from the main queue. An empty implementation subset is valid and makes every entry plan-only.

The workflow prepares an ordered matrix, then runs one issue job at a time with `max-parallel: 1`. `fail-fast` is disabled, so a failed or timed-out issue does not cancel later issue jobs. Each issue job may:

1. Run the read-only planning role and allow that role to inspect and comment on the issue.
2. Stop as plan-only when the issue is not in the owner-supplied implementation subset.
3. Before implementation, refresh the issue, require it to remain open, and require an existing `agent-ready` label whose most recent label event was performed by the repository owner.
4. Require exactly one complete set of recognized issue-template sections, including all completed readiness confirmations, then parse exactly one recognized `Risk classification` field and apply the blocked-category checks.
5. Run implementation only after all gates pass.

Planning and the queue never add `agent-ready`. Adding an issue to the implementation subset is not a substitute for the separately owner-applied label.

Template and risk handling fail closed. Missing, duplicated, malformed, incomplete, or unrecognized required sections block implementation. Missing, duplicated, malformed, ambiguous, or unknown risk classifications also block implementation. A `High` classification blocks implementation. Low- or medium-classified issues remain blocked when the title or any implementation-defining section describes authentication, authorization, security-sensitive changes, billing or payments, databases, schema changes or migrations, infrastructure, dependencies or package upgrades, containers or Docker, GitHub Actions or workflow changes, deployment, or production operations. Non-template issues therefore cannot become eligible merely because they contain a recognized risk sentence.

Every queue-created pull request must be a draft. The implementation role uses `gh pr create --draft`, and the queue verifies that the resulting open pull request is present and still a draft. The queue has no merge or deployment command.

## Credential and Sandbox Controls

- Standard development-agent roles use separate jobs and least-privilege GitHub token permissions. In the unattended queue, each issue has one isolated repository-write matrix job, and planning and implementation may run sequentially inside that job only after all readiness, template, and risk gates pass.
- `actions/checkout` does not persist its GitHub credentials.
- Credentials are removed before Codex receives untrusted issue content. The implementation role receives Git access only during the narrowly controlled setup, commit, push, and draft-PR operations performed by the trusted wrapper.
- The token is removed from Git configuration and the process environment before Codex starts.
- The script fails closed if persistent `gh` authentication or usable Git remote credentials remain.
- Codex runs with user configuration ignored so unrelated MCP servers and local automation settings are not loaded.
- Read-only roles use the read-only sandbox.
- Implementation and repair use the workspace-write sandbox with command network access disabled.
- Spawned commands receive a restricted environment and a temporary empty home directory rather than the runner user's Codex credential path.
- All non-interactive runs use `--ask-for-approval never`; requests outside the sandbox are denied rather than approved automatically.
- The active branch and commit are verified after Codex returns.
- Both tracked and untracked files are inspected before staging.
- Codex output and staged changes are checked for common credential patterns before they are posted or pushed.

## CI Behavior

GitHub events produced with the repository `GITHUB_TOKEN` have special recursion controls. The implementation and repair roles therefore dispatch `pull-request-ci.yml` explicitly against the agent branch after pushing. Normal CI remains the deterministic quality gate; an agent review never replaces it.

## Dry-Run Checklist

### Planning dry run

1. Create a harmless documentation-only issue with the agent task template.
2. Review it, then manually apply the `agent-ready` label.
3. Confirm the workflow runs on the dedicated runner.
4. Confirm Codex posts a read-only plan and makes no repository changes.

### Implementation dry run

1. Use a documentation-only issue that changes one disposable test document.
2. Manually dispatch `implement` with the issue number.
3. Confirm Codex creates an `agent/issue-N` branch and draft pull request.
4. Confirm pull-request CI was explicitly dispatched for the agent branch.
5. Confirm no credentials are visible to the Codex command environment.
6. Confirm the changed-file and protected-file guards behave as documented.
7. Mark the PR ready and confirm the independent review comment appears.
8. Close the test PR without merging unless the documentation change is wanted.

## Limits

- Standard development-agent jobs have a 90-minute maximum runtime.
- Queue roles are limited to 60, 120, or 150 minutes. Each ordered issue has its own 340-minute job, which accommodates two maximum-length roles, both five-minute termination grace periods, and at least 30 minutes for checkout, cleanup, comments, and final reporting.
- Maximum unattended implementation size: 30 changed files.
- Secret, environment, agent-system, workflow, dependency, database-schema, container, and deployment files are blocked.
- GitHub credentials are removed before Codex receives issue, PR, comment, or diff content.
- Codex may not alter Git history, change branches, merge, or deploy.
- Repeated repair loops require another explicit human workflow launch.
- Two unattended repair cycles are enforced, after which the task returns to human reassessment.

## Failure Handling

For the standard development-agent workflow, a failed role stops that workflow run. Do not blindly rerun it. Review the issue, branch, logs, and any partial changes first.

The unattended queue isolates failures per issue. Planning and implementation commands each run under their own command timeout inside the issue job. A role failure or timeout is recorded in that issue's job summary, cleanup is attempted, the issue job fails, and the ordered matrix remains eligible to start the next issue.

Expected per-issue GitHub failures are explicitly contained rather than being left to `set -e`:

- Issue lookup failures are recorded and fail only that issue job.
- Repository-owner lookup failures are recorded and fail only that issue job.
- A readiness-event API failure or pre-implementation issue refresh failure blocks implementation and is recorded.
- A pull-request lookup failure before implementation blocks implementation rather than risking a duplicate branch or pull request.
- A pull-request lookup failure after implementation is recorded and fails that issue's reporting.
- Queue status-comment failures are recorded in the job summary and make that issue job fail, but they do not stop safe role processing or cancel later queue entries.
- Cleanup failures are recorded and fail the affected issue job.

Unexpected setup failures, such as missing runner tools, invalid queue inputs, or an unauthorized actor, may stop the workflow before issue processing begins.

The final result for every started issue explicitly states that no pull request was merged and no deployment was performed. A queue failure must never trigger automatic retry, merge, or deployment.

To disable automation immediately:

1. Stop the self-hosted runner service.
2. Remove the `codex` runner label or unregister the runner.
3. Disable the `Codex development agents` workflow in GitHub.

If two automated attempts fail on the same task, return the task to human reassessment under `docs/brain/DEVELOPMENT_AGENT_SYSTEM.md`.
