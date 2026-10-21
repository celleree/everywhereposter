# Video Editor design review — prototype checkpoint

This is a runnable, isolated design prototype, not the implemented or live app. It has no backend client, account access, uploads, rendering, persistence, publishing, or production route. It imports the existing app Button and shared light/dark theme tokens; the editor, picker choice and composer views are proposed presentation using fixtures. Other navigation labels are context, not working app links.

## Run and verify

From `postiz-app/`, with Node 22.12–22.x and pinned pnpm 10.6.1:

```sh
pnpm exec vite --config tests/design-preview/vite.config.ts
# In another terminal, with a locally installed Chromium:
EP_PREVIEW_CHROMIUM=/usr/bin/chromium node tests/design-preview/check.cjs
pnpm exec tsc -p tests/design-preview/tsconfig.json
pnpm exec vite build --config tests/design-preview/vite.config.ts
```

Open `http://127.0.0.1:4317`. Select a state in the prototype bar, or use `?state=review`. Complete the flow: choose fixture video → prepare → cut/restore → save a separate fixture copy → open preview composer → attach to preview draft. Upload selects only a filename; file bytes are not read or sent. Source and output are fixture identities; no MP4 is edited. The video control plays the repository's synthetic color fixture, with a generated fictional-creator poster. The sample transcript is fictional and is not an ASR result. Reload selects the URL state and resets fixture edits; actual session recovery is not implemented in this prototype.

States: empty, selected, uploading, preparing, review, no-blocks, load-error, expired, uncertain-save, saving, saved, composer, attached. Busy views selected directly remain stable for visual review. The ordinary journey uses short, simulated waits. “Check sample Media Library” resolves to a fixture saved result, not a real library.

## Verified baseline and selected slice

- Started clean from remote main `776fc26c85871bdaf846b1a39178cec9b2fde02e` on `feature/video-review-preview`; repository START/branch provenance checks passed. No checkout `.agents/skills` or nested AGENTS files exist. `/workspace/.agents` is empty. Local WSL-only doctor is inapplicable to this explicitly selected cloud checkout.
- `/video-editor` uses `VideoEditorWorkspace`: `/media/cooked/status` selects Cooked when enabled, otherwise the standard editor, including when availability fails. This preview does not change that decision or any flag.
- Actual Cooked UI already offers MediaBox upload/library selection, deliberate preparation, eligible whole-block cut/restore in its pinned native iframe, recoverable request identity, revision-checked save to a separate media item, download and `AddEditModal` handoff using the confirmed saved media ID/path. Original replacement is not part of the flow.
- Cooked limits in current UI: English speech, MP4/MOV with audio, 4 minutes, 100 MiB, 720p, 30 fps, aligned constant-frame-rate A/V, 15 idle minutes. Standard fallback: automatic pause trimming, up to 60 seconds/100 MB. No arbitrary word, filler-word, chat, timeline or style editing is promised.
- The selected preview improves the understandable path through those capabilities: four-step orientation, source identity, speech-block context, distinct current/saved revision, one next action, preserved-original reassurance, and a separate composer draft. It proposes no new backend capability.
- Preserved outside scope: PR250 original-media repair; MCP OAuth; billing; landing repository; image/carousel features; auth, permissions, flags and all production operations.

## Direction to review

The existing monochrome identity, logo and restrained cyan accent remain. Soft neutral surfaces, readable hierarchy, generous spacing, warm example footage and fine separators create an original, calm workspace inspired by the care of Apple interfaces. Status color is limited to confirmed success and actionable recovery. Desktop pairs the preview with a scrollable block list. Mobile stacks panels, keeps controls at least 44px tall and shows a compact next action above safe-area navigation. Motion respects reduced-motion preferences. Native video controls remain honest controls for a real synthetic clip.

This is one light-theme direction. Dark theme, every remaining app screen, real platform previews, and all permissions/role variants have not been designed. Inventory below distinguishes mapped surfaces from previewed ones.

## State/screen inventory

