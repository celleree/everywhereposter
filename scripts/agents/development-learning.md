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
   Retain the first creation response's `receiptToken` privately outside the
   editable ledger. Candidate receipts require this original integrity anchor.
3. When evidence warrants a reusable improvement, propose its smallest enforcement
   location (regression test, guard, helper, contract, then documentation). Review
   the private summary and supporting evidence with a human. The tool always
   retains `needs_human_review`; normal authorization governs the implementation PR.
   Retain the first creation response's `reportToken` privately outside the editable
   ledger. Reports require this original integrity anchor; duplicate proposals do
   not issue another token. Never replace it with a hash recomputed from the ledger.
4. **Before beginning later tasks**, reserve distinct candidate IDs in the proposal.
   Implement the reviewed improvement through the normal bounded PR/review process.
   Then collect the declared tasks using the same class/check and measurement method,
   recording each implementation HEAD. Include failures, unknowns and abandoned tasks.
5. Report with a private external manifest containing the original `reportToken`
   and original `receiptTokens` for every recorded candidate. Inspect evidence
   and compare measurements with a human.
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
private persistent operator disk. Do not upload the ledger, input/evidence/anchor files,
transcripts, credentials or customer data to GitHub or public CI artifacts. Inputs
must also be prepared privately. The tool stores only the evidence digest, never
its path/content. The free-text proposal summary still requires privacy review.

```sh
node scripts/agents/development-learning.mjs record /private/state/ep-learning /private/receipt.json
node scripts/agents/development-learning.mjs propose /private/state/ep-learning /private/proposal.json
node scripts/agents/development-learning.mjs report /private/state/ep-learning /private/report.json
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

Report input (populate it from the first creation responses; hashes below are placeholders):

```json
{"version":1,"reportToken":"proposal-001:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","receiptTokens":["task-002:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"]}
```

First creation emits a `receiptToken` for a receipt or `reportToken` for a proposal
(`id:sha256` of the canonical stored entry). Duplicate replay emits only its status,
never another token. Retain the original tokens in a trusted manifest outside the
editable ledger and outside Git; never replace them with hashes recomputed from it.
The proposal token binds its plan and baseline hashes; candidate tokens bind their
complete receipts, including identity, outcome, metrics, head and evidence digest.
Every used stored entry is strictly validated before aggregation. Each recorded
candidate requires its original matching token. Duplicate/foreign token IDs,
missing anchors, tokens without receipts and edited data fail closed. Future tasks
without receipts or tokens remain pending; at most 50 candidate tokens are allowed.

The external manifest is operator-trusted. These checks detect ledger edits against
that reference; they do not authenticate outcomes or constrain a privileged operator
who rewrites both data and anchors. A lost-token or tokenless historical entry is
audit-only for prospective use: replay cannot recover its creation anchor. Historical
receipts may be operator-attested baseline snapshots in a new proposal, but choose
a new plan and new future task IDs instead of retrospectively blessing candidates.

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
