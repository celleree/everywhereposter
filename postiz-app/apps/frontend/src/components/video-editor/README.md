# Video Editor frontend foundation

`/video-editor` uses the existing authenticated site layout and navigation. Mobile
keeps Upload, Scheduled, Media and More; the editor is inside More.

The workspace reuses `MediaBox` with `type="video"`, `compactPicker` and the normal
upload workflow. It requires exactly one selected media ID and reads the existing
organization-scoped `GET /media/:id`. The returned ID, path and video type are
checked before previewing. Browser metadata supplies duration and dimensions;
unknown values remain unknown. Playback is manual. Removing a source only clears
the page selection. Pacing and style notes are local, unsaved preferences.

## Backend integration boundary

This PR has no rendering endpoint dependency and issues no editing/transcription
mutation. Create edit, export, timeline, transcript cuts, captions, overlays and
inspection are disabled. A source preview is never presented as an edited output.

The engine contract in PR #172 at `5b04c2e90d983dbc6537b01e875a27616cd8fdc2`
declares schema version 1, source media identity/duration, source-time keep/cut
decisions, and reserved output-time tracks. Its pacing presets are `relaxed`,
`balanced`, `tight` (displayed here as Natural, Balanced, Brisk). No shared backend
type is imported before that change lands. V1 has no transcript alignment and
rejects nonempty caption/overlay/transition/override tracks.

Before enabling editing, verify the final API PR and deployed capability: exact
request/response/error shapes, source and output media identities, decision schema
version, supported presets, request lifetime/retry behavior and render limits.
Wire submission and failure recovery to that verified contract; preview/export the
separate saved output only after confirmed success. Freeform style interpretation,
word-aligned transcript cuts and visual tracks need their own verified support.

## Focused verification

From `postiz-app`:

```sh
pnpm exec tsc -p apps/frontend/tsconfig.json --noEmit --incremental false
pnpm exec jest --config jest.post-set-review.config.cjs --runInBand tests/frontend/video.editor.workspace.spec.tsx tests/frontend/mobile.upload.navigation.spec.tsx tests/frontend/media.library.guided.transcription.spec.tsx
pnpm exec playwright test tests/browser/video-editor.spec.ts tests/browser/picker-regressions.spec.ts --project=desktop-chromium --project=phone-chromium
```

Browser evidence uses the repository's isolated synthetic API and video fixture,
including 390×844 portrait and 844×390 landscape. It proves frontend interactions
and real browser decoding of synthetic bytes, not live upload/storage/render or
physical-device acceptance. The existing Upload picker tests cover cancellation,
pagination, preview containment and attachment without autoplay.
