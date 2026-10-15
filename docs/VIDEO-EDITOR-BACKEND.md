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
requires observed container/video/audio start times at zero (within 1 ms).
Shifted or unknown stream timestamps are rejected as `UNSUPPORTED_SOURCE` during
analysis and direct rendering, so independent timestamp resets cannot silently
remove a valid A/V offset. Offset-aware rendering is a later slice. Rendering
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

## Frontend API

`POST /media/:id/video-edits` uses the normal backend base URL and authenticated
organization from the request. The existing `Create / AI` policy applies, as in
PR #83. Do not send organization IDs, source URLs, prompts or arbitrary EDLs.

Request:

```json
{"schemaVersion":1,"pacingPreset":"balanced"}
```

`schemaVersion` is required; `pacingPreset` is optional and defaults to balanced.
Only tight/balanced/relaxed are accepted. Unsupported request keys are rejected.
The synchronous success response has HTTP 201 and this shape:

```typescript
{
  schemaVersion: 1;
  outputMedia: {
    id: string; name: string; originalName: string | null; path: string;
    type: 'video'; thumbnail: string | null; alt: string | null;
  };
  editDecisionList: VideoEditDecisionListV1;
  render: {
    status: 'completed'; durationMs: number;
    container: 'mp4'; videoCodec: 'h264'; audioCodec: 'aac';
  };
}
```

Use `outputMedia.id/path` for preview or subsequent media selection; keep the
source selected until a complete success response arrives. No publishing occurs.
The output is an ordinary media record connected to the requesting organization.
Its file uses existing local/R2 storage and URL visibility; this does not add
private blob access control. Local outputs are copied with exclusive creation;
R2 outputs are streamed with known length to a unique generated key.

Errors use Nest's HTTP envelope. Service errors include `code` and `message`:

| HTTP | Code / meaning |
| --- | --- |
| 400 | INVALID_EDIT_REQUEST; invalid schema/preset/unsupported keys (DTO validation may return Nest validation messages) |
| 401/403 | Existing authentication or capability policy |
| 404 | MEDIA_NOT_FOUND; foreign/deleted source or removal during rendering |
| 429 | RENDER_BUSY; one active edit per backend process |
| 422 | SOURCE_UNAVAILABLE, UNSUPPORTED_SOURCE, SOURCE_TOO_LONG, ANALYSIS_FAILED, NO_USEFUL_SEGMENTS, TOO_MANY_SEGMENTS, INVALID_EDIT_DECISIONS, RENDER_FAILED, INVALID_OUTPUT |
| 500 | EDIT_FAILED; storage/database failure |

This operation reads existing transcription metadata only; missing, processing,
failed or empty transcription does not block acoustic silence editing and does
not start a transcription/provider request. It never derives semantic timing.

The source and prepared local files are preserved. Temporary downloaded/rendered
files are cleaned after success/failure; database-save failure rolls back only the
newly uploaded artifact. Cleanup failures are logged and may leave an orphan.
Database and storage are not transactional. A process crash can leave temporary
or uploaded files; durable jobs/reconciliation are a later slice.

There is no job polling, EDL persistence, idempotency key or automatic retry in this
baseline. A repeated POST makes another output. After a network timeout/disconnect,
the outcome is unknown: inspect the media library before deliberately retrying.
Process admission does not coordinate multiple replicas. Long-running/restartable
jobs, draft persistence and stronger admission controls require a separate design.

Dependency order: merge the engine PR first only after its gates and human approval;
retarget/synchronize the API PR onto main, then rerun affected checks and obtain a
fresh exact-HEAD review. The API PR can be tested/reviewed on its engine base now.
