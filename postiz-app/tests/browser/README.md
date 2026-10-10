# Isolated rendered UI tests

Run from `postiz-app` with the project's pnpm 10.6.1. Install the frozen lockfile and use its pinned Playwright CLI to install the required browser:

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install --with-deps chromium
pnpm run test:browser:ci
# Full suite also needs WebKit:
pnpm exec playwright install --with-deps webkit
pnpm run test:browser
pnpm exec playwright show-report browser-report
pnpm exec node tests/browser/runtime.cjs
```

The suite creates disposable authenticated browser contexts at `http://127.0.0.1:4217`. Do not add fixture cookies to an existing browser profile: localhost cookies are shared across ports. Inspect the captured screenshots, HTML report, and failure traces using `pnpm exec playwright show-trace <trace.zip>`. The standalone runtime command is for test debugging; stop it before running the suite, which owns both ports and refuses to reuse an existing server.

The test-only server binds 127.0.0.1:4217 (real frontend) and :4218 (synthetic API). It reserves both ports and waits for Next's listener before authenticated warm-up of login, Media, Scheduled, Create and Settings; existing servers and environment files cause refusal. It uses no database, media volume, real account, email, billing, social provider, migration or worker. An explicit synthetic cookie is accepted only by the disposable fixture API; production authentication code is unchanged. The fixture API rejects all mutations. Picker tests additionally fulfill one exact synthetic video transcription request inside their own browser routing; that response never reaches the API or a real service. Other browser mutations stay blocked. Automated Playwright contexts block external browser requests. An ordinary interactive browser does not have that routing guard. The frontend server environment is allowlisted; TCP connections are restricted to the two owned ports, with local Unix IPC allowed for Next workers.

For accurate logos the runtime temporarily links the checkout's committed `site/branding` assets into the frontend's public directory, then removes only that exact task-created symlink at shutdown. No original branding or media is copied or changed.

Playwright Test 1.58.2 is an explicitly approved exact devDependency, with the matching lockfile resolution. CI installs Chromium/system dependencies and the offline DejaVu font if absent, then runs three phone-Chromium smoke cases with one worker, zero retries and a 15-minute total bound including warm-up. It reuses the existing quality job, so the required Docker build aggregate fails when browser smoke fails. Reports, screenshots and traces are uploaded for seven days. Broader desktop/phone Chromium/WebKit coverage stays available through `test:browser`. If an owned local worktree uses a verified canonical node_modules symlink, never install packages through that symlink. See [`docs/browser-acceptance.md`](../../../docs/browser-acceptance.md) for the separate real-backend upload/save/reload and physical-phone acceptance record.

Named viewport/full-page screenshots and geometry JSON live under `browser-results`, with failure traces and an HTML report. Geometry attachments include the Git revision and a SHA-256 fingerprint of the suite, edited product sources and synthetic video bytes. Screenshots use an offline DejaVu font fixture and synthetic data: diagnostic artifacts, not accepted visual baselines or a qualitative design verdict. Chromium/WebKit phone presets emulate browsers; they do not test physical iPhone hardware or native iOS. Desktop scheduled rows are checked; loading/error/retry is currently exercised on the mobile implementation. Creator Audit route/iframe coverage is deferred because that integration is absent from current remote main. More navigation uses the existing Settings route. Mobile bottom navigation targets are measured against 44px; this is not an exhaustive accessibility audit. Repeated clicks are exercised; native touch gestures and mobile keyboards are not covered.

This batch starts from remote main `71e3885263a61ff2dea51ffbd8b3c977095253c2`. The official `scripts/start-change.sh` created its owned worker and recorded truthful branch-bound provenance before edits. Earlier unpublished Creator Audit pilot commits and the original reviewed UI worktree are preserved separately; this batch includes no Creator Audit integration or disposable-backend preparation.


The user also authorized a bounded UI repair: Scheduled removes its Channels sidebar on desktop/mobile, and the Upload Media Library picker has three-column viewport-sized pages, contained explicit previews and attachment without autoplay. Main Media tabs and More layout remain separate. The picker regression uses 22 synthetic assets across the existing API's 18-item server pages, including a one-second 160x120 H.264 fixture generated locally with ffmpeg (no real media). It checks forward/backward pagination, a partial final batch, repeat selection, keyboard focus in previews, video metadata and non-autoplay attachment, retry, short portrait/landscape, and Cancel preserving a text draft. Its viewport assertions deliberately do not scroll controls into view. Test pages hide only the Next.js development portal, which otherwise overlays short-phone controls; this matches the screenshot capture policy. This scoped UI/test batch does not authorize merge or production deployment.

Automatic video playback is suppressed in the standalone Upload composer preview subtree, including otherwise hidden general/provider previews. The shared renderer context defaults to allowing its existing autoplay prop outside that subtree. Explicit picker preview videos have manual controls. The attachment regression checks every mounted video, including hidden previews, so a secondary renderer cannot silently auto-play after Add selected media.

Cold development route compilation/hydration is handled as test bootstrap: the runtime prewarms the Settings route used by More, and `openApp` permits up to 60 seconds for the app shell. Product-state and interaction assertions retain the 15-second expect timeout, with zero retries. This is a development readiness budget, not a production performance claim.
