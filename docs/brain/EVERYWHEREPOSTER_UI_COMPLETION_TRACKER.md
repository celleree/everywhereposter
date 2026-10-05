# EverywherePoster UI completion tracker

The coordinator is the sole write-owner. Acceptance remains in `EVERYWHEREPOSTER_UI_IMPROVEMENTS.md`; this tracker does not replace or change it. Each canonical bullet, its heading context and source line, and all 33 DoD items are indexed below. Paragraph context and later decisions in the complete contract remain binding.

## Verified baseline and ownership

- Canonical revision: Git blob `46a4a3e054c7606099f69242b2cdd2f97c024159` at main `9efa0f6184b21d29a81a18753a6570f7c1db6ab1` (PR #143 merge).
- Main checkout: `/home/arund/dev/everywhereposter`, clean on current `main`; native guardrail installation and repository-state check passed.
- PR #142 merged: implementation `beba83167f4dee19b47a214f000a71e678bf298f`, merge `312c976d326f616d45fb8a9dd55742d9f6deee07`. Preserve useful implementation.
- PR #136 open: `fix/mobile-scheduled-upload-channels`, HEAD `69cb8374ceafa1a0030d63b79a6955047ed34ac5`. Quality and Docker gate CI failed. Reserve its affected Create/Calendar/channel-menu/customer-filter paths pending ownership/disposition reconciliation; no adoption, closure or merge authorized.
- Coordinator worktree: `/home/arund/dev/everywhereposter-ui-tracker`, branch `codex/ui-program-tracker`, base `9efa0f6184b21d29a81a18753a6570f7c1db6ab1`; exact checkpoint commit is discoverable with `git log -1 -- docs/brain/EVERYWHEREPOSTER_UI_COMPLETION_TRACKER.md` (avoid self-referential SHAs).
- Read-only workers: `requirements_map` (Luna/Medium), `persistence_discovery` (Sol/High), `browser_readiness` (Luna/Medium). No implementation file ownership assigned yet.
- Shell, Git, GitHub CLI, Node v22.23.2, pnpm 10.6.1, agent-browser 0.27.0 available. Browser engine under verification; local Ollama availability not established. Primary model is inherited from this chat; no runtime model switch claimed.
- Secondary raw review successfully fetched through connected Google Drive: document `1Kbs-9rSx4a6-Z6wb8MsGYflsCssxA6k7IpXBHV-KzNI`; supporting context only.
- Windows-mounted historical checkout is preserved; no further changes allowed there.

## Status and evidence rules

Allowed implementation statuses: NOT STARTED / IN PROGRESS / IMPLEMENTED / VERIFIED / BLOCKED. VERIFIED requires relevant automated and direct browser evidence; compiled code or DOM-only assertions are insufficient. Missing evidence remains incomplete. All scoped work excludes production data, live publishing/scheduling, dependencies, schema/permission changes, and Analytics redesign.

Review, merge, deployment and production verification are separate: no merge or deployment authorization for this program. CI on other SHAs does not verify this branch. Most-recent main action runs returned by GitHub were on an older SHA; current main CI proof is not established by those runs.

Evidence references below use E0 until discovery completes: baseline identities and local guardrails only; no requirement-level runtime verification. F0 means ownership/current behavior still being mapped. Every requirement has an independent row so later batching cannot drop acceptance details.

## Batch contracts / dependencies

| Batch | Priority / owned surface | Status | Findings / exclusions / next action |
| --- | --- | --- | --- |
| D | Section 8, DoD18–20; composer state lifecycle | IN PROGRESS | Confirmed code paths: modal unmount resets launch store; guided shell unmount resets guided store; both are memory-only. Provider form values need investigation too. Reproduce loss, map scope/media recovery, then define smallest coherent fix. |
| U | Upload/picker/previews, DoD1–5 | NOT STARTED | Wait for mapping; preserve Original context/Caption options. |
| A | Account density/responsiveness, DoD6–7 | NOT STARTED | Reserve #136 channel-management overlap. |
| P | Meaningful processing stages, DoD8 | NOT STARTED | Use only actual exposed pipeline state; no invented percentages. |
| R | Review/caption/destination/comments/settings/publish placement, DoD9–17 | NOT STARTED | Shared state/navigation ownership serialized; retain all publishing safeguards. |
| C | Calendar, DoD21 | BLOCKED | #136 actual overlap must be reconciled before writes; newer canonical contract removes entire Channels block. |
| M | Main Media, DoD22–26 | NOT STARTED | Preserve working Posted Media; inspect missing library content separately. |
| N | More, DoD27 | NOT STARTED | Preserve menu layout and Add Channel/link. |
| G | Agent, DoD28–31 | NOT STARTED | Independent surface subject to shared CSS overlap review. |
| S | Analytics/KEEP, DoD32–33 | IN PROGRESS | No Analytics edits; audit actual diffs and KEEP behavior per batch. |

## Canonical sections

| Source section | Batch | Coordinator/worker owner | Status | Affected files / commit / PR | Automated / browser evidence | Findings/dependencies / next action |
| --- | --- | --- | --- | --- | --- | --- |
| S1: Upload — First Page / Media Library Picker | U: Upload/picker | coordinator; discovery workers read-only | NOT STARTED | F0; no implementation commit/PR | E0 / none | Map owning components; section 1 full wording governs. |
| S2: Upload — Choose Accounts | A: Accounts | coordinator; discovery workers read-only | NOT STARTED | F0; no implementation commit/PR | E0 / none | Map owning components; section 2 full wording governs. |
| S3: Processing State | P: Processing | coordinator; discovery workers read-only | NOT STARTED | F0; no implementation commit/PR | E0 / none | Map owning components; section 3 full wording governs. |
| S4: Upload — Main Review/Edit Page | R: Review | coordinator; discovery workers read-only | NOT STARTED | F0; no implementation commit/PR | E0 / none | Map owning components; section 4 full wording governs. |
| S5: Caption UI Simplification | R: Review | coordinator; discovery workers read-only | NOT STARTED | F0; no implementation commit/PR | E0 / none | Map owning components; section 5 full wording governs. |
| S6: Platform Comments/Posts + Advanced Settings | R: Review | coordinator; discovery workers read-only | NOT STARTED | F0; no implementation commit/PR | E0 / none | Map owning components; section 6 full wording governs. |
| S7: Remove the Final Confirmation Page | R: Review | coordinator; discovery workers read-only | NOT STARTED | F0; no implementation commit/PR | E0 / none | Map owning components; section 7 full wording governs. |
| S8: Composer State Persistence — HIGH PRIORITY | D: Persistence | coordinator; discovery workers read-only | IN PROGRESS | F0; no implementation commit/PR | E0 / none | Map owning components; section 8 full wording governs. |
| S9: Calendar / Scheduled Page | C: Calendar | coordinator; discovery workers read-only | BLOCKED | F0; no implementation commit/PR | E0 / none | Map owning components; section 9 full wording governs. |
| S10: Main Media Page | M: Main Media | coordinator; discovery workers read-only | NOT STARTED | F0; no implementation commit/PR | E0 / none | Map owning components; section 10 full wording governs. |
| S11: More Tab / Menu | N: More | coordinator; discovery workers read-only | NOT STARTED | F0; no implementation commit/PR | E0 / none | Map owning components; section 11 full wording governs. |
| S12: Agent Page | G: Agent | coordinator; discovery workers read-only | NOT STARTED | F0; no implementation commit/PR | E0 / none | Map owning components; section 12 full wording governs. |
| S13: Analytics — OUT OF SCOPE | S: Scope guard | coordinator; discovery workers read-only | IN PROGRESS | F0; no implementation commit/PR | E0 / none | Map owning components; section 13 full wording governs. |

## Every canonical bullet

Child bullets retain the source heading and parent requirement context. Source line refers to the pinned canonical revision above. Do not reinterpret a KEEP or prohibition as permission to redesign it.

| ID / source line | Heading context / requirement | Batch / owner | Status | Files / commit / PR | Automated / browser evidence | Findings/dependencies / next action |
| --- | --- | --- | --- | --- | --- | --- |
| S1.01 / L12 | Remove unnecessary page movement: The initial Upload page can currently move/scroll slightly up and down even though its content does not require scrolling. | U: Upload/picker / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S1.02 / L13 | Remove unnecessary page movement: Eliminate that unnecessary layout/page scrolling. | U: Upload/picker / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S1.03 / L14 | Remove unnecessary page movement: The issue is the app content moving when there is no overflow; do not break normal native browser/OS behavior such as pull-to-refresh merely to solve it. | U: Upload/picker / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S1.04 / L17 | Lock and condense the Media Library: The Media Library can currently move freely up/down and left/right. It should not. | U: Upload/picker / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S1.05 / L18 | Lock and condense the Media Library: Lock the Media Library layout into the available viewport. | U: Upload/picker / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S1.06 / L19 | Lock and condense the Media Library: Use more of the available screen instead of leaving large amounts of empty space at the top. | U: Upload/picker / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S1.07 / L20 | Lock and condense the Media Library: Remove the `Posted Media` tab from this Upload-page media picker. | U: Upload/picker / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S1.08 / L21 | Lock and condense the Media Library: Remove the redundant `Media Library` tab/button from this picker. | U: Upload/picker / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S1.09 / L22 | Lock and condense the Media Library: Keep the useful `Upload` action. | U: Upload/picker / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S1.10 / L23 | Lock and condense the Media Library: Use the recovered space to show more media. | U: Upload/picker / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S1.11 / L26 | Grid and pagination: Make media items slightly smaller. | U: Upload/picker / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S1.12 / L27 | Grid and pagination: Use a 3-column grid. | U: Upload/picker / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S1.13 / L28 | Grid and pagination: Fit as much media as reasonably possible on one page. | U: Upload/picker / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S1.14 / L29 | Grid and pagination: Do not make users scroll through a long media grid. | U: Upload/picker / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S1.15 / L30 | Grid and pagination: Use additional paginated pages instead. | U: Upload/picker / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S1.16 / L31 | Grid and pagination: Existing Next Page pagination works well; preserve it. | U: Upload/picker / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S1.17 / L32 | Grid and pagination: Preserve the existing Upload tile/action that appears when appropriate. | U: Upload/picker / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S1.18 / L35 | Media preview: Users should still be able to deliberately tap media to preview it full-screen. | U: Upload/picker / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S1.19 / L36 | Media preview: Current photo and video preview behavior can overflow beyond the viewport. | U: Upload/picker / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S1.20 / L37 | Media preview: The user can currently be forced to scroll sideways just to reach the X/close control. | U: Upload/picker / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S1.21 / L38 | Media preview: Fix both photo and video preview layouts so: | U: Upload/picker / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S1.22 / L39 | Media preview: the preview stays within the viewport; | U: Upload/picker / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S1.23 / L40 | Media preview: its relevant information/controls fit on that screen; | U: Upload/picker / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S1.24 / L41 | Media preview: no horizontal scrolling is required; | U: Upload/picker / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S1.25 / L42 | Media preview: no unnecessary vertical scrolling is required; | U: Upload/picker / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S1.26 / L43 | Media preview: the X/close control is always immediately visible and reachable. | U: Upload/picker / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S1.27 / L44 | Media preview: The general concept of a full-screen video player is fine. | U: Upload/picker / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S1.28 / L47 | Media-selection bugs: BUG: `Add selected media` can automatically open and play the selected video. | U: Upload/picker / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S1.29 / L48 | Media-selection bugs: Adding selected media should **only attach it**. | U: Upload/picker / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S1.30 / L49 | Media-selection bugs: Opening/playing media should require a separate deliberate preview action. | U: Upload/picker / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S1.31 / L50 | Media-selection bugs: BUG: media/video can also reopen without the user intentionally opening it. Fix this. | U: Upload/picker / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S1.32 / L53 | Attached-media info: Remove the redundant right-side text such as `1 asset attached`. | U: Upload/picker / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S1.33 / L56 | KEEP: `Original context` is fine. | U: Upload/picker / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S1.34 / L57 | KEEP: `Caption options` are good as-is. | U: Upload/picker / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S1.35 / L58 | KEEP: Caption Options scrolling feels slightly odd, but the user explicitly considered it acceptable. Do not redesign this area solely because of that. | U: Upload/picker / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S2.01 / L66 | Header: `Choose accounts` | A: Accounts / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S2.02 / L67 | Header: dynamic selection count such as `0 of 6 accounts selected` | A: Accounts / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S2.03 / L70 | Header: `Choose the platforms and connect` | A: Accounts / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S2.04 / L73 | Selection behavior: Preserve the selected-account count; it works. | A: Accounts / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S2.05 / L74 | Selection behavior: BUG/PERFORMANCE: account deselection can take a very long time. | A: Accounts / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S2.06 / L75 | Selection behavior: Selection and deselection should respond promptly. | A: Accounts / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S2.07 / L78 | Account density: Make each account entry/card more compact. | A: Accounts / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S2.08 / L79 | Account density: Fit more accounts into the visible page. | A: Accounts / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S2.09 / L80 | Account density: Reduce how much vertical scrolling is required. | A: Accounts / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S2.10 / L81 | Account density: This must remain usable for customers with substantially more connected accounts than the current test account. | A: Accounts / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S2.11 / L82 | Account density: Preserve the useful account/network/platform identification that currently tells the user what/where each account is. | A: Accounts / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S3.01 / L91 | : add a loading/progress indicator and/or changing status text; | P: Processing / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S3.02 / L92 | : update it according to what the system is actually doing; | P: Processing / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S3.03 / L93 | : let the user see meaningful progression rather than staring at an unexplained processing screen. | P: Processing / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S4.01 / L105 | Remove top summary bars: `Destinations selected` | R: Review / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S4.02 / L106 | Remove top summary bars: `Ready` | R: Review / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S4.03 / L107 | Remove top summary bars: `Needs attention` | R: Review / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S4.04 / L113 | KEEP: the `No spoken dialogue was detected` warning; | R: Review / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S4.05 / L114 | KEEP: Media Preview; | R: Review / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S4.06 / L115 | KEEP: the Destinations selector; | R: Review / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S4.07 / L116 | KEEP: the ability to tap/switch between destinations. | R: Review / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S4.08 / L122 | Destination scroller — minor/non-blocking polish: destination content disappears behind an inset/border before reaching the apparent visual end; | R: Review / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S4.09 / L123 | Destination scroller — minor/non-blocking polish: ideally it should scroll all the way to the visible end of the line and then clip cleanly on both sides. | R: Review / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S5.01 / L134 | : selected account/person + platform label repeated again there; | R: Review / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S5.02 / L135 | : `Disable destination`; | R: Review / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S5.03 / L136 | : `AI generated`; | R: Review / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S5.04 / L137 | : separate character-count area; | R: Review / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S5.05 / L138 | : Reset; | R: Review / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S5.06 / L139 | : Regenerate; | R: Review / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S5.07 / L140 | : the surrounding redundant container/box. | R: Review / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S5.08 / L146 | Final caption UI: `Caption` header; | R: Review / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S5.09 / L147 | Final caption UI: caption text box; | R: Review / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S5.10 / L148 | Final caption UI: character count **inside** the caption box. | R: Review / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S6.01 / L162 | Single destination selector: Caption; | R: Review / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S6.02 / L163 | Single destination selector: Platform Comments/Posts; | R: Review / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S6.03 / L164 | Single destination selector: Advanced Settings. | R: Review / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S6.04 / L175 | Remove duplicate/version navigation: `Review versions`; | R: Review / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S6.05 / L176 | Remove duplicate/version navigation: `Global version` selector/card; | R: Review / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S6.06 / L177 | Remove duplicate/version navigation: duplicate individual-platform/network scrolling boxes; | R: Review / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S6.07 / L178 | Remove duplicate/version navigation: the second destination/network selector; | R: Review / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S6.08 / L179 | Remove duplicate/version navigation: `Editing a specific Network`; | R: Review / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S6.09 / L180 | Remove duplicate/version navigation: `Back to Global`. | R: Review / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S6.10 / L183 | Destination-switching bug: BUG: switching/clicking a different account/network in this lower area currently opens the video. | R: Review / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S6.11 / L184 | Destination-switching bug: Changing destinations/networks must **not** open or play the media. | R: Review / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S6.12 / L185 | Destination-switching bug: Media preview should open only when the user explicitly asks to preview media. | R: Review / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S6.13 / L191 | Platform Comments: the actual Platform Comment content/input; | R: Review / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S6.14 / L192 | Platform Comments: a Delete control for removing an existing comment; | R: Review / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S6.15 / L193 | Platform Comments: the lower `Add platform comment` action so a user can add another comment. | R: Review / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S6.16 / L196 | Platform Comments: image references; | R: Review / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S6.17 / L197 | Platform Comments: Generate Post(s); | R: Review / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S6.18 / L198 | Platform Comments: Generate Carousel; | R: Review / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S6.19 / L199 | Platform Comments: signature controls; | R: Review / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S6.20 / L200 | Platform Comments: underline; | R: Review / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S6.21 / L201 | Platform Comments: bold; | R: Review / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S6.22 / L202 | Platform Comments: other tiny formatting/generation UI serving the same cluttered auxiliary role. | R: Review / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S6.23 / L207 | Advanced Settings: Advanced Settings should be part of this same destination-specific flow. | R: Review / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S6.24 / L208 | Advanced Settings: It must respond to the single Destinations selector above. | R: Review / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S6.25 / L209 | Advanced Settings: Do not create or retain another Advanced-Settings-specific network selector. | R: Review / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S7.01 / L217 | : Remove that final confirmation step/page. | R: Review / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S7.02 / L218 | : Bring `Post` / `Schedule` controls back into the main review/edit page. | R: Review / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S7.03 / L219 | : The user should be able to finish the workflow from that page without advancing into a redundant confirmation page. | R: Review / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S8.01 / L226 | : the user navigated from the composer to Schedule; | D: Persistence / coordinator | IN PROGRESS | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S8.02 / L227 | : returned to Upload; | D: Persistence / coordinator | IN PROGRESS | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S8.03 / L228 | : all composer work was gone. | D: Persistence / coordinator | IN PROGRESS | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S8.04 / L234 | Required persistence: navigating to another EverywherePoster menu/page and returning; | D: Persistence / coordinator | IN PROGRESS | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S8.05 / L235 | Required persistence: reloading the page; | D: Persistence / coordinator | IN PROGRESS | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S8.06 / L236 | Required persistence: accidentally closing/leaving the app/page and reopening it within a reasonable short recovery window. | D: Persistence / coordinator | IN PROGRESS | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S8.07 / L241 | Expiration: Immediate state destruction is unacceptable. | D: Persistence / coordinator | IN PROGRESS | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S8.08 / L242 | Expiration: If temporary composer state needs an expiration, losing it after roughly **30 minutes away** was considered acceptable. | D: Persistence / coordinator | IN PROGRESS | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S8.09 / L243 | Expiration: A 30-minute expiry is therefore an acceptable fallback/limit, **not a requirement to deliberately delete state at 30 minutes if longer persistence is safe and appropriate**. | D: Persistence / coordinator | IN PROGRESS | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S8.10 / L246 | Data-loss behavior: Routine internal navigation or reload should preserve the work. | D: Persistence / coordinator | IN PROGRESS | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S8.11 / L247 | Data-loss behavior: Do not silently discard substantial composer progress. | D: Persistence / coordinator | IN PROGRESS | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S8.12 / L248 | Data-loss behavior: If some action genuinely cannot preserve state and would destroy it, warn the user **before** the destructive transition. | D: Persistence / coordinator | IN PROGRESS | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S8.13 / L249 | Data-loss behavior: Persistence is preferred over relying on warnings. | D: Persistence / coordinator | IN PROGRESS | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S9.01 / L258 | : `Channels` heading; | C: Calendar / coordinator | BLOCKED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S9.02 / L259 | : `Add Channel`; | C: Calendar / coordinator | BLOCKED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S9.03 / L260 | : the link button/icon beside Add Channel; | C: Calendar / coordinator | BLOCKED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S9.04 / L261 | : `Create Post`; | C: Calendar / coordinator | BLOCKED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S9.05 / L262 | : the connected-account/channel list beneath it. | C: Calendar / coordinator | BLOCKED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S9.06 / L265 | : move the `Scheduled` / `All Posts` tabs upward to the top; | C: Calendar / coordinator | BLOCKED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S9.07 / L266 | : retain those two tabs as the primary top navigation. | C: Calendar / coordinator | BLOCKED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S10.01 / L277 | Top layout: There is too much wasted space at the top. | M: Main Media / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S10.02 / L278 | Top layout: Reuse the clean tab treatment already used on Scheduled. | M: Main Media / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S10.03 / L279 | Top layout: Put these two tabs at the top: | M: Main Media / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S10.04 / L280 | Top layout: `Media Library` | M: Main Media / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S10.05 / L281 | Top layout: `Posted Media` | M: Main Media / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S10.06 / L284 | Media Library bug: BUG: Media Library content is not appearing. | M: Main Media / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S10.07 / L285 | Media Library bug: Fix it so the Media Library actually displays its content. | M: Main Media / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S10.08 / L291 | Posted Media: do not treat Posted Media as a missing-content bug; | M: Main Media / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S10.09 / L292 | Posted Media: preserve its working media display. | M: Main Media / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S10.10 / L297 | Connected-platform/channel list: Condense the connected-account/channel list substantially. | M: Main Media / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S10.11 / L298 | Connected-platform/channel list: Expect users to have even more connected accounts in the future. | M: Main Media / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S10.12 / L299 | Connected-platform/channel list: Selecting a channel should allow the user to see that channel's media without having to scroll far down the page first. | M: Main Media / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S10.13 / L300 | Connected-platform/channel list: The account selector must not dominate the screen. | M: Main Media / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S10.14 / L303 | Connected platform videos: Keep the `Connected platform videos` heading. | M: Main Media / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S10.15 / L304 | Connected platform videos: Remove its unnecessary explanatory subtext because the heading is already self-explanatory. | M: Main Media / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S11.01 / L311 | KEEP: Keep `Add Channel`. | N: More / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S11.02 / L312 | KEEP: Keep its link affordance/icon. | N: More / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S11.03 / L313 | KEEP: Preserve the popup/menu's overall layout; the user explicitly liked it. | N: More / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S11.04 / L316 | Fix spacing: The Add Channel area/button currently extends too close/all the way to the edge of the screen. | N: More / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S11.05 / L317 | Fix spacing: Give it the same consistent inset/border treatment used elsewhere in the UI. | N: More / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S11.06 / L320 | Fix menu border/radius: The popup/menu should have clean rounded top corners. | N: More / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S11.07 / L321 | Fix menu border/radius: It may technically already have rounding, but the current border/overlap makes it appear incorrect. | N: More / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S11.08 / L322 | Fix menu border/radius: Fix the overlapping/incorrect top-border treatment. | N: More / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S11.09 / L325 | Remove redundant title: Remove the `More` title/header inside this view/menu. | N: More / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S11.10 / L326 | Remove redundant title: It is unnecessary because the user's location is already clear. | N: More / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S11.11 / L329 | Close button: Make the X/close icon somewhat larger and easier to use. | N: More / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S12.01 / L338 | Lock the page; scroll the conversation: The overall Agent page should stay locked in place when its layout fits the viewport. | G: Agent / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S12.02 / L339 | Lock the page; scroll the conversation: Chat history should remain scrollable. | G: Agent / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S12.03 / L340 | Lock the page; scroll the conversation: Scrolling chat history must not move the input/composer. | G: Agent / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S12.04 / L341 | Lock the page; scroll the conversation: The chat input/composer should remain fixed in place. | G: Agent / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S12.05 / L344 | Simplify the bottom area: Remove the unnecessary auxiliary buttons around the bottom/input area. | G: Agent / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S12.06 / L345 | Simplify the bottom area: Remove the unnecessary divider/line directly above the chat box. | G: Agent / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S12.07 / L346 | Simplify the bottom area: Keep the chat box itself. | G: Agent / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S12.08 / L347 | Simplify the bottom area: Preserve essential send/stop functionality described below. | G: Agent / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S12.09 / L350 | Input-focus zoom/layout bug: BUG: focusing/tapping into the chat box currently zooms the page and breaks the layout. | G: Agent / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S12.10 / L351 | Input-focus zoom/layout bug: Prevent that unwanted zoom/layout shift. | G: Agent / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S12.11 / L352 | Input-focus zoom/layout bug: Closing/unfocusing the input must not leave the UI displaced. | G: Agent / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S12.12 / L353 | Input-focus zoom/layout bug: The layout should return/remain in its correct position. | G: Agent / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S12.13 / L356 | First-message spacing bug: BUG: the **first sent user message** has incorrect spacing. | G: Agent / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S12.14 / L357 | First-message spacing bug: Its message bubble/text sits almost against the lower reaction/action icons, particularly the thumbs-down icon. | G: Agent / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S12.15 / L358 | First-message spacing bug: Later sent messages have correct spacing. | G: Agent / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S12.16 / L359 | First-message spacing bug: Make the first message use the same appropriate spacing as subsequent messages. | G: Agent / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S12.17 / L364 | Stop button: Keep the square stop symbol. | G: Agent / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S12.18 / L365 | Stop button: Put it inside a clear **white circular button/background** so its purpose/control boundary is obvious. | G: Agent / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S12.19 / L368 | Send button: Put the Send arrow inside a matching clear **white circular button/background** so it is easy to see. | G: Agent / coordinator | NOT STARTED | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S13.01 / L376 | : Do **not** attempt to infer or implement an Analytics redesign from this document. | S: Scope guard / coordinator | IN PROGRESS | F0 / none / none | E0 / none | Discovery; follow complete section context. |
| S13.02 / L377 | : Handle Analytics in a separate review/batch later. | S: Scope guard / coordinator | IN PROGRESS | F0 / none / none | E0 / none | Discovery; follow complete section context. |

## Definition of Done 1–33

PASS / FAIL / NOT PROVEN is a separate audit result. Current NOT PROVEN is explicit missing runtime evidence, not a pass or waived requirement.

| DoD / source line | Exact check | Batch / owner | Status / audit result | Files / commit / PR | Automated / browser evidence | Findings/dependencies / next action |
| --- | --- | --- | --- | --- | --- | --- |
| DoD1 / L389 | Initial Upload page no longer has unintended app-layout scrolling when its content fits. | U: Upload/picker / coordinator | NOT STARTED / NOT PROVEN | F0 / none / none | E0 / none | Reproduce and verify before PASS. |
| DoD2 / L390 | Upload Media Library is locked to the viewport, uses the intended condensed 3-column/paginated presentation, and does not drift horizontally/vertically. | U: Upload/picker / coordinator | NOT STARTED / NOT PROVEN | F0 / none / none | E0 / none | Reproduce and verify before PASS. |
| DoD3 / L391 | Photo and video previews never require horizontal scrolling to reach controls or the X. | U: Upload/picker / coordinator | NOT STARTED / NOT PROVEN | F0 / none / none | E0 / none | Reproduce and verify before PASS. |
| DoD4 / L392 | Adding selected media does not auto-open or auto-play it. | U: Upload/picker / coordinator | NOT STARTED / NOT PROVEN | F0 / none / none | E0 / none | Reproduce and verify before PASS. |
| DoD5 / L393 | Media does not spontaneously reopen. | U: Upload/picker / coordinator | NOT STARTED / NOT PROVEN | F0 / none / none | E0 / none | Reproduce and verify before PASS. |
| DoD6 / L394 | Choose Accounts has the simplified header/count and selection/deselection is responsive. | A: Accounts / coordinator | NOT STARTED / NOT PROVEN | F0 / none / none | E0 / none | Reproduce and verify before PASS. |
| DoD7 / L395 | Account cards are condensed without removing useful account/platform identification. | A: Accounts / coordinator | NOT STARTED / NOT PROVEN | F0 / none / none | E0 / none | Reproduce and verify before PASS. |
| DoD8 / L396 | Processing state exposes meaningful progress when real pipeline state allows it. | P: Processing / coordinator | NOT STARTED / NOT PROVEN | F0 / none / none | E0 / none | Reproduce and verify before PASS. |
| DoD9 / L397 | The three top review summary bars are gone. | R: Review / coordinator | NOT STARTED / NOT PROVEN | F0 / none / none | E0 / none | Reproduce and verify before PASS. |
| DoD10 / L398 | Spoken-dialogue warning, Media Preview, and the good Destinations selector remain intact. | R: Review / coordinator | NOT STARTED / NOT PROVEN | F0 / none / none | E0 / none | Reproduce and verify before PASS. |
| DoD11 / L399 | Caption area is reduced to Caption header + editor + in-editor character count. | R: Review / coordinator | NOT STARTED / NOT PROVEN | F0 / none / none | E0 / none | Reproduce and verify before PASS. |
| DoD12 / L400 | Reset, Regenerate, Disable Destination, AI-generated label, duplicated account/platform header, and their redundant container are removed. | R: Review / coordinator | NOT STARTED / NOT PROVEN | F0 / none / none | E0 / none | Reproduce and verify before PASS. |
| DoD13 / L401 | There is only **one** destination selector for Caption + Platform Comments/Posts + Advanced Settings. | R: Review / coordinator | NOT STARTED / NOT PROVEN | F0 / none / none | E0 / none | Reproduce and verify before PASS. |
| DoD14 / L402 | Platform Comments/Posts and Advanced Settings are consolidated beneath/with that destination flow rather than maintaining a second version/network-navigation area. | R: Review / coordinator | NOT STARTED / NOT PROVEN | F0 / none / none | E0 / none | Reproduce and verify before PASS. |
| DoD15 / L403 | Switching destinations does not open/play media. | R: Review / coordinator | NOT STARTED / NOT PROVEN | F0 / none / none | E0 / none | Reproduce and verify before PASS. |
| DoD16 / L404 | Platform Comment UI contains the required comment content, Delete, and Add Platform Comment behavior without the removed auxiliary clutter. | R: Review / coordinator | NOT STARTED / NOT PROVEN | F0 / none / none | E0 / none | Reproduce and verify before PASS. |
| DoD17 / L405 | Final confirmation page is removed and Post/Schedule actions are available on the main review/edit page. | R: Review / coordinator | NOT STARTED / NOT PROVEN | F0 / none / none | E0 / none | Reproduce and verify before PASS. |
| DoD18 / L406 | Composer work survives internal navigation and return. | D: Persistence / coordinator | IN PROGRESS / NOT PROVEN | F0 / none / none | E0 / none | Reproduce and verify before PASS. |
| DoD19 / L407 | Composer work survives page reload. | D: Persistence / coordinator | IN PROGRESS / NOT PROVEN | F0 / none / none | E0 / none | Reproduce and verify before PASS. |
| DoD20 / L408 | Composer work survives a short accidental close/reopen recovery case rather than disappearing immediately. | D: Persistence / coordinator | IN PROGRESS / NOT PROVEN | F0 / none / none | E0 / none | Reproduce and verify before PASS. |
| DoD21 / L409 | Scheduled/Calendar no longer contains the Channels/Add Channel/link/Create Post/account-list block, and Scheduled/All Posts sit at the top. | C: Calendar / coordinator | BLOCKED / NOT PROVEN | F0 / none / none | E0 / none | Reproduce and verify before PASS. |
| DoD22 / L410 | Main Media page has top-level Media Library/Posted Media tabs in the Scheduled-style treatment. | M: Main Media / coordinator | NOT STARTED / NOT PROVEN | F0 / none / none | E0 / none | Reproduce and verify before PASS. |
| DoD23 / L411 | Media Library actually displays content. | M: Main Media / coordinator | NOT STARTED / NOT PROVEN | F0 / none / none | E0 / none | Reproduce and verify before PASS. |
| DoD24 / L412 | Existing working Posted Media behavior remains intact. | M: Main Media / coordinator | NOT STARTED / NOT PROVEN | F0 / none / none | E0 / none | Reproduce and verify before PASS. |
| DoD25 / L413 | Connected-platform selectors are condensed enough that they do not push selected media far down the screen. | M: Main Media / coordinator | NOT STARTED / NOT PROVEN | F0 / none / none | E0 / none | Reproduce and verify before PASS. |
| DoD26 / L414 | `Connected platform videos` remains while its redundant subtext is removed. | M: Main Media / coordinator | NOT STARTED / NOT PROVEN | F0 / none / none | E0 / none | Reproduce and verify before PASS. |
| DoD27 / L415 | More retains Add Channel/link/menu layout while fixing edge spacing, top rounding/border, redundant More title, and small X. | N: More / coordinator | NOT STARTED / NOT PROVEN | F0 / none / none | E0 / none | Reproduce and verify before PASS. |
| DoD28 / L416 | Agent outer page remains stable while chat history alone can scroll and the input stays fixed. | G: Agent / coordinator | NOT STARTED / NOT PROVEN | F0 / none / none | E0 / none | Reproduce and verify before PASS. |
| DoD29 / L417 | Agent input focus no longer causes destructive zoom/layout displacement. | G: Agent / coordinator | NOT STARTED / NOT PROVEN | F0 / none / none | E0 / none | Reproduce and verify before PASS. |
| DoD30 / L418 | The first sent message uses correct spacing around its reaction/action controls. | G: Agent / coordinator | NOT STARTED / NOT PROVEN | F0 / none / none | E0 / none | Reproduce and verify before PASS. |
| DoD31 / L419 | Send and Stop controls use the requested white circular backgrounds. | G: Agent / coordinator | NOT STARTED / NOT PROVEN | F0 / none / none | E0 / none | Reproduce and verify before PASS. |
| DoD32 / L420 | Analytics remains untouched by this batch. | S: Scope guard / coordinator | IN PROGRESS / NOT PROVEN | F0 / none / none | E0 / none | Reproduce and verify before PASS. |
| DoD33 / L421 | Components explicitly marked **KEEP** were not unnecessarily redesigned or broken. | S: Scope guard / coordinator | IN PROGRESS / NOT PROVEN | F0 / none / none | E0 / none | Reproduce and verify before PASS. |

## Resume / approval checkpoints

1. Reverify live main and relevant PR heads before assigning a worker; preserve changed or dirty worktrees.
2. Complete requirement mapping and early persistence reproduction; record bounded contract and exact file ownership.
3. Implement D first unless evidence establishes a prerequisite; explain that prerequisite here.
4. Run focused regression tests/typecheck plus navigation/reload/reopen/workspace separation in isolated browser fixtures.
5. Commit/push, establish matching CI, obtain fresh read-only independent exact-HEAD review, repair demonstrated findings.
6. Keep ready PRs awaiting human merge approval; continue only independent work from current main, without stacked branches.
7. Final audit rereads complete canonical contract, all DoD and KEEP/scope; missing proof remains incomplete. No overall completion claim now.
