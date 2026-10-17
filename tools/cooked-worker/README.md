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
video editor. Accepted input is one audio-bearing MP4/MOV, at most 60 seconds,
100 MiB, 1080p and 60 fps, with aligned timestamps. Uploading/selecting it starts
offline transcription and the native timeline/render/verification pipeline.
Native word cut/restore operations use optimistic revisions and native review
snapshots. Saving streams a separate MP4 through the existing ordinary Media
storage interface. Download and composer handoff use that saved Media; neither
publishes a post. A failed or expired temporary session leaves the source intact.

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

The recommended first action is one functional test with an owned synthetic
clip of at most 15 seconds, in one explicitly allowed organization, followed by
disabling the pilot. Check upload/automatic transcription, word cut/restore,
playback, recovery, save/download and unchanged source. Do not publish, perform
a production load test or broaden the allowlist as part of this action.

Rollback removes the optional override and three feature variables, recreates
the app with its prior mount/configuration and stops the worker. Retain the
previous app image for ordinary release rollback. Do not delete source/saved
Media, restore a database or recursively clean persistent storage. Temporary
drafts are disposable; they are not a backup of the source.

## Acceptance limits

Automated synthetic tests are not human transcription-quality approval,
physical-device acceptance or shared-host load acceptance. The selected tiny
model can normalize filler words, and retake proposals are suggestions, not
automatic semantic edits. Do not advertise reliable filler removal or the full
upstream caption/creative feature set from this pilot. Licensing notices and
historical model-card limitations remain in `../cooked-pilot/MODEL-NOTICES.md`.
