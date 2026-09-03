# ChatGPT <-> Codex Handoff Protocol

## Purpose

Use this protocol when a human is relaying work between ChatGPT and Codex. The goal is to keep prompts bounded, preserve exact repository state, make review independent, and avoid wasting Codex context or credits.

## ChatGPT routing header

Whenever ChatGPT prepares a prompt for Codex, put this routing header above the prompt every time:

```text
CODEX MODEL: [recommended model]
CHAT NAME: [specific session/chat name]
REASONING: [light / medium / high / extra high / ultra]
PARALLEL: YES | NO
WHY: [one sentence]
```

The routing header is a ChatGPT-to-human instruction. Codex does not choose or rewrite these fields after the session starts.

Use the same Codex chat for an approved investigation -> implementation -> repair sequence when retaining context is useful. Use a fresh Codex chat for independent review so the reviewer does not inherit the implementer's transcript.

## Incoming prompt structure

Prefer this compact structure for prompts relayed from ChatGPT to Codex:

```text
TASK:
[concrete next task]

CONTEXT:
[only context not already available in canonical repo sources]

SOURCE OF TRUTH:
[exact files, Issue, code, config, or commit to trust]

SCOPE:
[what may change]

DO NOT:
[explicit exclusions]

INSTRUCTIONS:
[current checkpoint only]

RETURN:
[required result fields]
```

Do not repeat large amounts of repository context that Codex can read from canonical files.

## Codex return format

For plans, investigations, implementation results, reviews, repairs, or blockers, Codex should return this compact copy/paste-ready handoff by default:

```text
STATUS:
COMPLETE | PARTIAL | BLOCKED | INVESTIGATION COMPLETE | APPROVAL NEEDED

TASK:
[one sentence]

BRANCH:
[current branch]

BASE MAIN SHA:
[main SHA this work started from, when relevant]

HEAD SHA:
[current/final SHA, or N/A if no changes]

FILES INSPECTED/CHANGED:
- only materially relevant files
- or NONE

IMPLEMENTATION / FINDINGS:
- concise findings or changes
- no play-by-play reasoning

VERIFICATION:
- exact check: PASS | FAIL | NOT RUN

BLOCKERS:
- exact blocker
- or NONE

DECISIONS NEEDED:
- exact unresolved decision
- or NONE

SHARED CONTRACTS / AREAS AFFECTED:
- shared schema/API/storage/central files
- or NONE

RISKS / CONFLICTS:
- relevant merge or regression risk
- or NONE

REMAINING:
- unfinished work
- or NONE

NEXT RECOMMENDED ACTION:
[one concrete next step]

PARALLEL-SAFE NEXT WORK:
YES | NO
Reason: [one sentence]
```

Do not include raw command logs unless they explain a failure, long diffs unless requested, private chain-of-thought, or a play-by-play transcript.

## ChatGPT-managed implementation cycle

For bounded implementation work coordinated manually between ChatGPT and Codex, default to checkpoints instead of one large prompt:

1. **Investigation / plan only.** Start from current `main`, inspect the smallest relevant file set, do not edit yet, confirm the contract, propose the smallest coherent implementation, estimate scope, list focused tests, and surface unresolved decisions.
2. **ChatGPT review.** Return the plan to ChatGPT. Resolve scope, architecture, sequencing, PR-size, and product-contract questions before editing.
3. **Implementation.** Continue the original implementation session and implement only the approved plan. Run focused verification before broader PR checks.
4. **Independent review.** Use a fresh Codex session for the exact current PR/HEAD SHA when independent review is required. The reviewer should return findings, not silently repair the implementation.
5. **Repair.** Send verified findings back to the original implementation session. Keep fixes inside the approved scope unless a new decision is explicitly reviewed.
6. **Re-verify.** Re-run the relevant checks. Any HEAD change after a required exact-SHA review invalidates that review. For a trivial follow-up commit, the fresh review may be scoped to the new diff, but the new HEAD SHA must still be reviewed and recorded.
7. **Merge/deploy gate.** Merge or deployment still requires the repository's normal human approvals and operational rules.

Simple low-risk mechanical work may combine investigation and implementation when there is no meaningful design decision, review boundary, or value from a separate checkpoint.

## Review depth and edge cases

Do not create infinite review loops trying to enumerate every theoretical edge case.

Default maximum: **three independent broad review passes for the same bounded change**.

- Pass 1: correctness, acceptance criteria, regressions, obvious edge cases, product contracts, and safety.
- Pass 2: verify fixes and deliberately look for missed realistic edge cases or shared-contract breakage.
- Pass 3: final bounded challenge pass when the change warrants it.

After three passes, unresolved ordinary edge cases should be documented as remaining risk or follow-up work rather than causing another broad review cycle.

Continue broad review beyond three passes only when a review still finds or strongly indicates a **material high-severity risk**, including security/authentication/authorization failures, exposed secrets, destructive production behavior, persistent customer-data loss/corruption, billing/payment risk, unauthorized publishing, or another comparably consequential failure. Stop once those material findings are resolved and the required fresh review passes.

After pass 3, when a concrete finding is repaired and changes HEAD, the required fresh exact-SHA review may be narrowly scoped to the repair and the interactions needed to validate it. This scoped repair verification does not count as a new broad review pass and must not resume unrelated edge-case discovery. If it finds a concrete defect in the repair, fix and re-verify the new SHA in the same narrow scope.

Do not extend broad review merely because another hypothetical low-impact edge case can be imagined.

## Parallel decision

Default to **one implementation agent**.

Recommend parallel implementation only when all of these are true:

1. There are at least two bounded tasks with clear finish lines.
2. Neither depends on an unresolved shared contract, schema, API, central type, storage design, or product decision.
3. File/subsystem overlap is low enough to assign explicit ownership.
4. Each task can be developed and verified independently on an isolated branch/worktree.
5. Parallel work is likely to save meaningful time after coordination, review, and merge cost.

Start with at most two concurrent implementation agents unless the user explicitly approves a broader plan.

If a parallel workstream discovers a shared-contract dependency, stop that workstream and return the dependency to ChatGPT instead of inventing a competing design.

## PR reviewability

Prefer the smallest coherent, self-contained PR that leaves the repository in a valid state.

Guidelines for substantive handwritten changes:

- Preferred target: <=200 changed lines when practical.
- Normal soft ceiling: <=400 changed lines.
- Split or explicitly justify when more than 10 substantive files are touched.
- High-risk changes should prefer <=200 substantive changed lines.
- Generated files, lockfiles, snapshots, mechanical formatting, and bulk moves/renames do not count the same as substantive review work.
- AI generation speed is never a justification for a larger PR.

Batch tiny related low-risk work only when the batch remains easier to understand, test, review, and roll back than separate PRs. Do not use an arbitrary task count as the default batching target.

If splitting would reduce correctness, coherence, or create an invalid intermediate state, keep the PR together and explain why and provide a review order.

## Durable learning

After a meaningful correction, failure, or experiment, capture a permanent lesson only when future reuse justifies it.

Prefer the first feasible enforcement location:

1. regression test/eval;
2. deterministic validation or guard;
3. reusable helper/tool;
4. code/config contract;
5. existing canonical product/architecture/deployment documentation;
6. GitHub Issue when work is deferred;
7. concise agent instruction only when stronger enforcement is impractical.

Do not turn routine syntax/type/build fixes, expected failed experiments, transient service errors, abandoned ideas, or one-off debugging into permanent brain entries unless they expose a deeper missing guard.
