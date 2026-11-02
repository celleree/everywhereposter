# Browser evidence and real-backend acceptance

Offline CI (`pnpm run test:browser:ci` from `postiz-app`) renders the real frontend against a synthetic API, using pinned Playwright/Chromium. Its fixture safety, mobile Scheduled layout and upload-picker viewport/attachment checks belong to the existing quality job, so failure blocks the required Docker build aggregate. No separate status requirement is needed. Reports/traces/screenshots expire after seven days; record the run URL and exact PR HEAD before expiry. The broader `pnpm run test:browser` suite covers desktop Chromium and emulated Chromium/WebKit phones. Neither suite proves a physical device, deployed authentication, uploads, storage persistence or provider publishing.

## Separate real-backend acceptance

For storage/draft/auth/media changes, the release owner must record the following against the exact reviewed HEAD and selected deployed image. Offline CI cannot satisfy this record. Never point the synthetic runtime or synthetic session cookie at a real backend.

1. Use an explicitly authorized isolated backend/database/media volume and a disposable account; confirm the instance and commit/image before opening a fresh browser context. Do not reuse production sessions or real customer content. Starting infrastructure, migrations, production writes and cleanup require their applicable authorization.
2. Sign in through the real authentication flow. Upload a small synthetic image and video through the real uploader; verify returned media identifiers, metadata, poster/preview and storage retrieval. An unavailable uploader is **blocked**, not a passing mocked substitute.
3. Attach each asset to a draft, save, reload, and reopen from a fresh browser context. Confirm text and media persist, nullable legacy metadata stays absent rather than becoming fabricated data, preview does not autoplay and cancellation preserves the draft. Keep publishing/provider mutations outside this smoke unless separately authorized.
4. Exercise the relevant error/retry case using the owned isolated backend. Confirm recovery and absence of duplicate persisted draft/media records.
5. For phone interaction changes, check the affected path on a physical phone: keyboard, touch, viewport/orientation and preview controls. Emulated WebKit is useful regression coverage but cannot close physical-device acceptance.

Record a compact receipt: `HEAD | PR | CI run | review URL/SHA | backend/image | isolated-data scope | browser/device | upload/save/reload outcome | artifact links | blocked/not-run items`. Never include cookies, credentials, account identifiers, database URLs or customer media. A blocked/not-run item remains disclosed to the release approver; green offline CI does not waive it.

