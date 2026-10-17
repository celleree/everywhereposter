# Authenticated native editor pilot

This opt-in integration reuses the pinned Cooked engine and review document from
`tools/cooked-pilot`. It adds transport, tenant authorization, storage handoff and
small review-page adaptations. It does not provide a second editing engine.

The application is disabled unless `COOKED_EDITOR_ENABLED=true`, an absolute
`COOKED_EDITOR_SOCKET` is present, and the current organization is explicitly
listed in `COOKED_EDITOR_ORGANIZATIONS`. Ordinary app deployment leaves it off.
Every job, playback, transcript, revision and save request rechecks ownership of
the source Media row. Existing authenticated middleware and AI permissions apply.
Mutations require the application's exact Origin. Recovery only reads an opaque,
organization-scoped request receipt; reloading does not start transcription.

The source is prepared using existing storage code and probed using the existing
video editor. The current transcription configuration is English speech. Accepted input is one audio-bearing MP4/MOV, at most240 seconds,
100 MiB, 720p and30fps, with aligned timestamps. Uploading/selecting it starts
offline transcription and the native timeline/render/verification pipeline.
Eligible whole-block cut/restore operations use optimistic revisions and native review
snapshots. Saving streams a separate MP4 through the existing ordinary Media
storage interface. Download and composer handoff use that saved Media; neither
publishes a post. A failed or expired temporary session leaves the source intact.

## Rejected word edits and precision limits

The pinned tiny model's word labels are estimates. A captured synthetic short-word
cut retained vowel audio and trimmed the following consonant; existing forced
alignment also misplaced that boundary. Native frame quantization can cross
phoneme boundaries even with correct labels. A successful ASR comparison alone
is not proof of sample-accurate word removal or human speech quality.

The adapter never widens a selected word to a phrase. Audio acceptance uses the
source-plan proof below; transcript agreement cannot authorize output.
Before each trial mutation it checkpoints the verified native draft, excluding
regenerable segment caches and reserving capacity within the existing workspace
limit. A native verification rejection still returns422. Only after a complete
guarded restoration, source checks and exact prior render/review hashes does the
worker retain the previous ready state and revision. The user may discard the
pending selection and deliberately choose another edit. Rollback failure and
other native failures recover only through the same complete guarded restoration.
Rollback failure remains cleanup-only. No rejected render becomes output.

This recovery is a fallback, not a precise single-word editing claim. General
single-word accuracy still needs a validated alignment and audio-boundary solution.

## Restricted whole-block policy

Current native mode is `quiet-block-v1`. Phase1 pause trimming remains the existing
FFmpeg editor and is unchanged. This mode only removes explicitly selected complete
speech blocks with both source-time edges in verified long quiet gaps. The initial
draft retains all source frames; automatic retake/word and pause cuts are bypassed.
The native renderer, review/history and rejected-edit recovery are reused; upstream
source/model files are not patched. The repository-owned audio proof is authoritative,
and the pinned transcript verifier remains available only for explicit diagnostics.

Boundary discovery uses Phase1 Natural's minimum pause/padding, a stricter-45dB
quiet threshold and installed offline VAD, including local-gain speech veto inside
proposed gaps. Edges have100ms quiet guards and exact integer frame provenance.
The source must be at most720p/30fps, with constant frame cadence and compatible audio/video endings;
1080p/60fps multispan encoding exceeded the512MiB test cap because the pinned renderer uses parallel encoders.
Phase1 keeps its separate1080p renderer. The native limit is enforced against actual streams as well as metadata;
VFR, missing/shifted timestamps, no detected speech and unpaired tails are rejected.
This is conservative acoustic eligibility, not semantic or general word alignment.

The native-only duration contract is four minutes; Phase1 remains60seconds.
The app probe, response timestamp parser, worker frame/audio checks and request
deadlines use that contract. Source/output byte caps remain100MiB; long sources
must still satisfy720p/30fps and are not automatically normalized. Decoder padding (<=oneAAC packet plus1ms resampler flush)
is trimmed only beyond known matching A/V presentation ends;
real unmatched tails still reject. Native operations remain serialized. The
bounded per-stage deadline is180seconds, total operation600seconds, with a630second
client deadline; these are ceilings, not processing-time promises. A longer CPU
occupancy does not establish capacity on the shared production host.

### Source-plan audio proof

