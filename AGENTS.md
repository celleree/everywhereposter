# EverywherePoster Agent Instructions

Keep normal AI/Codex context small. Read only what the current task requires.

## Start here

- For a narrow issue with an explicit file/error: start from that issue/error and the directly relevant code/tests.
- For product behavior, UX copy, platform promises, or capability claims: read `docs/brain/PRODUCT_TRUTH.md`.
- For “continue the project,” roadmap, prioritization, or deciding what to do next: read `docs/brain/CURRENT_WORK.md`.
- For long-running local Codex Desktop orchestration across bounded worker sessions: follow `docs/brain/ORCHESTRATOR_PROTOCOL.md`.
- For locating the owning subsystem: read `docs/brain/REPOSITORY_ROUTING.md`.
- For operational, deploy, Docker, database, environment, or production work: read `OPERATING-MANUAL.md` first.
- For manual ChatGPT <-> Codex handoffs, review depth, PR reviewability, and parallel-work decisions: follow `docs/brain/CHATGPT_CODEX_HANDOFF.md`.
- Load `docs/brain/CODEX_WORKFLOW.md` or `docs/brain/DEVELOPMENT_AGENT_SYSTEM.md` only when planning/review/multi-agent coordination actually needs them.

Do not recursively load the repository, all docs, old PRs, Git history, or every brain file by default.

## Source-of-truth precedence

Use the narrowest current source that actually governs the task:

1. Runtime code/tests/config for what is implemented.
2. `docs/brain/PRODUCT_TRUTH.md` for durable product promises and constraints.
3. `docs/brain/CURRENT_WORK.md` for current priorities and roadmap/checkpoint state.
4. Current GitHub Issue/task acceptance criteria for a bounded change; it supersedes broader product docs only when it explicitly records a newer decision.
5. `OPERATING-MANUAL.md` for deployment/operations/database/environment rules.
6. Relevant current subsystem docs/specs.
7. Older docs, PR descriptions, and historical plans only when they do not conflict with the sources above.

Live GitHub state is authoritative for current branch/PR/HEAD/check status. Repository configuration does not prove an external provider dashboard has approved or accepted the app.

If documentation conflicts with executable code/config about current runtime behavior, code/config is authoritative. Correct stale durable documentation when the conflict represents a real project-state change.

## Current product direction

EverywherePoster is source-content-first, not video-only. The main value is AI-assisted repurposing, platform adaptation where useful, multi-account distribution, and publishing from one place.

Do not claim that one uploaded video becomes many entirely new AI-generated videos or new video concepts. Existing uploaded video may be edited/adapted when supported, and source content may produce captions, text posts, images/image-post concepts, and other implemented assets.

For the current release objective and active workstreams, use `docs/brain/CURRENT_WORK.md` rather than guessing from old Issues or PRs.

## Repository routing

Use `docs/brain/REPOSITORY_ROUTING.md` as the default subsystem map. Start with the smallest listed area and expand only when evidence requires it.

At a high level:

- frontend / guided composer -> `postiz-app/apps/frontend/`
- backend API -> `postiz-app/apps/backend/src/api/`
- orchestration / Temporal -> `postiz-app/apps/orchestrator/`
- shared backend/product services -> `postiz-app/libraries/nestjs-libraries/`
- focused tests -> `postiz-app/tests/`
- CI / deployment -> `.github/workflows/`, `scripts/`, Docker/Compose files
- product/current-work/agent memory -> `docs/brain/`

Do not search every provider or service when the failing route/component already identifies the relevant path.

## Default workflow

- Work in credit-saving mode.
- Prefer small, targeted fixes.
- Do not scan the entire repository unless necessary.
- Do not edit files until you have explained the plan for meaningful non-mechanical work.
- Before editing, identify the likely root cause, smallest coherent fix, files to change, and verification command.
- Inspect only the files directly related to the task, error, current issue, or governing contract.
- Do not refactor unrelated code.
- Do not rename things unless required.
- Do not change formatting unless required.
- Do not add dependencies unless explicitly approved.
- Run the narrowest relevant tests/checks while iterating; let CI provide broad regression coverage by default.
- Show/review the final diff and verification evidence.
- Stop after the approved bounded task is correctly verified; do not continue into adjacent cleanup.

