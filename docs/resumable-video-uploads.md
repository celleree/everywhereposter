# Resumable local video uploads

This change prepares local-storage video transfers for files above the proxy's single-request limit. It does not migrate storage or implement durable Quick Upload; that is a separate dependent PR.

## Transport and persistence

Authenticated `/media/uploads` routes create/list organization-owned sessions. Each 8 MiB part is streamed directly to persistent private staging, hashed and checked against a complete original-file manifest. Repeat content is idempotent; changed content conflicts. Session creation accepts an explicit field allowlist; client-provided lifecycle, media and identity fields cannot control persisted state. Session creation also binds the selected organization to prevent a cookie/workspace change during hashing from enrolling the file elsewhere.

Parts are stored under `UPLOAD_DIRECTORY/.resumable`. Repository proxy rules and the Next upload-serving route block this directory. The proxy rules stream upload requests and retain existing general limits. Production configuration has not been changed. All serving layers must be upgraded together before enabling this client.

Finalization streams assembly, verifies every digest, inspects actual container/packet metadata using bounded local-only ffprobe, then renames atomically on the same volume. A reserved media identity and transaction bind the completed file to exactly one media record. If file rename succeeds and the transaction/response is lost, recovery verifies and reconciles the same file and identity.

The existing Temporal maintenance workflow discovers interrupted finalization and sweeps expired staging. Its cadence is hourly; return/resume can reconcile earlier. Completed media and identity receipts are retained. Deploy matching backend and workers with the additive migration; no migration or deployment is included in preparation.

## Limits

- MP4/MOV containers, including HEVC video tracks; positive duration up to 600 seconds.
- Separate 1000 MiB per-file ceiling, matching the existing downstream consumer limit.
- One pending upload per organization, two globally, ten new sessions per organization in 24 hours.
- One part request per session, two globally; one finalizer globally. Database leases and generations fence stale handlers.
- Capacity reservation includes parts, assembly and one request temporary file, subtracting bytes already persisted. Admission/claims preserve a 2 GiB free-space floor on the actual upload volume.
- Incomplete transfer expiry follows 24 hours of inactivity. Once finalization has started, maintenance can recover it after that deadline; it does not permanently reserve a slot solely because a worker was unavailable. Explicit cancellation waits for an active request and refuses already-started finalization.

These are conservative implementation defaults, not proof of production capacity. Capacity/quotas and all static-serving paths require authorized deployment acceptance. Codec acceptance does not guarantee browser playback or a destination's acceptance; no transcoding is added.

## Browser behavior

The authenticated app layout owns transfer state and the selected File. App navigation and closing the picker/composer do not own or cancel the transfer. Pause and return/resume use acknowledged parts. Returning after browser termination requires selecting the original file, checked against the complete manifest, including any unuploaded tail.

`Safe to leave` appears only with a server-confirmed completion/media receipt. During transfer the UI explicitly says that browser closure pauses unfinished uploads. iPhone Safari is not promised to continue after background suspension or termination. Transfers do not automatically restart after ambiguous responses; explicit resume reconciles the same identity.

## Verification and remaining acceptance

Focused tests exercise real streamed synthetic media above 100 MiB, 600/601-second boundaries, HEVC/MOV, truncation, idempotent/conflicting parts, quotas, ownership, interrupted streams, restart recovery and rename/commit crash windows. Browser fixtures intercept mutations locally and do not prove real provider publication or deployed proxy behavior.

Physical-device acceptance remains required: iPhone/iPad Safari picker, MP4/MOV/HEVC playback limitations, navigation, lock/background/termination, return/reselection and network changes; Android browser and desktop large-file behavior. Test deployed proxy headers/body streaming and volume free space in a separately authorized release.

## Review boundary

API/ownership, persistence, private staging/serving, streaming finalization and layout transfer ownership are one coherent safety change. It exceeds ordinary soft PR line/file targets because splitting these boundaries would expose sessions without their storage or recovery protections. Review schema/admission first, streams/filesystem lifecycle second, and client/navigation last. Durable consent and publishing stay outside this PR.
