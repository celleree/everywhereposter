# Worked Learnings

Durable patterns that worked in this repo. Add short entries when a fix or workflow should be reused.

## 2026-07-09 - Brain Filesystem Bootstrap

- Context: `AGENTS.md` referenced `docs/brain/*`, but the files did not exist and the root `WORKED_LEARNINGS.md` was empty.
- Finding: The repo already had strong operating rules in `AGENTS.md` and `OPERATING-MANUAL.md`; the missing piece was a canonical memory location.
- Action: Keep long-term project memory in `docs/brain/` and use root `WORKED_LEARNINGS.md` only as a pointer.
- Evidence: `docs/brain/` now contains the referenced brain files.

## 2026-11-02 - Match UX evidence to the user outcome

- A successful upload receipt does not prove that transfer history cleared or that saved media remains usable. Reproduce the representative mix (including multiple old completions and recovery rows), then verify the rendered outcome, polling/reload and saved-media selection.
- Record exact source identity and fixture/backend scope. Passing helper or mocked-browser tests cannot establish deployed storage, provider publishing or physical-phone acceptance; keep those checks explicitly open in the [journey checklist](../browser-acceptance.md#core-journey-ux-checklist).

## Entry Template

```md
## YYYY-MM-DD - Short Title

- Context:
- Finding:
- Action:
- Evidence:
```