## PR scope and reviewability

Prefer the smallest coherent, self-contained pull request that leaves the repository valid.

- Preferred target: <=200 substantive changed lines when practical.
- Normal soft ceiling: <=400 substantive changed lines.
- Split or explicitly justify work touching more than 10 substantive files.
- High-risk work should prefer <=200 substantive changed lines.
- Batch tiny related low-risk work only when the combined PR is easier to understand, test, review, and roll back than separate PRs.
- Do not use an arbitrary fixed number of tasks as the default batch size.
- Generated files, lockfiles, snapshots, mechanical formatting, and bulk moves/renames do not count the same as substantive handwritten review work.
- AI generation speed is never justification for a larger PR.
- If splitting would reduce correctness or create an invalid intermediate state, keep the coherent change together and document the justification and review order.

## Controlled multi-agent work

- Default to one implementation agent.
- Subagents are allowed when the user explicitly requests multi-agent work, when a root orchestrator is operating under `docs/brain/ORCHESTRATOR_PROTOCOL.md`, or when the issue is agent-ready and `docs/brain/DEVELOPMENT_AGENT_SYSTEM.md` is followed.
- Add parallel implementation only when tasks are independently bounded, do not depend on an unresolved shared contract, have low file/subsystem overlap, can be developed and verified independently, and are likely to save meaningful time after coordination cost.
- Start with at most two concurrent implementation agents unless the user explicitly approves more.
- Assign separate planner, implementer, and reviewer roles when those roles are needed. The implementer must not serve as the final independent reviewer.
- Parallel agents require isolated branches/worktrees, explicit file ownership, and one named integrator.
- If a supposedly independent workstream discovers a shared-contract dependency, stop that workstream and report the dependency instead of inventing a competing design.
- Do not use parallel implementation for authentication, security, database migrations, destructive data changes, deployment, infrastructure, or unclear product behavior.
- Agents may not deploy, force-push, access production secrets, or expand scope without explicit human approval. Pull-request merges follow the human gates below and the narrowly scoped deployment-performance roadmap exception.

## Review depth and risk

Do not create infinite review loops trying to enumerate every theoretical edge case.

- Default maximum: three independent broad review passes for the same bounded change.
- After three passes, unresolved ordinary edge cases become disclosed remaining risk or follow-up work rather than another automatic broad review cycle.
- Continue broad review beyond three passes only while a material high-severity risk remains, such as auth/security failure, exposed secrets, destructive production behavior, persistent customer-data loss/corruption, billing/payment risk, unauthorized publishing, or a comparably consequential failure.
- Any HEAD change after a required exact-SHA independent review invalidates that review. A trivial repair may receive a narrowly scoped fresh exact-SHA verification without reopening unrelated broad review.

Risk starting points:

- LOW: docs/copy/simple styling/additive tests or similarly contained reversible work.
- MEDIUM: runtime/business logic, APIs, data mappings, storage/media/creative behavior, meaningful external integrations.
- HIGH: auth/authz, secrets/security boundaries, billing/payment, database schema/migrations, destructive production operations, production data/assets, deployment/infrastructure safeguards, or unauthorized publishing risk.

Meaningful MEDIUM integration/runtime changes should receive independent review. HIGH changes always require fresh independent review of the final exact HEAD before merge.

## Model and reasoning routing

Optimize for the lowest expected total cost of a correct, verified result, including retries and rework. Choose model and reasoning effort separately.

Starting points:

- Local `qwen3:8b` via Ollama/Codex `--oss`: targeted inspection, extraction/classification, simple docs, repetitive edits, straightforward tests, and very bounded low-risk code changes.
- Luna: mechanical/repetitive cloud work, extraction/classification, targeted inspection, very easy tasks when the local worker is unavailable or unsuitable.
- Terra: normal bounded coding, micro-PRs, straightforward fixes/tests/routine implementation, and the default escalation from the local worker when meaningful logic, ambiguity, or failed verification appears.
- Sol: difficult but bounded planning, debugging, unfamiliar subsystems, complex implementation, substantial independent review.
- Astra: architecture, cross-workstream decisions, difficult root-cause debugging, high-risk review, large-context orchestration, repeated failures, or expensive mistakes.

