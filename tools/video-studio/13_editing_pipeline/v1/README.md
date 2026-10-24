# Everywhere Poster combined editing pipeline — local pilot

One editing project connects the existing tools. Cooked supplies source-ordered cuts,
aligned narration and observed face boxes. Codex supplies the creative direction and
matches authentic assets to that narration. Remotion uses the same project and Film
component for Player and export. FFmpeg prepares original-source audio and muxes the
final export. This extends the existing Studio; it is not another app editor.

## Current representative edit

`projects/talking-head-v2/project.json` uses the original 117.433-second
1440×2560/30 fps recording and verified existing Cooked decisions. It retains
89.566667 seconds, all 291 aligned words and source order. Three B-roll cues and
three effect instances were chosen by Codex after source/transcript inspection,
with a separate read-only editorial inspection. No paid API, new dependency or
new transcription request was used.

The AI direction in this pilot is performed by the Codex session. This is **not an
unattended arbitrary-video upload service**, and no production app route is changed.
Future edits can reuse the runner and component code, providing another verified
Cooked edit and a new JSON direction instead of generating a new rendering app.

## Run

Reuse the already installed `node_modules` symlink. Do not run an installer.

```bash
python3 prepare.py /absolute/original.mp4 /absolute/verified-cooked-edit projects/new-edit
# Inspect director-input.json and actual asset contact sheets in Codex.
# Save validated direction as project.json, preserving draft source/cuts/words.
node run.mjs validate projects/new-edit
node run.mjs stills projects/new-edit
node run.mjs serve projects/new-edit
node run.mjs render projects/new-edit
/home/arund/cooked-acceptance/runtime/venv/bin/python qa.py projects/new-edit
```

The existing project starts with:

```bash
node run.mjs serve projects/talking-head-v2
```

Default preview: http://127.0.0.1:4381. `EP_PREVIEW_PORT` chooses another local port.
Player controls provide playback, seeking, mute and fullscreen. The finished MP4
download appears only after project-bound render and QA receipts match the actual
file. Nothing posts to a social platform.

Download acceptance currently binds the project, render receipt, QA receipt and
exported file hashes. It does not automatically invalidate an export after
renderer code or font changes. The representative output uses frozen reviewed
code and font. Later renderer changes require a new render and QA before delivery.

## Quality, clocks and revisions

- Export decodes the original source, at its original resolution, into H.264 CRF16
  with original-source speech encoded once as AAC256k. This is high-quality lossy
  export, not a promise of bit-identical or lossless video.
- Source and B-roll previews are 720×1280. They use the same source frame indices, cuts,
  caption clock, effect parameters and composition. Export never uses that proxy.
- The preparation receipt binds the original SHA256, exact cut frame pairs, fps
  and prepared audio SHA256. Changing a cut requires fresh audio preparation and
  caption/face realignment. A same-duration cut shift cannot silently reuse speech.
- Each effect has a narration anchor, reason, explicit bounds and parameter data.
  Every caption word is retained exactly once. Checked face/caption regions are
  protected. Script-mandated effect cues cannot silently disappear.
- New outputs use new project directories. Original sources and older finished
  videos remain untouched. Final exports are not overwritten.
- Rendering uses two concurrent browser frames and 20-second chunks. Cache keys
  bind renderer code, font, source assets and the decisions affecting that chunk.
  A later effect change does not invalidate unaffected earlier chunks.
- The local admission ceiling is intentionally bounded; only this 117-second
  input/89.6-second output is the current capacity demonstration. Thirty minutes
  or other large inputs are not accepted capacity claims.
- This is local process/resource control, not a production container or tenant
  boundary. Production worker deployment and capacity work remain separate.

## Existing effects

The original 15-component library remains at `../../12_effect_library/v2`.
The adapter contains ten effect branches with registered media and JSON props;
only DynamicChecklist and ImageCollage plus timed B-roll are accepted in this
representative edit. The other branches need individual acceptance examples.
CursorTracker also needs a validator repair: its coordinate `path` currently
collides with the generic media-path rejection and is not usable through JSON.
PersonPopOut requires revision-bound mattes; CinematicGrade, ShoulderZoom,
MatchCut and ZoomThroughCut require explicit full-frame framing adapters. They
remain available in the existing library, but this runner rejects them until
their required media/framing contract is supplied. It never silently ignores them.

## Verification

`node --test tests/*.test.mjs` covers provenance replacement, removed captions,
source-order/bounds, external media/path injection, unanchored visual cues,
speaker/caption collisions, explicit script cue loss, B-roll overrun, stale audio,
and selective cache invalidation. TypeScript checks the shared composition/player.

`qa.py` checks final codecs/resolution/frame count/duration, complete decode,
source hash, source-derived speech clock/correlation and six unobscured picture
samples using FFmpeg SSIM. Review artifacts distinguish these machine checks from
human listening and creative approval.

## Accepted priorities

Preserve script order and the opening hook. Prioritize story understanding for
B-roll selection, speaker-aware placement, narration-aware effects and scene
planning. Honor explicit script cues and allow tasteful additions. Human review
belongs after editing and before publishing; a manual timeline or visible AI
decision dashboard is not required. Conversational changes and multi-user editing
are not needed for this first representative workflow.

Technical references: https://www.remotion.dev/docs/player/player and
https://www.remotion.dev/docs/renderer/render-media .
