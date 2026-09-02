# Codex Workflow

Use this file as the self-improving brain protocol for Codex sessions in this repo.

For manual ChatGPT <-> Codex routing, return format, review depth, PR reviewability, and parallel-work decisions, also follow `CHATGPT_CODEX_HANDOFF.md`.

## Session Start

- Run `git status --short`.
- Run `git log -5 --oneline`.
- Read `OPERATING-MANUAL.md` before operational, deploy, Docker, database, or production work.
- For product, copy, platform, or workflow changes, check the relevant files in `docs/brain/`.
- Confirm the current branch and base `main` SHA before implementation work.

## Work Style

- Use credit-saving mode.
- Start from the error, issue, or named file.
- Inspect the smallest useful file set.
- Explain the plan before editing.
- Make the smallest coherent working fix.
- Run the narrowest relevant verification.
- Show the diff after changes.
- Do not expand scope merely because adjacent cleanup is available.

## ChatGPT-Managed Checkpoints

For bounded work being coordinated manually through ChatGPT, use these checkpoints instead of one giant prompt:

1. Investigation/plan only; no edits yet.
2. Return the plan to ChatGPT for scope and architecture review.
3. Continue the same implementation session to make only the approved changes.
4. Use a fresh independent Codex session for review when review is required.
5. Send verified findings back to the original implementation session for repair.
6. Re-run focused verification after repairs.
7. If the reviewed HEAD changed materially, obtain a fresh exact-SHA review when required.

Simple low-risk mechanical changes may combine planning and implementation when there is no meaningful design decision or review benefit from a separate checkpoint.

## Review Depth

Do not spend unlimited cycles inventing increasingly remote edge cases.

Default maximum: three independent review passes for the same bounded change.

- First pass: acceptance criteria, correctness, regressions, realistic edge cases, product contracts, and safety.
- Second pass: verify fixes and look deliberately for missed realistic edge cases or shared-contract breakage.
- Third pass: final bounded challenge pass when warranted.

After three passes, ordinary unresolved edge cases should be disclosed as remaining risk or moved to follow-up work rather than causing automatic additional review cycles.

Continue beyond three passes only while there is an unresolved or newly discovered material high-severity risk involving security/authentication/authorization, secrets, destructive production behavior, persistent customer-data loss/corruption, billing/payment, unauthorized publishing, or another comparably consequential failure.

## Brain Update Protocol

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

Do not add:

- Speculation.
- Routine syntax/type/build fixes.
- Expected failed experiments.
- One-off command output.
- Temporary local state.
- Transient service failures.
- Abandoned ideas that create no durable constraint.
- Secrets or environment values.
- Large logs or stack traces.

## Where To Put New Knowledge

- `PRODUCT_TRUTH.md`: durable product behavior and promises.
- `WORKED_LEARNINGS.md`: fixes or patterns that worked and are not better enforced elsewhere.
- `FAILED_APPROACHES.md`: attempted approaches that should not be repeated.
- `KNOWN_ISSUES.md`: unresolved issues and current risk.
- `DEPLOYMENT_NOTES.md`: deployment, hosting, Docker, database, and verification notes.

## Entry Format

Use short dated entries:

```md
## YYYY-MM-DD - Short Title

- Context: What was being changed or debugged.
- Finding: The durable thing learned.
- Action: What future agents should do.
- Evidence: File, command, commit, or manual verification.
```
