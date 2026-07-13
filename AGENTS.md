# Codex Instructions

Work in credit-saving mode.

Before operational, deploy, Docker, database, or production work, read OPERATING-MANUAL.md first. If this file conflicts with older docs, treat OPERATING-MANUAL.md as the current source of truth unless the user says otherwise.

## Default Workflow

- Prefer small, targeted fixes.
- Do not scan the entire repository unless necessary.
- Do not edit files until you have explained the plan.
- Before editing, identify the likely root cause, smallest fix, files to change, and verification command.
- Ask before making broad changes.
- Inspect only the files directly related to the task, error, or current issue.
- If more context is needed, ask for the exact file names before reading them.
- Do not refactor unrelated code.
- Do not rename things unless required.
- Do not change formatting unless required.
- Do not add dependencies unless explicitly approved.
- Run the narrowest relevant test or check, not the full suite.
- Show the diff after changes.
- Stop after the first working fix.

## Related Work Batching

- Before opening a standalone pull request, check whether the task belongs in the active batch.
- Default to approximately 3–6 related, low-risk tasks in one branch and one pull request.
- Agree on the batch scope before implementation.
- Keep one focused commit per task.
- Run the narrowest relevant validation after each task, then run full pull-request CI once when the batch is complete.
- Stop expanding the batch when review, diagnosis, or safe rollback becomes difficult.
- Do not batch urgent production fixes, security or authentication changes, database migrations, destructive data changes, high-risk deployment or infrastructure changes, or unrelated product areas.

## Controlled Multi-Agent Work

- Do not use subagents by default.
- Subagents are allowed only when the user explicitly requests multi-agent work or the issue is marked agent-ready and the workflow in `docs/brain/DEVELOPMENT_AGENT_SYSTEM.md` is followed.
- Assign separate planner, implementer, and reviewer roles. The implementer must not serve as the final reviewer.
- Parallel agents require independent tasks, isolated branches or worktrees, explicit file ownership, and one named integrator.
- Do not use parallel agents for authentication, security, database migrations, destructive data changes, deployment, infrastructure, or unclear product behavior.
- Maximum default repair cycles: two. Return unresolved work for human reassessment after that.
- Agents may not merge, deploy, force-push, access production secrets, or expand scope without explicit human approval.

## Avoid

- Do not perform broad cleanup.
- Do not improve unrelated code.
- Do not explore unrelated folders.
- Do not run long commands without explaining why.

## Operational rules for this repo

- Work one step at a time, especially for server and dev tasks.
- For Post Everywhere, the usual live working environment is Hetzner SSH at `/home/arund/publish-everywhere-git`, not local WSL.
- Do not start Docker Desktop, the local WSL Postiz stack, or local cloudflared unless local work is intentional.
- Before coding sessions, run `sh scripts/install-git-guardrails.sh`, then `sh scripts/check-repository-state.sh`. Stop if either fails.
- The installed pre-push hook blocks direct pushes to `main`, pushes to the obsolete snapshot, and force pushes from this checkout.
- Start every new issue from current `main` with `sh scripts/start-change.sh fix/<short-name>` (or `feature/`, `chore/`, `docs/`, or `agent/`).
- Never edit directly on `main`; use a short-lived branch and a pull request targeting `main`.
- The canonical active branch is `main`. The old snapshot branch is historical only.
- Use VS Code SSH for editing and the Hetzner console for heavy Docker builds.

# Publish Everywhere Codex Instructions

## Default behavior

- Work in credit-saving mode.
- Do not scan the whole repo unless explicitly asked.
- Start from the error, issue, or most relevant file.
- Propose a plan before editing.
- Make the smallest useful fix.
- Do not refactor unrelated code.
- Do not change product promises without checking docs/brain/PRODUCT_TRUTH.md.
- Do not add dependencies without approval.
- Run the narrowest relevant verification command.

## Reference docs

Before product, copy, platform, workflow, or multi-agent development changes, check:

- docs/brain/PRODUCT_TRUTH.md
- docs/brain/CODEX_WORKFLOW.md
- docs/brain/DEVELOPMENT_AGENT_SYSTEM.md
- docs/brain/WORKED_LEARNINGS.md
- docs/brain/FAILED_APPROACHES.md
- docs/brain/KNOWN_ISSUES.md
- docs/brain/DEPLOYMENT_NOTES.md
