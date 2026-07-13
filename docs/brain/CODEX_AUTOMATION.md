# Codex Automation

## Status

The repository can automate planning, implementation, independent review, and post-merge memory proposals through `.github/workflows/codex-development-agents.yml`.

This is a human-gated system. It must never merge or deploy automatically.

## Human Gates

Human approval remains required for:

1. Applying the `agent-ready` label to an issue.
2. Launching the `implement` workflow manually.
3. Marking a draft pull request ready for review.
4. Deciding whether to accept review findings or launch another repair/implementation run.
5. Merging the pull request.
6. Deploying or changing production.

High-risk authentication, security, billing, database, infrastructure, migration, and deployment work is excluded from unattended implementation.

## Trusted Runner Requirements

Use a dedicated self-hosted Linux runner with the labels:

- `self-hosted`
- `linux`
- `codex`

The runner must:

- Be used only for the private `celleree/publish-everywhere` repository.
- Run under a dedicated operating-system user.
- Have `git`, `gh`, `jq`, and the Codex CLI installed.
- Be authenticated to Codex using the intended ChatGPT/Codex account.
- Have no production database credentials, application secrets, deployment keys, or Docker volume access.
- Have enough filesystem access to create branches and worktrees for this repository only.
- Never process pull requests from forks or untrusted external contributors.
- Receive repository access through the short-lived GitHub Actions token rather than a permanent broad GitHub token.

Do not copy Codex credentials into GitHub secrets. Authenticate interactively on the trusted runner under its dedicated user and protect that user's home directory.

## Setup Checklist

On the trusted runner:

```bash
codex login
codex login status
gh auth status
git --version
jq --version
```

Register the runner with GitHub and apply the `codex` custom label. Keep the runner service stopped until this pull request is merged and the workflow has been reviewed.

## Automated Triggers

### Plan

Applying `agent-ready` to an issue automatically runs the read-only planner and posts its plan to the issue.

### Implement

Run the `Codex development agents` workflow manually with:

- mode: `implement`
- number: the approved issue number

The implementation run is allowed only for an `agent-ready`, non-high-risk issue. It creates an `agent/issue-N` branch, runs Codex in workspace-write mode, performs basic change guards, commits, pushes, and opens a draft pull request.

### Review

Marking the draft pull request ready for review automatically runs an independent read-only reviewer and posts evidence-backed findings.

### Memory

Merging a pull request automatically runs the read-only memory coordinator and posts proposed brain or release-ledger updates. It does not edit canonical memory.

## Limits

- Maximum runtime: 90 minutes per workflow job.
- Maximum unattended implementation size: 30 changed files.
- Secret and environment files are blocked.
- Agent-system files are blocked from unattended modification.
- Dependencies, database schema changes, production access, merge, and deployment are prohibited.
- Repeated repair loops require another explicit human workflow launch.

## Failure Handling

If a Codex run fails, the workflow stops. Do not blindly rerun it repeatedly. Review the issue, branch, logs, and any partial changes first.

If two automated attempts fail on the same task, return the task to human reassessment under `docs/brain/DEVELOPMENT_AGENT_SYSTEM.md`.
