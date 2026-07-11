# Codex Workflow

Use this file as the self-improving brain protocol for Codex sessions in this repo.

## Session Start

- Run `git status --short`.
- Run `git log -5 --oneline`.
- Read `OPERATING-MANUAL.md` before operational, deploy, Docker, database, or production work.
- For product, copy, platform, or workflow changes, check the relevant files in `docs/brain/`.

## Work Style

- Use credit-saving mode.
- Start from the error, issue, or named file.
- Inspect the smallest useful file set.
- Explain the plan before editing.
- Make the smallest working fix.
- Run the narrowest relevant verification.
- Show the diff after changes.
- Stop after the first working fix unless the user asks for more.

## Brain Update Protocol

Update the brain only when a lesson is durable and likely to prevent future wasted work.

Good brain entries:

- A verified root cause and fix pattern.
- A failed approach that future agents may be tempted to retry.
- A product/platform contract that constrains future changes.
- A deployment or operations rule that protects live data.
- A known issue with clear reproduction or scope.

Do not add:

- Speculation.
- One-off command output.
- Temporary local state.
- Secrets or environment values.
- Large logs or stack traces.

## Where To Put New Knowledge

- `PRODUCT_TRUTH.md`: durable product behavior and promises.
- `WORKED_LEARNINGS.md`: fixes or patterns that worked.
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
