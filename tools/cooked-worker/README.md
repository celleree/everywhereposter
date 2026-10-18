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
video editor. The current transcription configuration is English speech. Accepted input is one audio-bearing MP4/MOV, at most 60 seconds,
100 MiB, 1080p and 60 fps, with aligned timestamps. Uploading/selecting it starts
offline transcription and the native timeline/render/verification pipeline.
Native word cut/restore operations use optimistic revisions and native review
snapshots. Saving streams a separate MP4 through the existing ordinary Media
storage interface. Download and composer handoff use that saved Media; neither
publishes a post. A failed or expired temporary session leaves the source intact.

## Rejected word edits and precision limits

The pinned tiny model's word labels are estimates. A captured synthetic short-word
cut retained vowel audio and trimmed the following consonant; existing forced
alignment also misplaced that boundary. Native frame quantization can cross
phoneme boundaries even with correct labels. A successful ASR comparison alone
is not proof of sample-accurate word removal or human speech quality.

The adapter never widens a selected word to a phrase or weakens native verification.
Before each trial mutation it checkpoints the verified native draft, excluding
regenerable segment caches and reserving capacity within the existing workspace
limit. A native verification rejection still returns422. Only after a complete
guarded restoration, source checks and exact prior render/review hashes does the
worker retain the previous ready state and revision. The user may discard the
pending selection and deliberately choose another edit. Rollback failure and
other native failures remain cleanup-only. No rejected render becomes output.

This recovery is a fallback, not a precise single-word editing claim. General
single-word accuracy still needs a validated alignment and audio-boundary solution.

## Worker and app boundary

Build the local Python/model image using the pinned preparation instructions in
`../cooked-pilot/README.md`. Compile `cooked-editor-runtime.ts` and
`cooked-worker.ts` to CommonJS using the repository TypeScript compiler. Stage
those two JS files, `cooked-editor-launcher.py`, `cooked-editor-apply.py`,
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
The upstream algorithms, transcript renderer and native cut/restore behavior
remain unchanged. Mobile layout changes keep the native transcript visible.

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

## Isolated acceptance evidence

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

## Acceptance limits

Automated synthetic tests are not human transcription-quality approval,
physical-device acceptance or shared-host load acceptance. The selected tiny
model can normalize filler words, and retake proposals are suggestions, not
automatic semantic edits. Do not advertise reliable filler removal or the full
upstream caption/creative feature set from this pilot. Licensing notices and
historical model-card limitations remain in `../cooked-pilot/MODEL-NOTICES.md`.
