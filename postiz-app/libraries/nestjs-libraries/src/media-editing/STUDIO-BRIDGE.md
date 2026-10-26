# Studio app binding

Local source implementation; disabled unless explicitly configured. Linux runtime,
SQL, genuine Jest, browser and joined upload acceptance remain separate gates.
No production migration, deployment or activation is implied.

The imported creative package is the unchanged e65979bd history. It consumes a
trusted authored manifest, not an arbitrary upload or a prompt. `renderApproved`
is an internal method, with no public manifest/path or execution endpoint. The
upstream producer must supply timed words/captions, approved cuts, aligned audio,
observed single-speaker framing, registered visuals and source-driven effects.
This binding does not call a model, transcribe, detect faces or run Cooked. New
uploads cannot initiate this creative path until that producer is integrated.
Standard and Cooked remain separate existing editor paths.

## Worker contract

Admit organization-owned media through `StudioEditService.admit`. Call internal
`renderApproved(org, jobId, {manifest, assetMediaIds})` from a trusted worker.
`assetMediaIds` maps each project asset to an admitted source/B-roll Media row;
all selected destinations require explicit matching safe-zone profiles. Initial
scope is a source of at most 60 seconds, eight visual inputs and 100 MiB per
materialized input/output. These are new Studio limits, not app-wide capacity
claims. EasyMediaPanels uses still images; there is no implicit video-to-still
extractor. No proxy/source-clock conversion or invented focal metadata.

Operator-only configuration: `STUDIO_EDITOR_ENABLED=true`, comma-separated
`STUDIO_EDITOR_ORGANIZATIONS`, absolute `STUDIO_EDITOR_PACKAGE_ROOT`,
`STUDIO_EDITOR_RUNTIME` and `STUDIO_EDITOR_WORK_ROOT`. Package config requires
its locked node_modules, exact Node/Python/browser/FFmpeg/FFprobe and lock paths.
The app work root must retain upstream hashed aligned audio/font/Cooked evidence
and job directories for later verification/recovery. Do not commit local paths.
No configuration is changed by this code. Package render-cache requires its
existing writable runtime cache arrangement; production packaging is not proven.

The adapter preserves originals, stages and hashes copies, records immutable
plan/manifest identity, and uses only prepare.py, run.mjs validate/render, qa.py
and receipt-bindings.mjs. No shell or inherited provider secrets. Linux process
groups have bounded time/output; deployment still requires independently bounded
offline memory/disk/network runtime. This source does not install that runtime.

An exclusive durable dispatch marker prevents concurrent or uncertain duplicate
commands. After a crash, repeat with the identical plan only recovers a fully
verifiable existing final. Incomplete/uncertain artifacts remain retained and
fail closed; there is no automatic lock stealing, overwrite or new render.
This slice intentionally has no operator recovery UI or cleanup policy.

## Review and storage

Current runtime/source/font/input bindings, render/QA receipts and final bytes
must match. Immutable storage is verified again before preview/review. Technical
PASS remains `creativeApproval:PENDING`. The authenticated local-editor routes
list/get/cancel jobs and approve an exact generation/hash; client paths, receipts
and executable choices are never accepted. No creation/dispatch HTTP route is
exposed while trusted authoring is missing.

The existing editor shows organization-scoped recent Studio results. Review is
bound to the displayed job/generation/hash, requires watch/listen confirmation,
and atomically creates one Media row. Concurrent/repeated approval or response
loss returns that same active row; deleted output does not recreate another.
The composer receives only the reviewed saved derivative. Opening it does not
publish or alter another saved draft. Profile IDs and provisional/ad-derived
limitations remain visible; technical geometry is not creative approval.

Two additive migrations now proposed (19 total); neither applied here. Original
17 and the previous staging migration are preserved. Source/output Media and
organization references use RESTRICT and retained input JSON covers B-roll;
cleanup must protect these references. No retention/deletion behavior changed.

## Acceptance remaining

Run new studio-bridge, studio-editor.integration, studio-storage and updated
media.controller.video-edit suites with existing disposable PostgreSQL. Generate
Prisma and apply all 19 migrations; require all six Studio DB cases to execute,
including real concurrent review and worker JSON-null binding. Preserve wallet,
billing, upload/storage, Standard/Cooked and all three typechecks.

Joined Linux acceptance must stage its own explicit runtime and generate fresh
Linux receipts: upload owned video/visuals -> admit -> trusted authored plan ->
real creative worker -> receipt acceptance -> preview/listen -> explicit review
-> one saved Media -> composer. Exercise refresh/repeated approval, response
loss, source deletion, cancellation/stale generation, tampering and runtime drift.
Windows sample/receipt checks do not establish this joined journey.
