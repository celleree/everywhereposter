# Durable Quick Upload preparation

PR B is reconciled onto main after PR #169 (merge `321311d8828eb5efc1844471e0d15f6172f95990`) and PR #164 (merge `d5de3c3a20a60bda2fd918a02152b5bc5438369a`). It retains their final integration repairs and contains only the durable Quick Upload increment. It remains draft pending fresh focused checks, CI, independent exact-HEAD review and separate merge approval.

Enrollment is disabled unless `ENABLE_DURABLE_QUICK_UPLOAD=true`. No production configuration has been changed. This gate must remain off until the prerequisite publishing contract, additive migrations, matching workers/API/client and physical/deployed acceptance have been verified.

## Consent and execution

The transfer tray offers an explicit opt-in without individual review immediately after file selection, including while manifest hashing is running. The selected destination IDs and platform settings are frozen, stored against the authenticated organization and consenting user, and acknowledge persistence before subsequent chunks when consent is queued early. A lost acknowledgment pauses with explicit reconciliation of the same choice. No browser closure message promises an unfinished transfer continues.

A unique server record is both the consent receipt and dispatch outbox. Stable Temporal workflow IDs reject duplicate jobs. The existing hourly maintenance workflow drains undelivered intents. A worker waits for validated complete media, including finalizing all saved parts if the browser disappears before its completion request. It rechecks the original membership/role, existing AI/publishing permissions, current account/capability eligibility and platform settings before processing/submission. Consent can be cancelled only before processing claims it.

Caption generation uses the existing transcription and CopyGenerationService. It is claimed durably and is not automatically repeated after an ambiguous result. Existing generated-copy warning/confidence gates, video limits and per-platform settings still apply. Missing settings, accounts needing review and TikTok per-video choices are skipped. Defaults match the current single-video Instagram Reel and X reply settings; required YouTube choices are not invented.

Only PR #164's existing PublishingSubmissionService reserves posts, dispatches publishing workflows and controls provider fences. B persists the immutable submission body before submitting it. Replayed dispatch uses the same identity/content; no provider retry or replacement post is added. Ambiguous publishing outcomes remain locked for resolution. Progress and individual destination receipts survive browser disconnects and worker restarts. Both Quick Upload entry points for resumable media use the same server consent. Enrollment disabled never falls back to browser generation for that media; legacy media without resumable sessions retains its existing path. In-flight provider operations keep being observed without resending, and terminal uncertain outcomes remain locked.

## Verification boundary

Tests use disposable loopback PostgreSQL, local synthetic MP4 files, mocked caption/provider services, deterministic workflow activities and desktop/phone Chromium route fixtures. The #164 PostgreSQL ledger suite is also run against our owned fixture using a temporary port-pinned copy, preserving an unrelated occupied test container. These prove persistence and idempotency boundaries; they do not prove external publication or a live Temporal cluster release.

Required release acceptance remains: physical iPhone/iPad Safari picker, navigation, lock/background/termination, reconnect/reselect original file, resumed chunk integrity and HEVC preview behavior; Android background return; complete-transfer close followed by server processing, worker restart/outbox recovery and per-platform skipped/uncertain states using separately authorized provider tests. Safari can stop when suspended or terminated. `Safe to leave` requires the server's completed-media receipt and refers to saved transfer, while publishing has its own persisted state.

This coherent draft exceeds normal soft PR size limits because consent ownership, claims, immutable submission handoff and visible saved status must agree. Review order: additive schema/consent ownership, workflow and generation claims, #164 handoff/uncertainty, then the transfer tray lifecycle. The prerequisite publishing and resumable-upload contracts remain intact.
