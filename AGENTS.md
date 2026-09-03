# Codex Instructions

Work in credit-saving mode.

Before operational, deploy, Docker, database, or production work, read OPERATING-MANUAL.md first. If this file conflicts with older docs, treat OPERATING-MANUAL.md as the current source of truth unless the user says otherwise.

For manual ChatGPT <-> Codex handoffs, review depth, PR reviewability, and parallel-work decisions, follow `docs/brain/CHATGPT_CODEX_HANDOFF.md`.

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

## PR Scope and Reviewability

- Prefer the smallest coherent, self-contained pull request that leaves the repository valid.
- Preferred target: <=200 substantive changed lines when practical.
- Normal soft ceiling: <=400 substantive changed lines.
- Split or explicitly justify work that touches more than 10 substantive files.
- High-risk changes should prefer <=200 substantive changed lines.
- Batch tiny related low-risk work only when the batch is easier to understand, test, review, and roll back than separate PRs.
- Do not use an arbitrary number of tasks as the default batching target.
- Generated files, lockfiles, snapshots, mechanical formatting, and bulk moves/renames do not count the same as substantive handwritten review work.
- AI generation speed is never justification for a larger PR.
- If a coherent change cannot be split without reducing correctness or creating an invalid intermediate state, keep it together and explain the large-PR justification and review order.

## Controlled Multi-Agent Work

- Default to one implementation agent.
- Subagents are allowed only when the user explicitly requests multi-agent work or the issue is marked agent-ready and the workflow in `docs/brain/DEVELOPMENT_AGENT_SYSTEM.md` is followed.
- Add parallel implementation only when tasks are independently bounded, do not depend on an unresolved shared contract, have low file/subsystem overlap, can be developed and verified independently, and are likely to save meaningful time after coordination cost.
- Start with at most two concurrent implementation agents unless the user explicitly approves more.
- Assign separate planner, implementer, and reviewer roles. The implementer must not serve as the final reviewer.
- Parallel agents require isolated branches or worktrees, explicit file ownership, and one named integrator.
- If a supposedly independent workstream discovers a shared-contract dependency, stop that workstream and report the dependency instead of inventing a competing design.
- Do not use parallel agents for authentication, security, database migrations, destructive data changes, deployment, infrastructure, or unclear product behavior.
- Agents may not merge, deploy, force-push, access production secrets, or expand scope without explicit human approval.

## Review Depth

- Do not create infinite review loops trying to enumerate every theoretical edge case.
- Default maximum: three independent review passes for the same bounded change.
- After three passes, unresolved ordinary edge cases become disclosed remaining risk or follow-up work rather than another automatic review cycle.
- Continue beyond three passes only while a review still finds or strongly indicates a material high-severity risk such as security/auth failures, exposed secrets, destructive production behavior, persistent customer-data loss/corruption, billing/payment risk, unauthorized publishing, or another comparably consequential failure.
- Any HEAD change after a required exact-SHA independent review invalidates that review. For a trivial follow-up commit, the fresh review may be scoped to the new diff, but the new HEAD SHA must still be reviewed and recorded.

## Avoid

- Do not perform broad cleanup.
- Do not improve unrelated code.
- Do not explore unrelated folders.
- Do not run long commands without explaining why.

## Operational rules for this repo

- Work one step at a time, especially for server and dev tasks.
- For EverywherePoster, the usual live working environment is Hetzner SSH at `/home/arund/publish-everywhere-git`, not local WSL.
- Do not start Docker Desktop, the local WSL Postiz stack, or local cloudflared unless local work is intentional.
- Before normal coding sessions, run `sh scripts/install-git-guardrails.sh`, then `sh scripts/check-repository-state.sh`. Stop if either fails.
- Exception: when running through the trusted automated agent wrapper in `scripts/agents/codex-task.sh`, these checks are completed before the Codex sandbox starts. Do not rerun either command inside the sandbox; `.git` is intentionally read-only.
- The installed pre-push hook blocks direct pushes to `main`, pushes to the obsolete snapshot, and force pushes from this checkout.
- Start every new issue from current `main` with `sh scripts/start-change.sh fix/<short-name>` (or `feature/`, `chore/`, `docs/`, or `agent/`).
- Never edit directly on `main`; use a short-lived branch and a pull request targeting `main`.
- The canonical active branch is `main`. The old snapshot branch is historical only.
- Use VS Code SSH for editing and the Hetzner console for heavy Docker builds.

# EverywherePoster Codex Instructions

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
- docs/brain/CHATGPT_CODEX_HANDOFF.md
- docs/brain/DEVELOPMENT_AGENT_SYSTEM.md
- docs/brain/WORKED_LEARNINGS.md
- docs/brain/FAILED_APPROACHES.md
- docs/brain/KNOWN_ISSUES.md
- docs/brain/DEPLOYMENT_NOTES.md