`cooked-audio-integrity.py verify SOURCE EDIT TRUSTED_PLAN_JSON` accepts only
`source-plan-audio-v1` with an actual source SHA-256 and exact removed block ranges.
The runtime supplies that plan from its in-memory source identity and requested
next selection. Mutable generated policies, manifests and old receipts cannot
authorize a different source or range. Incomplete proof rejects the edit.

The checker derives the retained integer frames independently from that plan,
checks the disk timeline against it, and regenerates expected AAC from the actual
source using the pinned renderer's trim, 8ms endpoint fades and one-pass AAC192k
recipe. An uncut, aligned single-track AAC draft preserves actual source packets.
Every retained audio packet payload, integer timestamp, duration and side-data,
decoder configuration, and the complete mono16k signed16 decoded waveform and
sample count must match. No correlation threshold, word-count tolerance or ASR
agreement substitutes for that proof. Source and output hashes are rechecked.

Video frame counts, dimensions, format and presentation clocks must match the
requested retained plan. Native MP4 segment movie durations round up to milliseconds
before concat; exact join offsets are derived from the trusted frame spans, with
at most1ms total A/V offset. Arbitrary timing drift is rejected. This verifies
audio provenance and A/V clocks, not independent pixel provenance after lossy
H264 encoding, semantic edit quality or a human judgment of intelligibility.

The runtime binds the bounded proof receipt to its exact request and actual cut,
captures the resulting hash before review, and rechecks both the cut and the
retained review copy served to the user after review. A failed
edit retains the previous ready revision only after complete guarded restoration.
Unsupported transformations, multiple A/V tracks and missing evidence fail closed.

Normal acceptance does not load a second ASR model. For an explicit offline
diagnostic, run `diagnose SOURCE EDIT TRUSTED_PLAN_JSON UPSTREAM_ROOT` through the
same bounded supervisor. It first reruns complete physical proof, then calls the
unchanged pinned verifier and records `asr-diagnostic.json` with
`authoritative:false`. A transcript difference cannot invalidate or replace the
physical proof; failed proof cannot reach ASR. Initial source transcription still
supplies approximate review word labels. Semantic quality remains a separate gate.

Full-duration memory and shared-host capacity remain separate activation gates.
Earlier720p multispan renders exceeded512MiB; removing repeat ASR does not prove
that every accepted source size fits the one-session worker. Local proxy or1GiB
evidence must retain its exact quality/resource scope. No resource or scratch
configuration change is authorized by this verification policy.

Job/find receipts expose `editing` with `mode`, `blocks`, `removedBlocks` and
`wordCuts:false`, `arbitraryPhrases:false`, `pauseEdits:false`. Cut requests must
exactly match a published block; restore must match a currently removed block.
Unsupported ranges return422 before mutation, preserving the previous revision.
No word/phrase request is silently expanded. Restores retain source ordering.
Final source decisions and rendered A/V durations are checked against that exact
plan before complete source-plan audio verification. Old word-selection controls do not
gain permission through this capability; UI selection wiring is not added here.

## Worker and app boundary

Build the local Python/model image using the pinned preparation instructions in
`../cooked-pilot/README.md`. Compile `cooked-editor-runtime.ts` and
`cooked-worker.ts` and their pure `video-edit-decision.ts` and `cooked-editor-limits.ts` dependencies to CommonJS using the repository TypeScript compiler. Stage
those four JS files, `cooked-editor-launcher.py`, `cooked-quiet-blocks.py`,
`cooked-audio-integrity.py`,
`worker-entry.cjs` and `worker-health.cjs` under a Docker build context's `runtime/`
directory. Build `Dockerfile.worker` with exact `NODE_BASE` and `COOKED_BASE`
image identities. No npm installation or application secrets are needed inside
the worker. The image retains the Python/model/source licenses and Node license.

The app streams only the selected source and sanitized metadata over a fixed Unix
socket. The worker has no network, public listener, Docker socket, application
credentials, application filesystem or whole-library mount. The reviewed Compose
candidate adds one private IPC directory: read-only at the app, read-write at the
worker. Its worker runs as UID 10001/GID 0; the directory must be owned by 10001:0,
mode 0710, and the socket is 0660. Existing app UID/GID must be verified for the
specific deployment; do not add group grants or relax directory permissions to
make a failing deployment work.

