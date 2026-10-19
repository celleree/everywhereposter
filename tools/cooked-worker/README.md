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
100 MiB, 720p and30fps, with aligned timestamps. After upload/selection and source
preview, the explicit Prepare video action starts offline transcription and the
native timeline/render/verification pipeline.
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

## Restricted whole-block policy

Current native mode is `quiet-block-v1`. Phase1 pause trimming remains the existing
FFmpeg editor and is unchanged. This mode only removes explicitly selected complete
speech blocks with both source-time edges in verified long quiet gaps. The initial
draft retains all source frames; automatic retake/word and pause cuts are bypassed.
The native renderer, transcript verifier, review/history and rejected-edit recovery
are reused unchanged; upstream source/model files are not patched.

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

An uncut real-speech AAC render can still fail the unchanged tiny-model transcript
verifier when a second ASR pass omits kept words. Such a rejection remains a
rejection; no acoustic comparison overrides it and no failed output is accepted.
Actual raw-footage quality and full-duration resource evidence must be checked
separately before activation.

The full117-second normalized raw fixture exceeded512MiB during verification
even with its client outside the worker cgroup. The existing512MiB one-session
override is therefore not accepted for this duration. Local1GiB evaluation is
separate from live authorization; any proposed1GiB/oneCPU configuration needs
exact image/resource receipts and fresh shared-host capacity/security review
before activation. Source, work/tmp disk and single-session limits are unchanged.

Job/find receipts expose `editing` with `mode`, `blocks`, `removedBlocks` and
`wordCuts:false`, `arbitraryPhrases:false`, `pauseEdits:false`. Cut requests must
exactly match a published block; restore must match a currently removed block.
Unsupported ranges return422 before mutation, preserving the previous revision.
No word/phrase request is silently expanded. Restores retain source ordering.
Final source decisions and rendered A/V durations are checked against that exact
plan before the unchanged transcript verifier. The pinned review UI exposes
separate whole-block controls; arbitrary word-selection editing is disabled.

## Worker and app boundary

Build the local Python/model image using the pinned preparation instructions in
`../cooked-pilot/README.md`. Compile `cooked-editor-runtime.ts` and
`cooked-worker.ts` and their pure `video-edit-decision.ts` and `cooked-editor-limits.ts` dependencies to CommonJS using the repository TypeScript compiler. Stage
those four JS files, `cooked-editor-launcher.py`, `cooked-quiet-blocks.py`,
`cooked-editor-apply.py`, `worker-entry.cjs` and `worker-health.cjs` under a Docker build context's `runtime/`
directory. Build `Dockerfile.worker` with exact `NODE_BASE` and `COOKED_BASE`
image identities. No npm installation or application secrets are needed inside
the worker. The image retains the Python/model/source licenses and Node license.

### Publication preparation only

From a clean exact-HEAD checkout with the existing locked repository dependencies:

```sh
node --test tools/cooked-worker/stage-runtime.test.cjs
node tools/cooked-worker/stage-runtime.cjs <full-reviewed-HEAD-SHA> /new/outside-repository/context
```

The helper derives sources from its own checkout, compiles the four TypeScript
files to CommonJS/ES2022, stages exactly nine runtime files and the unchanged
Dockerfile, and records the source SHA, compiler identity, input and runtime
hashes. It rejects dirty/wrong-SHA checkouts, existing output, repository-local
output, symlink escapes and compiler diagnostics. Sources are taken from the
selected SHA; runtime hashes are never frozen to an earlier candidate.

`.github/workflows/prepare-cooked-worker.yml` is manual-only and requires the exact
reviewed current canonical main SHA associated with a merged PR. Supply reviewed
immutable base digests explicitly: the model base must be under
`ghcr.io/celleree/`; Node must be official `node`/`docker.io/library/node` or under
that GHCR namespace. Tags are rejected. Missing registry identities/access are
blocked execution, not permission to rebuild or substitute bases. It uses the
unchanged Dockerfile for linux/amd64 and verifies UID10001:GID0, runtime bytes,
repository model policy, source files against the base's own manifest, and retained
notices. Approved base provenance is required: recorded source/model/notice hashes
must match that base's independent review receipt. A matching upstream pin label
in the base manifest alone does not establish source provenance. Only JSON
metadata is retained. It has contents-read permission and no registry login, push
or image upload path.

