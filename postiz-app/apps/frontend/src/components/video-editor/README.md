# Video Editor integration

`/video-editor` reuses the reviewed engine/storage/API candidates172/174/175 and workspace173. Desktop navigation and mobile More open the same authenticated tab. Select exactly one existing video or upload through the existing MediaBox picker. The confirmed organization-scoped source starts one automatic edit with explicit `relaxed` (Natural) pacing. Balanced/Brisk can be applied deliberately as another edit. No style prompt, paid provider call, transcription request or publishing action is added.

The existing synchronous `POST /media/:id/video-edits` receives only `{schemaVersion:1,pacingPreset}`. The frontend reuses the pure shared decision validator and checks source identity, preset, separate output identity, render codecs/duration and bounded decisions. Organization-scoped `GET /media/:outputId` confirms the media record before preview. Source and output remain separate, with manual playback.

Download uses native fetch with omitted credentials, no application headers, redirects disabled and an enforced100MiB streaming ceiling. Buffering for the browser download is bounded but costs client memory. Actual R2 CORS/download acceptance remains a live gate. The source is never deleted. Use in composer rechecks the output, loads current accounts and opens the existing AddEditModal with the output as `onlyValues` media. It creates no post and leaves the separate saved Create draft in browser storage.

## Recovery and concurrency

Versioned user/organization-scoped receipts are saved before POST. The last source/applied pacing is restored after refresh. Pending, network/server-uncertain and malformed-success outcomes never automatically resubmit. Confirmed output receipts recover through GET only. Known rejections require deliberate retry. An unknown outcome requires checking Media Library and explicit confirmation before another copy.

Same-origin browser tabs use a scope-wide Web Lock with `ifAvailable`; unsupported/insecure browsers fail closed before POST. See [LockManager.request](https://developer.mozilla.org/en-US/docs/Web/API/LockManager/request). A synchronous ref/class guard also blocks repeated in-page submissions. Storage failure prevents a new render. Source and pacing changes are disabled while work is pending. Organization changes/unmount discard stale UI responses and abort local waiting. "Stop waiting" does not claim server cancellation; the saved output may still arrive in Media Library.

This API has no durable job ID, server cancellation, cross-browser idempotency or replica-wide admission. Browser receipts do not create those guarantees. The existing backend permits one active render per process. Repeated deliberate POSTs create separate outputs; unknown results must be reconciled manually. Durable jobs/cancellation would be a separate backend design.

## Acceptance and activation gates

V1 supports acoustic long-pause trimming only, preserving source order, with separate H.264/AAC output. It requires MP4/MOV with audio, <=60 seconds, <=100MiB,1080p pixel count, dimension<=2160,60fps and<=200 decisions. Two codec threads/one filter thread and bounded probe/analyze/render timeouts remain unchanged. Real synthetic FFmpeg verification covers output codecs/duration, source preservation, cleanup and admission; it does not prove safe combined load on the shared4GB host.

Standard editing and the six actionable Cooked routes use Create/LOCAL_VIDEO_EDIT. The current nondeleted LAUNCH_V1 subscription grants local editing without an AI-credit balance; eligible legacy AI plans and existing billing-disabled legacy behavior are preserved. Missing grants with billing enabled deny admission, and subscription lookup failures stop dispatch. Cooked availability status is unchanged; its separate activation, organization allowlist, ownership, origin and runtime/resource gates still apply. Local Cooked transcription uses its configured offline Whisper model.

This permission does not enable generic AI, paid transcription or creative directing. Paid media transcription and guided summary/draft/rewrite retain their existing wallet reservation/recovery boundaries. The standalone creative captions/B-roll/graphics pilot is not integrated by this access change. Current subscription lifecycle semantics, originals and output handling are unchanged.

Before live completion: exact-HEAD CI/review, scoped merge/deploy approval, production upload/storage/download and physical-mobile acceptance, server request-lifetime/recovery checks and4GB shared-resource acceptance. No production data, paid provider call or external social publishing is used in offline verification. A browser fixture does not establish production auth/OAuth or R2 acceptance.
