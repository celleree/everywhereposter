# Frozen app/worker contract v1

The input top level is `{schemaVersion, project, inputs, provenance}`.
The legacy V2 rules below apply when `editorStyle` is absent. The explicit
approved style is described separately at the end; it never reinterprets a saved plan.
Accepted tuples are manifest schema 1 / project schema 1 / `easy-graphics-v1`
and manifest schema 2 / project schema 2 / `talking-head-v2`. Mixed or unknown
tuples are rejected. V2 requires one source video asset, a single full-source cut,
30 fps, empty broll/effects and no titles field. An absent title remains valid.
An optional V2 title is {version:1,text,wordIds,from,frames,bounds,style:'block-title-v1'}.
It must match 3-9 contiguous transcript words joined by spaces, at most 60 characters;
from and frames are output frames, with duration 60-120 within the output. Bounds
use 1080x1920 design coordinates, lie inside selected safe cells, start no lower
than y=768, and avoid all observed stationary-speaker faces padded by 20 pixels.
The opaque #101714 block uses white 96px EP Plex, no more than two measured lines;
unfittable text fails rather than shrinking or dropping words. Caption phrases reserve
the title box throughout their effective range when they overlap its interval.
QA masks the validated active box in both upper-picture samples and still checks
uncovered picture. This core is not a producer capability advertisement.
It includes id/revision, portrait canvas, original source assetId/sha256/frames,
assets, source-frame cuts, output-clock words, caption wordIds, observed single
speaker faces (1080x1920 design coordinates), broll/effects, safeZones and director.
All assets have id/kind/file/sha256/evidence; video assets also have duration/fps.
Optional width/height must match probed dimensions if supplied.

`inputs.assets` has exactly one `{id,path,sha256}` per registered asset.
`inputs.audio` is `{path,sha256,timeline:{sourceSha256,fps,cuts:[[in,out],...]}}`.
`inputs.font` is `{path,sha256}`. All paths are worker-local absolute paths.
`provenance` is `{origin,originalSourceSha256,proxy:null,cooked}`. approved-edl
requires cooked:null. cooked origin requires `{sourceSha256,decisions:{path,sha256},
captions:{path,sha256},receipt:{path,sha256}}` in cooked; actual files must be
readable and hash-verified. These are upstream custody records, not a claim of
semantic validation of arbitrary native Cooked formats. No proxy accepted yet.

## Caption timing capability (opt-in)

`node run.mjs capabilities` prints JSON without project/runtime inputs:
`{"captionTiming":{"version":1,"field":"captionTimingPolicy","default":"legacy-v1","policies":["legacy-v1","trim-trailing-hold-v1"]},"profiles":{"version":1,"profiles":[{"manifestSchemaVersion":1,"projectSchemaVersion":1,"profile":"easy-graphics-v1"},{"manifestSchemaVersion":2,"projectSchemaVersion":2,"profile":"talking-head-v2"}]}}`.
The same frozen capability is exported as `CAPTION_TIMING_CAPABILITY` from
project.mjs. A producer MUST verify version, field and supported policy in the
actual target package before emitting `project.captionTimingPolicy`; older
packages ignore unknown fields. This prerequisite does not opt in any producer.

Absent policy and explicit `legacy-v1` retain the original frame calculation.
Unknown policies (including null) fail validation. `trim-trailing-hold-v1`
starts with the legacy half-open range, then ends a group's trailing hold at
the next group's floored start frame only when that frame is earlier than the
legacy end, at or after every word's ceiled end frame in the current group,
and strictly after the current start. Timestamps, text and next start stay
unchanged. Genuine overlaps, same-frame/empty ranges, final groups and long
pauses retain legacy behavior when this condition cannot hold. This does not
solve every timing anomaly or guarantee readable duration.

