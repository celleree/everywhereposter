# Video Editor backend

The baseline adapts the Phase 1 detector and trim/concat renderer from PR #83
(`e6ad70a10096b5ed65d924d4b6f098204db936d0`) to current main. It does not include
that PR's composer UI or AI style planner.

## Decision contract

`VideoEditDecisionListV1` in `media-editing/video-edit-decision.ts` is the shared
editor-neutral contract. All times are integer milliseconds; source ranges are
half-open `[sourceStartMs, sourceEndMs)`, ordered, contiguous, and cover the
entire source. `keep` ranges are concatenated in source order. IDs are stable
within one decision list, not across analyses. Pacing is `tight`, `balanced`
(default), or `relaxed`; each specifies the silence threshold, minimum pause,
and speech padding. Acoustic silence detection does not establish speech meaning.

`source.transcription` is null or `{id, generation, alignment: "none"}`. Current
transcription uses `gpt-4o-mini-transcribe` and persists plain text only. There
are no word/segment timestamps. No filler words or semantic cuts are inferred.

V1 reserves typed `tracks.captions`, `tracks.overlays` (image/video media IDs),
`tracks.transitions`, and `tracks.overrides`. These are empty in the baseline;
the renderer rejects populated tracks. Captions/overlays use output timeline
times; transitions reference a kept decision; overrides reference decision IDs.
Future word-aligned selection must add actual timestamp provenance and a new
schema/strategy version. Enabling tracks also requires explicit versioned
validation/rendering and tenant authorization for every referenced media ID.
Unknown versions fail closed. Never silently ignore requested features.

## Engine limits

MP4/MOV with audio, at most 60 seconds, 100 MiB, 1080p pixel count (portrait is
supported), dimension <=2160, <=60 fps, and <=200 total decisions. Rendering
always creates a separate H.264/AAC MP4. Commands use argument arrays, local-file
protocols only, two codec threads, one filter thread, bounded stderr buffers,
30s probing, 60s analysis, and 120s rendering. Output must contain A/V, stay
under 100 MiB, and match retained duration within the muxing tolerance.
Temporary render directories are removed on failure and by the cleanup receipt
on success. Source files are never modified.

Review order: decision contract, renderer, decision tests, synthetic render test.
The engine and its verification form one coherent slice; storage/API integration
is a separate dependent slice. No dependency, migration, billing or deployment
change is required.
