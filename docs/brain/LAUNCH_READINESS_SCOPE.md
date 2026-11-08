# Everywhere Poster Launch Readiness Scope of Work

Prepared November 8, 2026. Status: proposed work scope; production remains on hold.

Deliver a dependable paid-launch path: a new user can sign up, connect an eligible account, upload and save content, publish successfully, and receive the correct paid access. Complete release preparation first, qualify the core journey before rollout, and verify the deployed result before declaring readiness.

The current task authorizes setup, documentation and readiness preparation only; no work-package or controller implementation is authorized. Each implementation requires its own bounded task. The separately supplied CONTROL-PLAN.md governs maintenance and takes precedence over this summary. It is available to the current task outside the repository and is intentionally not tracked here; future dependent work must obtain the current document before proceeding. Applying controls, stopping the app or proxy, merging, releasing, enabling recovery, publishing externally, and financial actions remain separate decisions. This scope is not an executable runbook.

# Verified baseline

| Item | Evidence and limit |
| --- | --- |
| Application repository | [celleree/everywhereposter](https://github.com/celleree/everywhereposter), canonical branch main |
| Current main | a237be798549f9d48d80a6b1f351164d9b2257b4, rechecked November 8 |
| Release candidate | [PR 327](https://github.com/celleree/everywhereposter/pull/327), open, draft and unmerged at b6402e4e888be9d85fb9950f1b62de3a171c5bfb |
| Candidate scope | Combined app-worker shutdown and pinned-download repairs; separate from production maintenance controls |
| Maintenance controls | Last documented status: preparation only and controls unapplied; fresh runtime confirmation is required |
| Production revision and health | Require fresh runtime verification; the earlier 26-commit gap is historical |
| Core, payment, social and editor status | Outstanding work is carried from the handoff; fresh end-to-end acceptance remains pending |

Revalidate identities before execution. Passing CI, Preview, merged code, deployed code and provider approval each require their own evidence.

# Work packages

## 1 Release safety and candidate qualification

**Result:** an exact, reviewed release package and a bounded transition procedure ready for the appropriate approval.

First package, preparation only:

- Draft the one-shot foreground maintenance controller against the exact CONTROL-PLAN contract. Include an action allowlist, artifact hashes, baseline requirements, stage transitions and fixed safe diagnostic outputs.
- Use the existing authority lock without replacing it. Serialize control and inhibitor changes under that lock. Preserve controls and the inhibitor on failed or uncertain outcomes.
- Prohibit app or proxy signals, authority or write-latch edits, raw-Docker repairs, automatic cleanup and automatic recovery re-enable. The one proposed watcher-service stop belongs only to a later specifically approved control application.
- Validate with syntax and focused isolated tests or fakes for lock contention, baseline drift, marker collision, stage failure and uncertain shutdown. Never point tests at the live production root or import live supervisor code.
- Obtain a fresh review of the exact final controller artifact from a reviewer who did not design or implement it. Record material findings and their disposition.

Candidate qualification is a separate bounded task: inspect required checks and the actual exact-HEAD review verdict; establish the selected SHA and, after an authorized build, its pinned image digest. Prepare fresh-backup validation, old/new compatibility checks, worker-stop evidence requirements, post-release checks and a recovery procedure for review. After any app/proxy signal attempt, preserve the inhibitor and the possible_target_writes latch as true and enter ASSESS_ONLY; this scope supplies no automatic rollback, restart, database restore or recovery re-enable.

**Acceptance:** controller artifacts and isolated tests match the plan; no material review findings remain; the candidate has matching required evidence. Fresh controller/startup exclusion, settled daemon operations and current runtime identities are execution prerequisites. Tests cannot establish them. Green candidate checks cannot prove that the old loaded workers will shut down safely.

**Exclusions:** applying controls, stopping app/proxy, image publication or release, merge, migration, database restore, replay of prior rollout/recovery transactions, recovery re-enable or full control uninstall.

## 2 Dependable core journey

**Result:** one reproducible supported path from a fresh signup to a verified post.

- Identify the exact candidate environment, organization, account and test media. Verify isolation from production databases, queues, storage and billing before mutating tests.
- Exercise signup, required email delivery/verification and login; connect the selected provider; upload representative supported media; save and reload the draft; inspect preview; publish immediately and schedule a separate post.
- Check persisted media and draft state, intended account/time, accurate failure messages and protection against an ordinary retry producing a duplicate post.
- Use stubs for provider calls until a real publication is authorized. Label stubbed queue/request checks as partial. Coordinate real Meta reconnect testing with package 4.

**Acceptance:** safe candidate checks pass first. Final end-to-end acceptance requires a separately authorized real post and scheduled-post result, provider identifier or URL, correct account, matching app status and no silent content loss or duplicate. Recheck the affected path on the exact deployed revision after an approved rollout.

**Exclusions:** broad UI redesign, new composer workflows, unrelated provider refactors and public posts outside the named test.

## 3 Payments and access

**Result:** verified checkout-to-access behavior under the existing approved subscription, trial and separate AI-billing rules.

- Inventory code, configuration, paused work and activation state before choosing a repair. Preserve existing pricing and product terms.
- In an isolated Stripe test environment, verify checkout/trial, signed webhook processing, subscription persistence and correct entitlements; cover webhook retries, failed payment and cancellation according to the approved policy.
- Verify applicable prepaid-AI accounting and BYOK boundaries without new paid generation or real charges.
- Document current production configuration and webhook-delivery checks as a later bounded verification. Earlier payment tests before the server move do not satisfy this gate.

**Acceptance:** a repeatable sandbox transaction produces the correct access and accounting exactly once; retry/failure tests pass; matching deployed configuration and webhook behavior are verified before accepting customers. Any real payment test requires a specifically authorized amount and test account.

**Exclusions:** pricing redesign, automatic billing activation from credentials, new charges, schema changes, database restore, and replay of the already-applied wallet-purchase migration.

## 4 Social connections and provider verification

**Result:** the platforms included in launch work for the intended user audience.

- Validate the existing Facebook/Instagram recovery fix with an authorized real Meta login on the exact candidate, without exposing tokens. Verify reconnect and account selection.
- Reproduce the TikTok creator-info error, preserve sanitized request/response evidence, identify its cause and make only the smallest demonstrated repair in a later implementation task.
- Track provider review and ordinary-user access separately from developer/tester login and successful test publishing. Capture current dashboard or equivalent authoritative evidence for required approvals.
- Feed connection fixes into package 2 before its corresponding provider path is accepted.

**Acceptance:** named supported accounts connect reliably; applicable publisher eligibility checks succeed; launch-required provider approvals are verified for ordinary users. Remaining excluded platforms have an explicit scope decision.

**Exclusions:** speculative API rewrites, assuming tester access proves public approval, ads, unsolicited outreach and new platform integrations.

## 5 Video editor acceptance

**Result:** the existing Standard editor produces a usable real-media output and hands it to the composer.

After core flow and payment gates, test a representative talking-head file through source selection, edit, preview, export/download, saved ordinary media and exact composer handoff. Inspect playback, audio/video synchronization, cuts, framing and any captions/headline features actually included in the selected route. Confirm the original remains available.

**Acceptance:** exported output opens and plays correctly; the saved media persists after reload; the composer receives the exact accepted output; the user accepts visual quality. Record supported behavior and remaining limits.

**Exclusions:** Cooked activation, prototype-to-production translation, new editor modes, new AI/transcription providers and additional paid model calls. Preserve the editor pause until this package is selected. Editor acceptance is a launch gate if the launch promise relies on it.

# Sequence and checkpoints

| Checkpoint | Work and exit condition |
| --- | --- |
| A Preparation | Complete package 1 controller proposal and review; qualify the selected candidate in a safe environment |
| B Candidate flow | Run package 2 safe checks; resolve required package 4 connection defects; run package 3 sandbox checks |
| C Controlled rollout | Only after candidate evidence and the required approvals, perform the separately scoped control application, transition and release |
| D Paid launch | Verify deployed core behavior, current payments and required provider access; resolve every material blocker in the named launch path |
| E Editor | Complete package 5 when selected; require it before advertising any launch path that depends on its output |

Preview testing and source-level diagnoses may overlap when environments and owned paths are independent. Production-control operations, authentication fixes and billing changes stay sequential. Release preparation does not require broad feature development.

# Ownership and change control

One root coordinator owns sequencing, shared contracts, scope, dependencies, evidence consolidation and integration. Use one implementation worker by default. Additional workers require independently bounded tasks, isolated branches/worktrees, disjoint write ownership and no unresolved shared contract. Delegation is one level; workers do not delegate further. A fresh reviewer independent of the design and implementation performs required final technical review. The product owner owns product decisions, visual acceptance and the existing operational approval gates. Coordination and scope review are not release approval.

Before each implementation, name owned files, shared dependencies, prohibited paths, checks and the stopping point. Use a separate coherent PR for each demonstrated defect. Reuse existing fixes where applicable. Keep the normal review-size targets and exact-HEAD verification rules from [AGENTS.md](../../AGENTS.md) and the [handoff protocol](CHATGPT_CODEX_HANDOFF.md). Repository-check completion does not grant production authority.

# Deliverables and completion evidence

Deliver one workstream checklist, the reviewed controller proposal, candidate qualification report, core-journey evidence, billing report, provider-verification record and editor acceptance record. Later implementation handoffs include the exact revision, changed files, check results, remaining risks and one next action.

Use not started, in progress, blocked, tested or live for each bounded task. Alongside that status, record repository evidence, candidate/Preview evidence, production evidence and external-provider evidence separately, with date, revision/environment, link, blocker and next action. A local or fixture pass never fills a production or provider evidence field.

Paid-launch readiness means the named ordinary-user path has matching deployed and provider evidence, current payment/access behavior works, no material security, billing, data-loss or publishing defect remains on that path, and a reviewed recovery procedure exists. Passing automated tests alone does not close the scope.

# Execution prerequisites

Record these decisions before their dependent work, using existing approvals where valid:

- The launch-required platforms and exact safe test environment, organization, accounts and media.
- The person authorized to approve the eventual real provider post and any financial test.
- Whether Standard editor output is included in the launch promise.
- The available production executor and exact approved control/release artifacts.

Do not invent a delivery date or fixed effort before the bounded readiness audit identifies access and environment constraints. At the end of the first package, report a measured estimate for the next selected package.

**Next bounded task:** prepare the foreground maintenance-controller implementation proposal, isolated verification plan and review package against the separately supplied CONTROL-PLAN.md. Return a concrete proposed artifact set and remaining implementation/execution gates; do not implement the controller or apply controls in the current setup task.

# Governing sources

- Separately supplied CONTROL-PLAN.md, current preparation and maintenance constraints. This operational document remains outside tracked files; obtain its current approved version before dependent work. No local repository link is provided because the document is not stored here.
- [PR 327](https://github.com/celleree/everywhereposter/pull/327), release-candidate identity and scope.
- [AGENTS.md](https://github.com/celleree/everywhereposter/blob/a237be798549f9d48d80a6b1f351164d9b2257b4/AGENTS.md) and [ChatGPT Codex handoff](https://github.com/celleree/everywhereposter/blob/a237be798549f9d48d80a6b1f351164d9b2257b4/docs/brain/CHATGPT_CODEX_HANDOFF.md), bounded work and review rules.
- [CURRENT_WORK.md](CURRENT_WORK.md), product routing and launch criteria. Historical operations checkpoints do not override the newer November 8 maintenance plan.