| Surface / code owner | Important states to design or verify | Coverage at this checkpoint |
| --- | --- | --- |
| App shell / `layout/top.menu.tsx`, `mobile-ui.scss` | desktop navigation, mobile tabs/More, workspace switch, small viewport, selected item, slow route | Proposed static editor shell only; other labels are noninteractive. Agent/Audit/billing and secondary destinations still need a complete navigation review. |
| Video selection / `media/media.component.tsx` | empty library, populated, type filter, selection count, upload/resume/cancel, unavailable file, loading/error | Empty/selected/uploading/editor validation presentation previewed; full existing MediaBox picker is **not** redesigned. |
| Cooked review / `video-editor/cooked-review.workspace.tsx`, `cooked-review-html.ts` | prepare, busy, current revision, cut, restore, compare, no eligible blocks, failed receipt, recovery, expired | Main review, cut/restore, no-blocks, loading/error/expired, saving/uncertain/success previewed. Compare/native iframe and true request recovery remain implementation design gaps. |
| Standard fallback / `video-editor/video-editor.workspace.tsx` | automatic pause trim, pacing, pending, uncertain result, rejected input, retry, preview error | Read-only mapped, limits disclosed; **not visually redesigned**. |
| Save/handoff / same workspace + `new-launch/add.edit.modal.tsx` | current/saved revision, delayed/uncertain save, repeat click, deleted output, missing channels, handoff failure | Fixture saved/stale revision, uncertain-save, composer/attached previewed; real save/download/media ownership/account checks remain existing app behavior, unverified here. |
| Create/Upload / `create/create.component.tsx`, `guided.composer.shell.tsx` | media/text source, no accounts, saved sets, details, account selection, generation progress/retry, per-platform review, final schedule/publish | Runtime path mapped; editor-specific composer concept only. AI images and carousel surfaces retained, **not designed or removed**. |
| Calendar / `launches/launches.component.tsx`, `mobile-posts.tsx` | desktop calendar, mobile dated list, scheduled/all, recurring roots, empty/loading/retry, detail/edit, publish failure | Components inspected; mobile code has real loading/error/empty states. **No new visual preview yet**. Imported/historical posts remain read-only. |
| Channels / `launches/add.provider.component.tsx`, channel catalog | none connected, active, disabled/reconnect, multi-account, in-progress connection, error, detail | Menu/composer entry points mapped; **not redesigned**. No OAuth or permission changes. |
| Media / `new-layout/layout.media.component.tsx`, `media.component.tsx` | Library/Posted tabs, search/pagination, image/video, upload/resume, delete confirmation, unsupported/failed playback, posted/connected media | Route and tab owner verified. **No full-screen design yet**; PR250 remains separate. |
| Analytics / `platform-analytics/platform.analytics.tsx` | platform/account selection, missing data vs zero, loading/error, empty, historical series, video grid/Business Discovery | Route mapped; **not visually designed or data-verified**. No invented statistics. |
| Settings / `layout/settings.component.tsx`, `settings/global.settings.tsx` | global/calendar/email/shortlink, profile, team, webhooks, autopost, API, approved apps, knowledge base, role-gated tabs | Tab owners/conditional entries inspected; **not redesigned**. Secrets/access changes excluded. |
| Agent / `agents`, `/agents/[id]` | new conversation, history, streaming, interruption/retry, tool approval, errors | Route mapped; `/agents` redirects to `/agents/new`. **Not designed or runtime-verified**. |
| Creator Audit / `creator-audit/creator-audit.tsx` | disabled, org switch, integration select, running/done/error/paused, resumable, unauthorized role | State types/availability entry inspected; **not designed or activated**. |
| Third-party / `/third-party`, `/plugs` | list/empty/loading/error, installed, unavailable integration, detail | Route/component owner mapped; **not designed or operated**. |
| Auth/account / `/auth/*`, `/oauth/authorize`, social callbacks | login/register/activate/reset, validation, expired links, pending/error/success, login-required | Routes mapped only. **Not designed or changed**; OAuth repair stays separate. |
| Billing / `/billing`, `/billing/lifetime` | existing plan/empty/loading/error, intended entitlement display | Routes mapped only; all behavior/copy/config changes excluded. |
| Shared/error/public preview / `/err`, `/p/[id]`, extension modal | unknown route, unavailable/deleted content, read-only post, copy/share feedback | Routes mapped; **not visually designed**. Notifications, modal stacks and cross-app search need a later inventory pass. |

This route-led inventory is not a claim that every nested dialog/provider/role variant has been exhaustively audited. The next design tranche after user feedback should cover full MediaBox selection and native comparison/recovery, then Create/Calendar/Channels. Secondary and sensitive surfaces should follow separate bounded reviews.

## Verification limits and blockers

The checks exercise the isolated prototype at desktop 1440×1000, iPhone SE dimensions 320×568 in Chromium, Pixel 7 412×839 in Chromium, narrow 320×740 and landscape 844×390. They test all 13 states, no horizontal overflow, reachable primary actions, cut/restore with keyboard, duplicate busy clicks, stale saved revision, caption/account editing, upload simulation, reload visibility and uncertain-save recovery. They assert no backend/external request and no storage persistence. This does not verify editing, durable saving, authentication, real iOS Safari or publishing.

- Baseline native review screenshots were captured from the actual hash-pinned merged native HTML plus current adapter, using synthetic state/media. They show the embedded review only, not the full app shell. Full original-app before screenshots: blocked before browser assertions. Existing isolated Next harness could not compile because `@prisma/client/.prisma/client/index-browser` was absent. `prisma generate` then failed retrieving the pinned engine checksum from `binaries.prisma.sh` with HTTP403. No checksum bypass or alternate engine source was used.
- Native Playwright browser download: `cdn.playwright.dev` returned HTTP403 “Domain forbidden”. No retry via an alternate domain was made. Preinstalled `/usr/bin/chromium` is used; actual WebKit/iPhone testing must run in another approved environment.
- Repository lint invocation fails before examining files: existing ESLint/Next config circular JSON error in `@eslint/eslintrc` FlatCompat. A narrow prototype-only config is used for relevant checks; production lint configuration is unchanged.
- Full Next production build and integrated backend flow remain unverified due the missing generated Prisma client. Only the isolated prototype build/type check pass claim applies.
- Repository independent review and matching required CI remain merge gates; this is an unmerged draft preview for design feedback. Historical review-runner `invalid_refresh_token` was supplied in the task context; credentials were not inspected or repaired here.

## Assets

`portrait.png` is an imagegen-created fictional creator solely for the preview. Existing `tests/browser/assets/synthetic-picker.mp4`, app logo, Button and theme remain at their original paths. The portrait is not original customer media or evidence of actual speech editing.
