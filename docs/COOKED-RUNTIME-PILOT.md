# cooked. native runtime pilot

The native adapter remains an internal component. The authenticated app gateway, opt-in offline worker and review-page adaptations are now implemented but disabled by default; see [the worker activation and rollback guide](../tools/cooked-worker/README.md). They add no production model installation, paid provider call or database migration. Production worker activation requires separate scoped approval. The measurements below describe the original isolated adapter pilot.

## Reuse boundary

The adapter invokes the existing Python pipeline from [cooked. commit bce911c](https://github.com/nextwork-projects/ai-video-editor-cooked/tree/bce911c1d0652f30b64fd5283cc4aa9fa92811c9): transcription, retake proposals, timeline building, rendering, verification, word cut/restore, and review snapshots. Editing algorithms remain upstream. `retakes propose` produces suggestions; it does not approve semantic cuts. The prior custom TypeScript word-edit implementation is not integrated.

Trusted server configuration must supply the pinned source, Python environment, a vetted local model, launcher, executable search path, and an existing private work root. The caller must authorize the organization/media and probe the exact prepared source before invoking the adapter. Returned paths are internal.

`run(source)` produces revision 0. `revise(jobId, organizationId, edits, expectedRevision)` applies bounded raw-source-time cut/restore/pause ranges and invokes the same native build/render/verify/review commands. Stale revisions and wrong organizations are rejected. A failed native mutation leaves the job available only for scoped cleanup. Original media is preserved and checked by hash.

Every render invalidates the generated verification transcript: upstream render caching can restore an older output mtime, incorrectly making the previous transcript appear fresh.

## Resource and security limits

- Sources: audio required, aligned known timestamps, at most 60 seconds, 100 MiB, 1920 by 1080 dimensions (either orientation), 60 fps.
- One active operation per runtime instance; admission is not global across processes.
- CPU affinity permits at most two CPUs. The external worker must enforce aggregate CPU and memory limits.
- RSS and workspace sizes are sampled every 100 ms. Defaults: 768 MiB RSS, 512 MiB workspace, 8 MiB logs, 90 seconds per stage and 240 seconds per operation. These are not kernel-hard limits.
- Environment variables use an allowlist. This does not provide network or filesystem containment. Run only inside a separately bounded, offline worker with the pinned trusted source.
- Ownership records are in memory. They do not survive restarts and do not establish durable jobs, retention, or crash recovery.
- Cleanup checks organization, workspace containment, owner marker and active state. Only generated job workspaces are eligible.

The adapter is not an authorization gateway. The app gateway now checks source Media ownership on every operation, binds mutations to the adapter revision and exposes only bounded review/state/data/video/edit/save routes. It uses `revise()` as the single mutation owner; the upstream local HTTP server is never exposed. Local agent, capture, update, learning and unrelated routes are denied. The pinned-HTML adapter keeps authenticated URLs relative and exposes only exact eligible whole-block cut/restore from the revision-bound `quiet-block-v1` receipt. Arbitrary word, phrase and pause edits are unavailable. The mobile wrapper requires explicit preparation and retains saved-copy download/composer handoff. Current native input limits are defined in `cooked-editor-limits.ts` (4 minutes, 100 MiB, 1280×720 in either orientation, 30 fps). The worker admits one retained session globally and retires its entire namespace between sessions.

## Isolated evidence

An owned 10.73-second synthetic speech fixture ran with network disabled and an external 1 GiB/no-swap/two-CPU-quota limit. The unchanged native first-output pipeline took 4.67 seconds; whole-scope memory peaked at approximately 231 MiB. The initial adapter run took 5.39 seconds. The extended adapter completed transcription, a selected three-word cut, restoration, verification and three review drafts in approximately 13.85 seconds. The cut was 10.04 seconds; the restored output was 10.68 seconds and byte-identical to the initial output. No paid calls occurred.

The tiny model retained the repeated phrase but normalized both synthetic filler words; filler-removal quality is not accepted. This synthetic smoke test does not establish real-person quality, maximum-source capacity, authenticated app integration, physical-phone usability or production capacity.

The original unchanged desktop review UI accepted selecting words and Cut/Apply. The original native phone layout hid the transcript editor. The current app adapter keeps the transcript visible for playback navigation and offers separate whole-block controls for corrections. Basic captions were separately demonstrated using upstream `plan.chunk_captions`, `export_nle.srt` and FFmpeg subtitles; this is not proof of kinetic captions or the styled renderer.

## Dependency decision before packaging

The pilot used faster-whisper 1.2.1 and MIT-labelled Systran faster-whisper-tiny weights pinned to repository revision `d90ca5fe260221311c53c58e660288d3deb8d356`; model.bin SHA-256 `dcb76c6586fc06cbdac6dd21f14cfd129cc4cdd9dce19bf4ffa62e59cbe6e6d1`. Downloads occurred only during isolated setup; editing ran offline. The separate local package pins and bundles these dependencies and weights; they are not installed in the ordinary app image.

The source repository is MIT with separate component terms; copied source must retain its notice. CrisperWhisper noncommercial weights, paid Scribe calls, Remotion, GSAP, optional matting, music and external assets are excluded from the pilot. This is not blanket clearance of the complete upstream product.

The separate local Python/model image and opt-in worker package are built and isolated locally. Remaining acceptance includes final captions, licensed real-person quality fixtures, physical-device testing and production activation/resource checks. Temporary native drafts are intentionally disposable; recovery looks up a retained session without rerunning transcription, and saved outputs use ordinary Media storage. Existing production Phase 1 stays active until an ordinary reviewed release; worker activation is a separate gate.
