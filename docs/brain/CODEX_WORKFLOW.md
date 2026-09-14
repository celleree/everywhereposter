# Codex Workflow

Use this file as the self-improving brain protocol for Codex sessions in this repo.

For manual ChatGPT <-> Codex routing, return format, review depth, PR reviewability, and parallel-work decisions, also follow `CHATGPT_CODEX_HANDOFF.md`.

## Session start

- Run `git status --short`.
- Run `git log -5 --oneline`.
- Confirm the current branch and base `main` SHA before implementation work.
- For a narrow issue/error, start from that issue/error and the directly relevant code/tests.
- For project continuation, roadmap, prioritization, or “what next?” work, read `CURRENT_WORK.md`.
- For product/capability/copy decisions, read `PRODUCT_TRUTH.md`.
- For locating a subsystem, read `REPOSITORY_ROUTING.md`.
- Read `OPERATING-MANUAL.md` before operational, deploy, Docker, database, environment, or production work.
- Do not load every brain document by default.

## Work style

- Use credit-saving mode.
- Start from the error, issue, current checkpoint, or named file.
- Inspect the smallest useful file set.
- Explain the plan before editing meaningful non-mechanical work.
- Make the smallest coherent working fix.
- Run the narrowest relevant verification while iterating.
- Let CI provide broad regression/typecheck/build evidence by default.
- Show/review the diff after changes.
- Do not expand scope merely because adjacent cleanup is available.

## Project-continuation workflow

When asked to continue EverywherePoster without a narrower task:

1. Read `CURRENT_WORK.md`.
2. Verify the relevant live GitHub state rather than trusting stale checkpoint text blindly.
3. Identify the highest-priority active workstream that is not externally blocked.
4. Classify the next checkpoint as COMPLETE, PARTIAL, NOT STARTED, or BLOCKED when useful.
5. Convert only confirmed remaining work into the smallest coherent investigation/PR.
6. Keep architecture, sequencing, and integration decisions at the coordinator/root-agent level.
7. Reassess `CURRENT_WORK.md` after a meaningful merged checkpoint; update it only when project state materially changed.

Do not infer that a merged repository change is deployed, that external provider verification is complete, or that a product capability is live without the required evidence.

## ChatGPT-managed checkpoints

For bounded work being coordinated manually through ChatGPT, use these checkpoints instead of one giant prompt:

1. Investigation/plan only; no edits yet.
2. Return the plan to ChatGPT for scope and architecture review.
3. Continue the same implementation session to make only the approved changes.
4. Use a fresh independent Codex session for review when review is required.
5. Send verified findings back to the original implementation session for repair.
6. Re-run focused verification after repairs.
7. If the reviewed HEAD changed, obtain a fresh exact-SHA review when required. For a trivial follow-up commit, the fresh review may be scoped to the new diff, but the new HEAD SHA must still be reviewed and recorded.

Simple low-risk mechanical changes may combine planning and implementation when there is no meaningful design decision or review benefit from a separate checkpoint.

## Review depth

Do not spend unlimited cycles inventing increasingly remote edge cases.

Default maximum: three independent broad review passes for the same bounded change.

- First pass: acceptance criteria, correctness, regressions, realistic edge cases, product contracts, and safety.
- Second pass: verify fixes and look deliberately for missed realistic edge cases or shared-contract breakage.
- Third pass: final bounded challenge pass when warranted.

After three passes, ordinary unresolved edge cases should be disclosed as remaining risk or moved to follow-up work rather than causing another automatic broad review cycle.

Continue broad review beyond three passes only while there is an unresolved or newly discovered material high-severity risk involving security/authentication/authorization, secrets, destructive production behavior, persistent customer-data loss/corruption, billing/payment, unauthorized publishing, or another comparably consequential failure.

After pass 3, when a concrete finding is repaired and changes HEAD, the required fresh exact-SHA review may be narrowly scoped to the repair and interactions needed to validate it. This scoped repair verification does not count as a new broad review pass and must not resume unrelated edge-case discovery. If it finds a concrete defect in the repair, fix and re-verify the new SHA in the same narrow scope.

## Brain update protocol

Update the brain only when a lesson is durable and likely to prevent future wasted work.

Before writing a Markdown memory entry, prefer stronger enforcement when practical:

1. regression test or eval;
2. deterministic validation or guard;
3. reusable helper or tool;
4. code/config contract;
5. canonical product, architecture, or deployment documentation;
6. GitHub Issue for deferred work;
7. brain/agent instruction only when stronger enforcement is impractical.

Good brain entries:

- A verified root cause and fix pattern that cannot be better enforced elsewhere.
- A failed approach that future agents may realistically retry.
- A product/platform contract that constrains future changes.
- A deployment or operations rule that protects live data.
- A known issue with clear reproduction or scope.

Do not add speculation, routine syntax/type/build fixes, expected failed experiments, one-off command output, temporary local state, transient service failures, abandoned ideas without durable constraints, secrets, or large logs.

## Where to put knowledge

- `CURRENT_WORK.md`: current priorities, workstream state, and the next bounded checkpoint.
- `PRODUCT_TRUTH.md`: durable product behavior and promises.
- `REPOSITORY_ROUTING.md`: subsystem/file routing.
- `WORKED_LEARNINGS.md`: durable fixes/patterns that are not better enforced elsewhere.
- `FAILED_APPROACHES.md`: attempted approaches that should not be repeated.
- `KNOWN_ISSUES.md`: unresolved issues and current risk.
- `DEPLOYMENT_NOTES.md`: deployment, hosting, Docker, database, and verification notes.

Keep `CURRENT_WORK.md` concise and state-oriented; it is not a changelog.
