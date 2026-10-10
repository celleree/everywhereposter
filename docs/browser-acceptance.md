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