No workflow dispatch is part of this preparation change. External publication
requires separately approved registry identities and completed redistribution
review from `../cooked-pilot/README.md`, including corresponding source/notice
obligations and revision-specific model evidence. Metadata verification does not
certify redistribution clearance. Publication remains a separate approval, as do
deployment and activation through the existing GitHub → GHCR → Hetzner route.

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
Check upload/explicit preparation, whole-block cut/restore,
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

### Prepared manual activation path (execution remains gated)

`.github/workflows/cooked-pilot.yml` is manual-only, owner-dispatched and uses the
existing protected `production` environment and `production-deployment` lock.
This change prepares code; it authorizes no workflow dispatch, registry access,
SSH, deployment or activation. No accepted real production record is supplied.
Future human approval must review the underlying evidence and the exact reviewed
helper SHA; passing JSON validation or a Boolean is not evidence of acceptance.

The only supported profile is `one-session`: one owned/licensed human-speech
fixture of at most 15 seconds, exactly 640x360, in one organization, with one CPU,
512 MiB RAM, no swap and two 1 MiB worker log files. This is a functional pilot.
The product's four-minute native duration goal remains explicit; full-duration
production resource acceptance needs separate evidence and approval. The helper
has no general/full-profile switch and does not claim that goal is accepted.

Before requesting the protected action, the owner must assemble one small JSON
record. The exact schema is below (all keys required, no additional keys, duplicate
keys rejected, UTF-8 at most 16 KiB). Do not copy these descriptions as evidence:

| Key | Required value |
| --- | --- |
| `schema` | Integer `1` |
| `appSHA` | Reviewed deployed app's 40 lowercase hex commit; ancestor of helper main |
| `appImage` | `ghcr.io/celleree/publish-everywhere-postiz@sha256:` plus 64 lowercase hex |
| `workerImage` | Reviewed `ghcr.io/celleree/publish-everywhere-cooked-worker@sha256:` plus 64 lowercase hex |
| `organizationId` | One exact ID, 1–128 letters/digits/underscore/hyphen; no comma/wildcard |
| `ipcDirectory` | Existing absolute canonical path using letters/digits/underscore/hyphen/slash; no repeated slash, dot segment or symlink component |
| `profile` | Literal `one-session` |
| `sourceNoticeEvidence` | SHA256 of owner-reviewed source/notice delivery and redistribution disposition evidence |
| `nonproductionEvidence` | SHA256 of exact-image authenticated restricted-block nonpublishing acceptance evidence, including named Chromium/WebKit mobile-browser evidence; physical hardware is supplemental |
| `resourceEvidence` | SHA256 of owner-reviewed exact-image one-session shared-host capacity/security assessment |
| `fixture` | Object with exactly `sha256` (64 lowercase hex), `owned:true`, `durationSeconds` (number >0 and <=15), `width:640`, `height:360` |

Evidence artifacts must identify the reviewed app/worker digests, organization,
profile and fixture where applicable; the record binds them by checksum, but the
helper does not fetch or certify them. The owner must inspect the corresponding
artifacts and retain their relationship to this record. Offline fixtures in the
test suite are synthetic records, never production acceptance receipts.

Supply the exact JSON bytes as the workflow's `acceptance_json` input and their
SHA256 as `acceptance_sha256`; values enter shell steps only through environment
variables. For local *validation only*, set `COOKED_ACCEPTANCE_JSON` and
`COOKED_ACCEPTANCE_SHA256`, then run `bash scripts/cooked-pilot.sh validate`.
Validation emits `RECORD_VALID_ONLY` without host admission or runtime calls.
The workflow's `source_sha` identifies the helper's reviewed current main commit,
which can differ from `appSHA`. It requires merged same-repository PR provenance
and successful existing PR CI on the exact identical merged Git tree (reporting
its separate CI head SHA), or successful existing manual CI at that exact main
SHA. The deployed app also needs a successful main app-image build for `appSHA`.
No CI dispatch is performed automatically.