`docker-compose.cooked-candidate.yaml` is not loaded by the current deployment.
Its explicit organization/image/directory variables fail closed when absent.
Limits: 1 GiB RAM with no swap, two CPUs, 128 PIDs, read-only root filesystem,
all capabilities dropped, no new privileges, bounded temporary filesystems
(512 MiB work and 128 MiB tmp), and a 512 MiB per-file limit. The runtime adds
per-stage/overall deadlines and workspace/output bounds. These are pilot limits,
not evidence of capacity alongside production publishing on a 4 GiB host.

One session is retained globally, and native mutations are serialized. After
explicit close or 15 idle minutes, the entire worker exits and Docker restarts
its namespace and temporary filesystems before another session is admitted.
Readiness checks tolerate this short restart without resubmitting a native job.
An enabled organization stays in native-editor mode while the worker recovers;
it never mounts the legacy editor and automatically renders a remembered source
because of a temporary health failure.
Restarts discard temporary edit history; saved Media remains available. A lost
response is recovered by lookup, never by automatically restarting work.

The app verifies the exact upstream HTML SHA-256 before executing it and
reconstructs transcript/state JSON using bounded text and numeric fields. It
forces MP4 playback, validates response lengths/ranges, denies upstream agent,
capture, update and other unsupported routes, and removes their UI controls.
The upstream renderer, transcript report and review history remain pinned.
The restricted adapter plans explicit source blocks instead of native word snapping. Mobile layout changes keep the native transcript visible.

## Activation and rollback

Production activation is a separate action-time approval because it adds the
shared IPC capability and worker resource use. It requires the exact reviewed
app and worker image identities, one approved organization ID, the private
directory ownership/mode above, and the existing-host resource assessment. No
new VM, subscription, paid transcription or new OAuth/provider permission is
required by this implementation.

The recommended first action additionally loads `docker-compose.cooked-one-session.yaml`
(one CPU, 512 MiB memory with no swap) for one functional test with an owned
synthetic clip of at most 15 seconds at 640x360, in one explicitly allowed organization, followed by
disabling the pilot. This override also caps worker logs at two 1 MiB files.
Check upload/automatic transcription, word cut/restore,
playback, recovery, save/download and unchanged source. Do not publish, perform
a production load test or broaden the allowlist as part of this action.

Rollback removes both optional overrides and the three feature variables, recreates
the app with its prior mount/configuration and stops the worker. Retain the
previous app image for ordinary release rollback. Do not delete source/saved
Media, restore a database or recursively clean persistent storage. Temporary
drafts are disposable; they are not a backup of the source.

## Historical unrestricted-pilot acceptance evidence

The final worker completed a real authenticated API cut/restore/save/recovery
loop with one owned 10.73-second synthetic 640x360 speech clip under the
one-session limits: peak cgroup memory 254,332,928 bytes (about 243 MiB), peak
34 PIDs, 18.35 CPU seconds, and zero memory-limit or OOM events. The restored
output was byte-identical to the original render. Foreign-organization and
cross-Origin requests were denied; playback ranges, duplicate-save protection,
ordinary Media handoff and whole-worker recycling passed. Authentication and
policy code were real; membership and Media repositories were disposable
fixtures. This is a functional test, not a production capacity estimate.

Desktop Chromium, emulated phone Chromium and emulated phone WebKit passed
the complete UI flow (42.3/46.1/45.3 seconds). Desktop used the actual upload
picker; phones selected the owned fixture and used touch word selection.
Every profile recovered from one controlled state-read 503 and one transcript
read 503, then completed cut/restore, native history/Compare, range playback,
reload lookup, save/download and composer review with unchanged source hashes
and zero post writes. Browser emulation does not establish physical-phone
acceptance. The normal CI suite does not start the optional native model worker;
this opt-in browser acceptance requires the documented disposable local worker.

The historical word-selection browser results above do not establish acceptance
of the current restricted block policy or precise word-cut acoustic quality.

## Acceptance limits

Automated synthetic tests are not human transcription-quality approval,
physical-device acceptance or shared-host load acceptance. The selected tiny
model can normalize filler words, and retake proposals are suggestions, not
automatic semantic edits. Do not advertise reliable filler removal or the full
upstream caption/creative feature set from this pilot. Licensing notices and
historical model-card limitations remain in `../cooked-pilot/MODEL-NOTICES.md`.
