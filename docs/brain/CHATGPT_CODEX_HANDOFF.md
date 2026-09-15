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

## Automated baton protocol

Use this section when the human wants to act only as a relay between a long-running Codex root session and ChatGPT. The human should not need to rewrite or interpret the handoff.

Codex should continue autonomously through normal reversible branch-local work and emit one of the exact baton types below only when ChatGPT or human action is genuinely required.

### Codex -> ChatGPT: merge gate

When a PR is fully ready to merge, Codex returns:

```text
BATON: MERGE_GATE
REPO: celleree/everywhereposter
PR: #[number]
HEAD_SHA: [exact reviewed PR HEAD]
BASE_SHA: [current base/main SHA]
PHASE: [phase/subphase]
SCOPE: [one sentence]
CI: PASS | FAIL
INDEPENDENT_REVIEW: PASS | NOT_REQUIRED | FAIL
MEASURED_RESULT: [concise measured result or N/A]
KNOWN_RISKS: [concise risk or NONE]
NEXT_AFTER_MERGE: [one concrete action]
REQUEST: Verify live GitHub state independently and merge only if HEAD, CI, review, and scope still match. Then return a CONTINUE_AFTER_MERGE baton.
```

Do not ask ChatGPT to trust the handoff. ChatGPT must independently verify live PR HEAD, diff/scope, CI, and required review before merging.

### ChatGPT -> Codex: continue after merge

After ChatGPT independently verifies and merges the PR, ChatGPT returns:

```text
BATON: CONTINUE_AFTER_MERGE
REPO: celleree/everywhereposter
PR: #[number]
MERGE_SHA: [verified main merge SHA]
RESULT: MERGED_AND_VERIFIED
INSTRUCTION: Verify live main, update durable checkpoint only if project state materially changed, clean completed worktree if safe, select the next highest-priority nonblocked bounded task from the active roadmap, and continue autonomously until the next genuine human/ChatGPT gate.
```

The human should paste this message unchanged into the original Codex root session.

### Codex -> ChatGPT: decision gate

When Codex reaches a decision that repository rules require ChatGPT/human review for, return:

```text
BATON: DECISION_GATE
REPO: celleree/everywhereposter
PHASE: [phase/subphase]
DECISION: [single decision needed]
WHY_BLOCKED: [one concise sentence]
OPTIONS:
A. [option + consequence]
B. [option + consequence]
RECOMMENDATION: [A/B + concise reason]
CURRENT_STATE: [branch/PR/HEAD if relevant]
REQUEST: Resolve only this decision and return a CONTINUE_DECISION baton.
```

Do not continue implementation past the blocked contract until the decision is returned.

### ChatGPT -> Codex: decision continuation

```text
BATON: CONTINUE_DECISION
REPO: celleree/everywhereposter
DECISION: [approved decision]
CONSTRAINTS: [any explicit constraints or NONE]
INSTRUCTION: Continue the existing bounded task from the current live state. Do not widen scope. Reverify any assumptions affected by this decision and continue autonomously until the next genuine gate.
```

### Codex -> ChatGPT: production gate

When a production deployment or rollback is actually ready and repository prerequisites are satisfied, return:

```text
BATON: PRODUCTION_GATE
REPO: celleree/everywhereposter
ACTION: DEPLOY | ROLLBACK
TARGET_SHA: [exact full main SHA]
IMAGE: [exact full-SHA image reference]
PR_OR_PHASE: [source PR/phase]
CI: PASS
INDEPENDENT_REVIEW: PASS
PREDEPLOY_CHECKS: PASS
CHANGE_SUMMARY: [one sentence]
ROLLBACK_PLAN: [concise]
KNOWN_RISKS: [concise risk or NONE]
REQUEST: Independently verify release prerequisites and request explicit human production approval. Do not deploy without that approval.
```

ChatGPT must not convert a merge approval into production approval. Production approval remains separate.

### ChatGPT -> Codex: production authorization

Only after explicit human production approval and independent verification:

```text
BATON: CONTINUE_PRODUCTION
REPO: celleree/everywhereposter
ACTION: DEPLOY | ROLLBACK
TARGET_SHA: [exact approved full SHA]
APPROVAL: EXPLICIT_HUMAN_APPROVAL_CONFIRMED
INSTRUCTION: Execute only the approved production action using the repository operating manual, verify the exact result, record required release/deployment evidence, and stop immediately on any safety check failure.
```

### Codex -> ChatGPT: blocker

For a genuine external or tooling blocker that Codex cannot resolve safely:

```text
BATON: BLOCKED
REPO: celleree/everywhereposter
PHASE: [phase/subphase]
CURRENT_STATE: [branch/PR/HEAD]
BLOCKER: [precise blocker]
ATTEMPTS: [brief evidence-based attempts; no raw logs]
NEEDED: [specific action/access/information]
SAFE_PARALLEL_WORK_AVAILABLE: YES | NO
NEXT_IF_RESOLVED: [one action]
```

### ChatGPT -> Codex: blocker resolved

```text
BATON: CONTINUE_AFTER_BLOCKER
REPO: celleree/everywhereposter
RESOLUTION: [what changed or became available]
INSTRUCTION: Reverify the blocker is actually resolved from live state, then resume the existing roadmap/task autonomously. Do not assume stale branch, PR, CI, or production state.
```

### Relay rules

- The human should copy each baton unchanged between ChatGPT and the long-running Codex root session.
- Do not include large logs, diffs, roadmap text, or source-of-truth documents in a baton; use repository pointers instead.
- Codex should not emit a baton for ordinary planning, implementation, tests, CI monitoring, repair, PR creation, or exact-SHA review when those actions are already authorized by the active roadmap.
- ChatGPT should independently verify live GitHub state before performing any merge or approving the next irreversible/high-risk action.
- After a successful merge, Codex should continue to the next bounded roadmap task without asking the human what to do next.
- A changed PR HEAD invalidates a baton tied to an older reviewed HEAD.
- Keep the same Codex root session across multiple batons until context quality degrades; use fresh sessions for independent reviewers.
- Never run more than one local Ollama/GPU worker concurrently; safe parallelism should use cloud workers for the additional lane.

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
