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

## Runtime preflight (report only)

Copy `runtime-config.example.json` to a local file outside the checkout and replace
its null placeholders with approved existing paths. Paths are absolute or relative
to that configuration file. `nodeModulesRoot` names the actual `node_modules`
directory; `pythonSitePackagesRoot` names the existing `site-packages` directory.
Unknown fields, credentials/environment settings, URLs, network paths and non-path values are
rejected. No environment-variable expansion or PATH/ancestor lookup occurs.

```sh
node runtime-preflight.mjs path/to/runtime-config.json
```

The JSON report names missing/unconfigured prerequisites and reads only the seven
required JavaScript packages' `package.json` name/version fields. It checks file
presence for NumPy/Pillow and configured executables without reading package code
or executing tools. Metadata links escaping a configured dependency root are
reported as unverified. Effect roots and lockfiles receive presence checks only;
there is no dependency-closure, integrity, license or compatibility verification.
TypeScript is a separate development-check prerequisite, not checked here.

Exit codes: `0` = `METADATA_PRESENT`, `1` = `INCOMPLETE`, `2` = `CONFIG_INVALID`.
Every report retains `runtimeCompatibility: UNVERIFIED`; even exit 0 does not
establish runnable rendering. The null-filled example deliberately exits 1.
No inputs, exports or receipts are modified. No installation, rendering, network
access or executable probing occurs. This configuration is consumed only by the
preflight; the existing runner paths and receipt acceptance logic are unchanged.
The existing fingerprint includes every immediate `.mjs` file, so adopting this
module changes that fingerprint. Preserve frozen exports and their original code.

## Run

### Selected-destination safe zones

Safe-zone-aware projects use the same `Film` for preview and export. Captions are
measured with the loaded local font, wrapped/repositioned at the existing nominal
76px size on the 1080x1920 logical canvas, then checked using actual SVG glyph
bounds plus stroke. A measurement or containment failure stops rendering; words,
word IDs, caption time windows, cuts and audio are not rewritten. Long text that
cannot fit requires a different layout, not silent clipping or smaller unreadable
type. Source-face observations are avoided when the source is visible; sampled
faces are not continuous tracking or proof of hands/keyboard coverage.

Opt in **only in a new project revision**, naming versioned profiles explicitly:

```json
"safeZones": {
  "version": 1,
  "profiles": ["instagram-provisional-v1", "pinterest-organic-v1"]
}
```

Alternatively use `{"version":1,"preset":"all-advertised-provisional-v1"}`.
That explicitly selects all ten currently advertised destinations and labels the
provisional/ad-derived boundaries. Missing, empty or unknown selections in an
aware project fail validation; no destination is silently discarded. Legacy
projects without `safeZones` retain their original layout, remain readable and
are labeled **UNASSESSED** in preview. They are not declared compliant.

Profiles in `safe-zone-profiles.mjs` retain source URLs, original reference points,
normalized polygons, placement/aspect, version, confidence and research date
(2026-10-24):

| Profile ID | Evidence and portrait geometry |
| --- | --- |
| `linkedin-organic-v1` | Official: 1080x1920 rectangle x112..870, y260..1360. |
| `pinterest-organic-v1` | Official organic full-bleed video: x65..885, y270..1130 at 1080x1920. Other ratios need their own profiles. |
| `tiktok-ad-derived-v1` | Standard LTR ad polygon at 720x1280: (80,160),(640,160),(640,560),(520,560),(520,840),(80,840). Organic use is not verified. |
| `youtube-ad-derived-v1` | Ad rectangle x48..888,y288..1248 at 1080x1920; organic Shorts uses dynamic guides. |
| `{instagram,facebook,threads,x,reddit,dribbble}-provisional-v1` | Separate provisional profiles using a product-selected fallback, not official organic pixel rules. |

The fallback is the LinkedIn/TikTok/YouTube intersection, including its notch:
(120,288),(870,288),(870,840),(780,840),(780,1248),(120,1248) at 1080x1920.
Only selected profiles are intersected. Selecting Pinterest lowers that combined
bottom to 1130; it does not tighten unrelated selections. Preserve the wider
upper area instead of squeezing everything into the narrowest rectangle.
Profiles do not guarantee every expanded-comment, keyboard, RTL or device state.
Destination eligibility is separate: Dribbble recommends video width >=1600,
has no required aspect/height, and its design-work rules exclude promotional
videos/commercials/tutorials. Thumbnail cropping is another concern.

Background video/desk, borders and shadows may bleed. Optional `focalRegions`
are individually assessed against the existing centered `object-fit: cover`:

```json
"focalRegions": [{
  "id": "keyboard", "track": "b1", "from": 1200, "frames": 60,
  "rect": {"x": 0.3, "y": 0.4, "width": 0.2, "height": 0.2},
  "essential": true
}]
```

`track` is `source` or an existing B-roll event ID, times are output frames, and
rectangles use normalized original-asset coordinates. Dimensions must be known
to assess cropping. Use separate regions for each hand, keyboard, computer, face
or product; a large visible region cannot compensate for a missing smaller one.
**95% is a warning heuristic, not an export gate.** Unknown regions/dimensions or
incomplete annotation intervals stay unassessed warnings. No detector or crop is
invented. Known complete cropping, or full-frame B-roll covering an explicitly
essential source region during its annotated interval, is a hard focal failure.
Nonessential source regions covered by B-roll receive warnings. Annotate essential
source action only over the intervals where it must remain visible. Annotations
are supplied observations, not semantic proof.

Readable essential graphics remain hard constraints. Private effect internals
and their animation extrema are not available in this checkout. Consequently,
aware projects containing effect events receive `UNVERIFIED_CRITICAL_EFFECT_BOUNDS`
and cannot render a protected export; supplied `bounds` cannot override this.
Legacy previews/effects remain intact. This is not completed safe-zone support
for the private effect library, and no effect or required cue is silently dropped.

The preview status label is guarded by `!isRendering`; no guide/frame pixels or
opaque safe-zone bars are added to exports. Profile source changes enter the
existing renderer fingerprint. Selected targets, focal metadata and observed
faces also enter chunk identity. Existing project/renderer/font/output receipt
checks remain authoritative; historical receipts are never backfilled.

Native synthetic geometry/layout regressions do **not** establish font-measured
rendering, effect acceptance, visual quality or actual app/device safety. Those
remain separate runtime checks with the existing authorized effect/font/runtime
sources. No dependency installation, private-footage render or publication is
part of this change.

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

Download acceptance binds the project and exported file hashes plus the same
`rendererHash` in both render and QA receipts. It rechecks the current renderer
sources and font on each acceptance request. Changed code/font or legacy receipts
without identity return `ready: false`, `status: STALE_NEEDS_VERIFICATION`; the
download route returns HTTP 409. Restart the preview after renderer/font changes.
Preserve historical exports and receipts; use a new project directory for a new
render and QA. Never add a current fingerprint to an old export to make it pass.
This preserves the existing immediate `.mjs`/`.tsx`/`.ts` source and font fingerprint;
nested dependencies, runtime versions and full toolchain hashing remain separate.

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
and selective cache invalidation. Export-acceptance tests use synthetic receipts
and files to cover current/stale/missing identities and output tampering without
rendering. TypeScript checks the shared composition/player.

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
