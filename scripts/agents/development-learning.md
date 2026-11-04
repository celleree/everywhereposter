# EverywherePoster development learning pilot

This offline tool supports the existing supervised coding process. It records
private task receipts and freezes reviewable improvement proposals and prospective
cohorts. It uses Node builtins, makes no network/model calls, executes no commands,
and cannot activate proposals or edit code. Public-repository automation restrictions
in `codex-task.sh` and the normal review/CI/permission gates continue to apply.

## Run a complete supervised cycle

1. Finish a bounded EverywherePoster coding task using the existing plan, tests,
   exact-HEAD independent review and CI workflow. Prepare a **sanitized** evidence
   file identifying the check, exact repository/commit, result and evidence origin.
   Keep any detailed source evidence privately under the operator's normal retention policy.
2. Record the task with its full commit SHA and evidence-file SHA-256. Use `real`
   only for an actual development task; fixture exercises use `synthetic`. Use
   `unknown` or `null` where evidence or metrics are unavailable. Record failed
   tasks too; never select only successes.
3. When evidence warrants a reusable improvement, propose its smallest enforcement
   location (regression test, guard, helper, contract, then documentation). Review
   the private summary and supporting evidence with a human. The tool always
   retains `needs_human_review`; normal authorization governs the implementation PR.
4. **Before beginning later tasks**, reserve distinct candidate IDs in the proposal.
   Implement the reviewed improvement through the normal bounded PR/review process.
   Then collect the declared tasks using the same class/check and measurement method,
   recording each implementation HEAD. Include failures, unknowns and abandoned tasks.
5. Report the cohort, inspect evidence and compare measurements with a human.
   Consider task difficulty and other changes before deciding whether to keep,
   adjust or revert the improvement through another ordinary PR.

The tool enforces declaration before *receipt ingestion*, not actual task start.
The operator must establish task timing, check truth, implementation identity and
comparable workload. Receipt SHAs are recorded identities, not Git/API validation.
An evidence hash proves file integrity at ingestion, **not that a check passed**.
Reports label outcomes `operator_attested` and effectiveness `not_established`.
This pilot does not demonstrate improved coding performance or autonomous learning.

## Commands and inputs

Use an absolute owner-private directory **outside every Git checkout**, on a
private persistent operator disk. Do not upload the ledger, input/evidence files,
transcripts, credentials or customer data to GitHub or public CI artifacts. Inputs
must also be prepared privately. The tool stores only the evidence digest, never
its path/content. The free-text proposal summary still requires privacy review.

```sh
node scripts/agents/development-learning.mjs record /private/state/ep-learning /private/receipt.json
node scripts/agents/development-learning.mjs propose /private/state/ep-learning /private/proposal.json
node scripts/agents/development-learning.mjs report /private/state/ep-learning proposal-001
node --test scripts/agents/development-learning.test.mjs
```

Receipt input (all fields required; replace the example hash with the actual digest):

```json
{"version":1,"id":"task-001","kind":"real","classId":"agent-tooling","checkId":"focused-tests","head":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","outcome":"passed","durationMs":null,"repairCount":null,"evidence":{"path":"/private/check-result.json","sha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}}
```

Proposal input:

```json
{"version":1,"id":"proposal-001","kind":"real","classId":"agent-tooling","checkId":"focused-tests","summary":"Enforce a recurring coding-workflow failure with a focused regression test","enforcement":"regression_test","baselineIds":["task-001"],"candidateIds":["task-002","task-003"]}
```

IDs match `[a-z0-9][a-z0-9_-]{0,63}`. Outcomes are `passed`, `failed` or `unknown`.
Metrics are nonnegative integers up to 1e12 or `null`; elapsed milliseconds and
repair iterations must use a consistent operator-defined measurement method.
Enforcement accepts `regression_test`, `guard`, `helper`, `contract`, `documentation`.
Reports separate a proposal's real/synthetic kind, outcome counts, pending tasks,
and metric totals with **measured denominators**. Unknown values never become zero.

Inputs/records are bounded to 64 KiB, evidence to 10 MiB, cohorts to 50 IDs each,
and a store to 1,000 records/proposals. Baselines must exist and match kind/class/check;
candidate IDs must be new and unreserved. Baseline hashes are frozen in proposals.
Exact replay is idempotent; conflicting duplicates fail. Entries use exclusive
creation and private modes, with a fail-closed single-writer lock. An interrupted
writer may leave `.lock`; inspect its state privately before manual recovery.
There is no overwrite, deletion, approval or activation command. Back up the ledger
privately: temporary cloud storage alone is not durable adoption.

The existing `test-codex-task.sh` CI harness also runs these focused tests, without
changing workflows or the active development-speed workstream. Run the standalone
command above during local work in addition to normal repository gates.