Film selection and chunk projection share `captionFrameRanges`. Chunk content
binds the resolved policy and each intersecting caption's effective frame range;
a next-group start change can therefore invalidate a preceding 5s chunk.
Policy changes cannot collide even when effective ranges happen to match.
Renderer source changes also change renderer identity. Existing cache files,
final artifacts and receipts are retained, never migrated or automatically
rerendered. Old acceptance may become stale under this package; validate original
receipts with their original package/runtime, never stale cache reuse.

## Registered effects

Common fields: id, type, from (output frame), frames, anchorWords, reason, bounds
`{x,y,width,height}` in 1080x1920 design pixels. Optional directiveId binds a
required instruction. Only the following props are accepted:

```json
{"type":"EasyRelationship","props":{"layout":"flow","heading":"AI helps tailor","theme":"light","nodes":[{"id":"tone","label":"Tone + context","icon":"document"},{"id":"format","label":"Length + layout","icon":"recording"}]}}
```

```json
{"type":"EasyMediaPanels","props":{"theme":"dark","panels":[{"id":"one","assetId":"owned-still-0","label":"Context","at":0},{"id":"two","assetId":"owned-still-1","at":0.3}]}}
```

Relationship layouts: flow (2-3 nodes), split/exchange (exactly 2). Themes:
light/dark. Icons: recording/document/conversation/product. Media panels: 1-3
registered still images, optional labels, bounded reveal times. Heading max60
characters, label max48, at most two measured label lines. No arbitrary SVG,
URLs, paths, source overrides, components, transforms or minuscule text scaling.
Critical ink and card regions are checked at actual loaded-font SVG geometry,
including transformed icons and connectors. All animations change opacity only.

## Receipt schema

Render receipt schemaVersion1 has status RENDERED_QA_PENDING, projectId, revision,
profile, projectHash, rendererHash, runtimeHash, runtimeConfigSha256, toolHashes,
sha256 (final), frames, seconds, canvas, bindings, and diagnostic sources.

QA receipt schemaVersion1 has status PASS, acceptance
TECHNICAL_PASS_CREATIVE_REVIEW_REQUIRED, projectId/revision/profile, sha256,
projectSha256, rendererHash, frames, durationSeconds, resolution, fps,
fullDecode:PASS, audioLagMs, audioCorrelation, audioWindows, sourcePreserved,
sampledUnchangedPicture, creativeApproval:PENDING,
continuousHumanListening:NOT_CLAIMED, limitations, and identical bindings.

Bindings (required names): projectId, revision, profile, projectHash,
prepareReceiptSha256, sourceSha256, assetHashes (id ->sha256), fontSha256,
audioSha256, audioTimeline, rendererHash, runtimeHash, runtimeConfigSha256,
toolHashes, lockfileSha256, packages. toolHashes maps nodeExecutable,
pythonExecutable, browserExecutable, ffmpegExecutable, ffprobeExecutable to
hashes. packages maps @remotion/bundler, @remotion/renderer, @remotion/player,
remotion, react, react-dom, esbuild to actual lock-checked versions.

Acceptance requires matching render/QA/current bindings and final hash, not
status alone. Hashes are lowercase SHA-256. Renderer identity includes owned
source helpers/composition/verification code and the staged font. Runtime binds
local tool bytes, local config bytes, lock bytes and checked package versions;
this is a custody record, not a claim that every OS/shared-library byte is hashed.
Absolute worker paths make receipts worker-specific; re-materialization on
Linux generates a new receipt, not a copied Windows readiness claim.

Persistence may retain additional IDs/locations outside these worker receipts.
The app owns project authorization, immutable object versions and storage receipt
binding. A technical-ready download does not authorize publication. No callback,
network service, database write or app route is implemented by this package.

## Title layout preflight

`node run.mjs title-preflight CANDIDATE --runtime RUNTIME.json` reads bounded
`project.json` and `public/font.ttf` from CANDIDATE, validates a titled V2
1080x1920/30fps full-source project of at most 1800 frames, then renders distinct
caption/title states with the same font and Film components, without source video
or audio. Every caption group must be visible and at most 128 states may be
checked. V2 captions and titles must each fit at most two measured lines.
A successful probe exclusively writes `title-preflight.json` only after all
states and bindings have been rechecked. Existing receipts are never overwritten.

