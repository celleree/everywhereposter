# Frozen app/worker contract v1

The input top level is `{schemaVersion:1, project, inputs, provenance}`.
`project` uses project.mjs schemaVersion 1, plus `profile:easy-graphics-v1`.
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
`{"captionTiming":{"version":1,"field":"captionTimingPolicy","default":"legacy-v1","policies":["legacy-v1","trim-trailing-hold-v1"]}}`.
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