Do not use the local worker as the final independent reviewer or for architecture, authentication/security, database migrations, deployment/infrastructure decisions, destructive operations, or other high-risk work. Follow `docs/brain/ORCHESTRATOR_PROTOCOL.md` for the complete local-worker escalation policy.

Reasoning:

- Low: straightforward/local work.
- Medium: normal implementation/investigation.
- High: difficult ambiguity/integration/consequential review.
- Extra-high: only when clearly justified.

Do not retry a failed model/reasoning configuration unchanged without new evidence. Escalate only when difficulty, ambiguity, context, risk, or failed verification warrants it.

## Operational rules for this repo

- Work one step at a time, especially for server and production tasks.
- The default development environment is the WSL-native ext4 checkout at `/home/arund/dev/everywhereposter`.
- Do not use the old Windows-mounted checkout at `/mnt/c/dev/everywhereposter`; it is preserved only as historical local state and previously showed false CRLF/LF modifications.
- Keep the canonical local checkout on clean `main`; implementation/review workers should use isolated WSL-native worktrees/branches when operating under the root orchestrator protocol.
- Hetzner SSH at `/home/arund/publish-everywhere-git` is reserved for production-specific measurements, runtime verification, and explicitly approved deployment work.
- Do not start Docker Desktop, the local WSL Postiz stack, or local cloudflared unless local runtime work is intentionally required.
- Before normal single-checkout coding sessions, run `sh scripts/install-git-guardrails.sh`, then `sh scripts/check-repository-state.sh`. Stop if either fails.
- In orchestrated worktree mode, the root orchestrator should validate the canonical checkout first and create isolated worktrees directly from current `main`; do not run `scripts/start-change.sh` from the canonical checkout because it switches the active checkout.
- Exception: the trusted automated agent wrapper completes its own repository checks before the Codex sandbox starts; do not rerun checks inside that sandbox when `.git` is intentionally read-only.
- The installed pre-push hook blocks direct pushes to `main`, pushes to the obsolete snapshot, and force pushes from this checkout.
- Outside orchestrated worktree mode, start new work from current `main` with `sh scripts/start-change.sh fix/<short-name>` (or `feature/`, `chore/`, `docs/`, `agent/`).
- Never edit directly on `main`; use a short-lived branch and a pull request targeting `main`.
- The canonical active branch is `main`. The old snapshot branch is historical only.
- Use the local WSL checkout for normal development. Use Hetzner tools only when production evidence or an approved production action is required.

## Human approval gates

Explicit approval is required before:

- broad architectural changes;
- adding dependencies;
- database schema changes/migrations;
- authentication/permission changes;
- changing product promises or billing behavior;
- merging a pull request outside the deployment-performance roadmap exception defined in `docs/brain/ORCHESTRATOR_PROTOCOL.md`;
- deploying to production;
- accessing production data/secrets;
- destructive Docker/database/filesystem/Git operations.

Reversible branch-local work inside an already approved bounded scope does not require repeated approval at every edit.

For work bounded to `docs/brain/DEPLOYMENT_PERFORMANCE_ROADMAP.md`, the root orchestrator or assigned responsible agent may merge only under the five-condition authorization in `docs/brain/ORCHESTRATOR_PROTOCOL.md`. Production deployment remains an explicit human approval gate.

## Durable learning

Prefer enforcement over prose when practical:

1. regression test/eval;
2. deterministic validation/guard;
3. reusable helper/tool;
4. code/config contract;
5. canonical product/architecture/deployment documentation;
6. GitHub Issue for deferred work;
7. concise agent instruction when stronger enforcement is impractical.

Use `docs/brain/WORKED_LEARNINGS.md`, `FAILED_APPROACHES.md`, `KNOWN_ISSUES.md`, or `DEPLOYMENT_NOTES.md` only for durable knowledge that is likely to prevent meaningful future rework. Do not store secrets, raw logs, temporary state, or routine debugging history.