`node run.mjs title-preflight-check CANDIDATE --runtime RUNTIME.json [--project FINAL.json]`
performs no render or write. It requires the full current receipt, frame coverage,
font, renderer and runtime bindings to match. The optional server-owned final
project is compared using the same exported `layoutInputHash` projection:
schema/profile, canvas, source identity/count, cut bounds, ordered words and
caption IDs, resolved timing policy, faces, safe zones and title. Project ID,
revision, direction notes and cut reasons are excluded. The hash is SHA-256 of
the UTF-8 domain tag `EP_TITLE_LAYOUT_INPUT_V1\n` followed by recursively
key-sorted compact JSON. This is a layout fit and custody check, not a quality
or speech judgment; a valid title-free V2 project does not qualify for this probe.
The capability command advertises `titlePreflight` version 1 with profile,
commands, style, 96px font size and both two-line limits.

## Approved captions, headline and quiet cuts

`project.editorStyle: 'accepted-caption-b-top-rounded-v1'` is an explicit V2
opt-in. `capabilities.acceptedEditor` binds version, style, caption-plan command
and both exact font hashes. The original capabilities remain unchanged.
`accepted-captions CANDIDATE --runtime RUNTIME` uses actual loaded fonts and
the shared browser composition to group at most three words on one line, split
at source seams, gaps over 0.19s, punctuation or measured advance over 360px.
All design units below are at 720x1280 and scale uniformly with the canvas.

Captions are 34.666667px Liberation Sans Bold, white throughout each phrase,
with a 2.4px round-joined #080808 stroke at alpha 240/255 and no backing.
Actual union ink is centered at x=360; the reference em origin is converted to
a browser baseline using the actual font ascent. The complete caption guard
fits [72,704,552,832]. Phrases end at the minimum of final word end+0.18s,
next phrase start and output duration, quantized with decimal round-half-up.
There is no active-word highlighting, shrinking, clipping or text rewriting.

The headline uses TikTokSans36pt-Bold.ttf at 42px. Actual glyph ink is centered
at [360,228], at most 360px wide. Its white box adds 12px horizontal/8px vertical
padding, has radius 12px, and fits entirely in [72,184,552,272]. It appears on
output frames [0,min(135,outputFrames)). Hair overlap is allowed; fixed framing
still requires creative review. A custom headline is user-authored; default copy
uses the complete eligible opening sentence. Overflow fails before paid direction.

Only `instagram-approved-editor-v1` and `tiktok-approved-editor-v1` may accompany
this style. These are user-approved reference guards, explicitly provisional,
not organic-platform certification. Legacy profiles and presets are unchanged.

Quiet cuts are bounded proposals from the existing source/VAD policy. Every raw
word interval vetoes an intersecting deletion; no words, semantic retakes or
sentences are automatically removed. Frame spans and source word IDs remain
stable. PCM is decoded at 48kHz stereo, then concatenated at sample boundaries
[in*1600,min(out*1600,sourceSamples)). Preparation independently compares the
retained PCM to the original source. Original media bytes remain untouched.
An audio tail of at most one frame is retained with explicit `source.originalFrames`
and one final held picture frame; `source.audioSampleFrames` and output
`audioSampleFrames` bind actual sample counts. Codec padding is separate.

The app request opts in through `creative.editorStyle`, optionally `headline`
and `restoreCuts`. An owned `sourceEvidenceJobId` reuses the original transcript
and prior direction for a separate, uncharged local revision. Restoring all cuts
restores every original word time and PCM sample, preserving earlier results.
No production activation, listening, real-footage acceptance or cross-engine
pixel equivalence is established by contract/unit tests. The exact caption font
and matching-font visual acceptance are outstanding prerequisites.