Tooling guidance follows [Playwright CI documentation](https://playwright.dev/docs/ci): install the lockfile dependencies, install browser/system dependencies with the pinned CLI, use one worker, and retain diagnostics on failure. The CI smoke has a 15-minute total bound including warm-up, zero retries and no real-service fallback.

## Active automation versus hosted-wrapper availability

This repository is public. `scripts/agents/codex-task.sh` explicitly refuses non-private repositories before launching a role; that restriction remains intentional and unchanged. The self-hosted `Codex development agents` workflow can therefore appear in run history without providing an applicable automated planner, implementer or reviewer here. Do not count its availability or generic completion comments as independent final-HEAD review evidence. Use the actual saved independent review URL and reviewed SHA in the receipt, and verify them against the live PR HEAD. A later HEAD change requires the applicable fresh review; unchanged content does not justify duplicate reviews. The active PR safeguard is the required aggregate `Docker build` check (quality/classifier/conditional image validation) plus `Canonical branch guard`.


## Core journey UX checklist

Use this bounded checklist when changing a journey; it is not a completed app audit. Preserve EverywherePoster branding and the shortest sensible automation-first flow. Keep advanced choices optional and show only settings needed for the selected destination. A source/test inspection is not deployed or live-provider verification. Mark untested items explicitly; attach exact HEAD, environment, representative input and observable outcome before closing a gap.

| Journey | Expected behavior / reference | Evidence and gap | Fix / regression verification |
| --- | --- | --- | --- |
| Accounts | Clear connected/reconnect state and next step; cancellation preserves the account. [Heuristics][heuristics], [actions][actions]. | User reported TikTok reconnection success on 2026-11-02; failure/cancel paths **not tested here**. | Exercise reconnect success, denial, cancel and expired session in an authorized isolated flow; verify account state after reload. No extra confirmation for routine reversible actions. |
| Upload | Progress reflects server receipts; successful history clears after 10 seconds once media exists. Errors/recovery and publishing results remain. [Notifications][notifications], [loading][loading]. | Source inspection found indefinitely restored completed rows. Local automated regression covers eight old completions plus fresh, recovery/failure and Quick Upload rows; this does not verify deployed storage. | Presentation-only cleanup; regress polling/remount, focused controls and selection of saved media without DELETE or publish requests. |
| Edit | Keep source/draft through cancel, navigation and failure; distinguish processing, reviewable result and saved result. [Actions][actions], [heuristics][heuristics]. | **Not tested in this change**; no claimed editor defect. | Record one representative input through edit, save/reload and recoverable failure; check no duplicate output or lost source. |
| Schedule | Show timezone, destination and committed schedule; invalid input identifies the field and preserves entries. [GOV.UK validation][validation]. | Existing fixture suite covers parts of Scheduled; timezone/save/reload outcomes **not tested here**. | Verify a valid schedule and invalid/past-time correction using an authorized isolated backend; reload the persisted result. |
| Publish | Explicit publishing intent; queued, publishing, published and per-destination failure are distinct. Upload completion alone never means published. [Heuristics][heuristics], [notifications][notifications]. | Transfer tests preserve Quick Upload results; real publishing **not tested or performed here**. | Isolated provider fixtures must cover duplicate click, partial failure and retry; require separate approval for any real post. |
| Recovery | Actionable inline error with safe retry; retain input and uncertain outcomes. Keep errors visible until addressed. [Validation][validation], [notifications][notifications]. | Focused transfer tests cover interruption, lost acknowledgements and pending consent. Broader recovery **not audited**. | Repeat the failed step after interruption/reload; verify one durable identity and retained media/draft, not merely a passing HTTP response. |
| Feedback / empty states | Use brief success feedback for routine completion; inline errors for field/action problems; persistent feedback for required action. Loading, no content, filtered-out content and failure need distinct next steps. [Notifications][notifications], [loading][loading], [empty states][empty]. | Toaster source uses 4.2 seconds; transfer success uses 10 seconds. Other feedback/empty states **not tested here**. | Check one empty/loading/error/success state per changed surface. Avoid duplicate toasts when inline progress already explains the result; reserve blocking dialogs for consequential decisions. |
| Accessibility / mobile | Named keyboard controls, visible focus, logical focus return, text status beyond color, readable contrast/zoom and reachable touch controls. Announce status without stealing focus. [A11Y Project][a11y], [WCAG status][status]. | Transfer rows already use status roles; cleanup regression preserves a focused row. Full contrast, zoom, screen reader and physical-phone acceptance **not run**. | Keyboard-test the changed path and inspect live announcements; check 320px/reflow and touch on a representative device. Do not claim WCAG compliance from these tests alone. |

For reusable evidence: test the reported data shape and user outcome, not only an isolated helper. A green fixture proves the rendered scenario it exercised; production behavior, real storage and provider acceptance need their own evidence under the gates above. Record each next gap as `expected behavior | evidence/status | gap | bounded fix | regression/acceptance result`; leave unknowns open rather than inventing defects.

[notifications]: https://www.carbondesignsystem.com/building-blocks/core/patterns/notifications
[loading]: https://www.carbondesignsystem.com/building-blocks/core/patterns/loading
[empty]: https://www.carbondesignsystem.com/building-blocks/core/patterns/empty-states
[actions]: https://www.carbondesignsystem.com/building-blocks/core/patterns/common-actions
[heuristics]: https://www.nngroup.com/articles/ten-usability-heuristics/
[validation]: https://design-system.service.gov.uk/patterns/validation/
[a11y]: https://www.a11yproject.com/checklist/
[status]: https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html