Execution requires the existing production checkout already clean on exact
`source_sha` and synchronized with its recorded `origin/main`; the helper never
fetches, checks out, repairs or deploys another app version. Both immutable images
must already exist locally with exact RepoDigests and linux/amd64 identity. The
local full-app-SHA tag, existing runtime tag and running healthy `postiz` image ID
must all equal the approved app digest's image ID. Missing images, stale checkout
or mismatches stop; there is no pull/build/login/retag/migration fallback. Publishing
or staging absent images is separately approved work.

The IPC directory must already exist as a nonsymlink directory owned by 10001:0,
mode 0710. The helper checks the actual app's numeric UID and groups for traversal
and socket access; it grants nothing. Activation requires at least two logical
CPUs and 1 GiB currently available RAM; these capacity guards do not block a
separately authorized disable. This conservative admission guard is not
sustained-capacity proof. Resource/security evidence and underlying human review
remain required. Missing path/ownership/capacity must stop for separate scope;
there is no mkdir/chown/chmod/path normalization or automatic provisioning.

Before host admission, the helper takes a nonblocking exclusive lock on the
existing checkout directory inode, held until exit. Contention refuses immediately;
no lockfile or directory is created. Workflow concurrency additionally coordinates
with ordinary deployments. Direct operators must not bypass either action path.

`activate` starts only the owned worker with the existing base plus candidate and
one-session Compose overrides, waits for healthy hardened worker identity, then
recreates only the same verified app image with `--no-deps --no-build --pull never`.
It verifies configuration, mount and health, then tests/reloads the existing public
nginx process so it resolves the recreated app. No proxy recreation is attempted.
A duplicate activation with matching healthy state reports `ALREADY_ENABLED` and
preserves the session. A verified stopped owned worker may restart with
`--no-recreate`; a running orphan worker while the app is off is refused.
Do not perform ordinary app deployment while the pilot is enabled.

After the approved nonpublishing authenticated check (upload, explicit preparation,
whole-block cut/restore, playback, recovery, save/download and unchanged source),
request a separate manual `disable` action using the same reviewed record. Disable
recreates the same app image with only base Compose configuration, confirms feature
off and no IPC mount, reloads nginx, then stops the matching owned worker. It never
removes containers, IPC, source or saved Media. Stopping the worker discards its
temporary edit session; retain saved output before explicitly requesting disable.
No automatic rollback, retry or cleanup hides a failure. A failure after mutation
reports `FAILED_PARTIAL_STATE_POSSIBLE` with its phase: app recreation, proxy reload
or worker stop may be incomplete. Inspect safe identity/health facts and obtain a
separate approved repair action; never blindly redispatch. No logs, raw environment,
full Docker inspect, credentials or customer content are collected.

The successful activation receipt is `ENABLED_ACCEPTANCE_PENDING` with
`productAcceptance:NOT_RUN`. It establishes only the checked runtime/configuration
state. Authenticated human acceptance, named Chromium/WebKit mobile-browser evidence, source integrity,
no publishing and shared-host behavior must be recorded separately. Offline tests
cannot prove production readiness or any of those outcomes.

Offline checks (no actual SSH, Docker or network commands):
`node --test scripts/cooked-pilot.test.cjs` and `bash -n scripts/cooked-pilot.sh`.
Review order: record/provenance gates, action-time identity/ownership admission,
mutation/partial-failure ordering, then fixtures, the added PR-CI test command and documentation. The coherent
five-file change exceeds the preferred 400-line guideline because an independently
usable mutation path without its fail-closed gates and offline fixtures would be
unsafe; it adds no dependencies or changes to ordinary deployment.
