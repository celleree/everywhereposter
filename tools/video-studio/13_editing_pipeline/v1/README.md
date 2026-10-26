# Accessible Studio package: easy-graphics-v1

This isolated package adapts the actual approved Easy CSS/SVG composition into two
source-driven registered effects. It is not the private DynamicChecklist or
ImageCollage implementation, and does not claim visual equivalence to them.
Historical validator tests remain to preserve earlier protections; rendering is
explicitly limited to `easy-graphics-v1`.

## Boundary and ownership

The app owns upload authorization, private object storage, revision persistence,
job scheduling, trusted worker-local materialization and publication. This package
owns manifest preparation, a shared Player/export composition and technical QA.
It consumes an already directed, source-ordered EDL and already aligned audio and
words. It does not autonomously transcribe, call a paid model, select a new story,
fetch network footage, run Cooked, publish, or introduce a new app editor.

Keep this package together: profile, measured effects, asset preparation, runtime
identity, acceptance checks and tests form one coherent runnable boundary. The
preserved pilot import is a separate commit from this adaptation.

## Runtime

Use Node 22.12+, Python 3.12, FFmpeg/ffprobe with H.264/AAC and an explicitly
configured compatible Chrome/Chrome Headless Shell. JavaScript dependencies are
pinned in package-lock.json (Remotion 4.0.530, React 19.0.0, esbuild 0.28.1).
Install locally using `npm ci --ignore-scripts --no-audit --no-fund`; no global
installation is required. Python pins are in requirements.txt. NumPy is required
by QA; Pillow is only required by the fixture/contact-sheet harness.

Copy runtime-config.example.json to an untracked worker-local file. Set absolute
local paths for nodeExecutable, pythonExecutable, browserExecutable,
ffmpegExecutable, ffprobeExecutable, nodeModulesRoot, lockfilePath. Set the two
private effect roots to null. nodeModulesRoot and lockfilePath must belong to this
package; running Node/Python must match the configuration. No executables,
credentials, environment injection or network locations are accepted in a manifest.
The old metadata-only runtime-preflight remains informational and reports absent
legacy roots; `run.mjs validate` is the accessible-profile runtime/input gate.

The Windows owned fixture has rendered measured stills. Linux must execute the
same install/prepare/render/QA flow before worker readiness can be claimed. No
Windows binary or node_modules directory belongs in a Linux worker image.

## Manifest contract v1 (frozen)

See CONTRACT.md for full fields and effect shapes. INPUT.json is:

```json
{
  "schemaVersion": 1,
  "project": "<a Studio project object, not a filename>",
  "inputs": {
    "assets": [{"id":"source","path":"/worker/owned/source.mp4","sha256":"<64 lowercase hex>"}],
    "audio": {"path":"/worker/owned/aligned.wav","sha256":"<64 lowercase hex>","timeline":{"sourceSha256":"<original hash>","fps":30,"cuts":[[0,180]]}},
    "font": {"path":"/worker/fonts/Body-Bold.ttf","sha256":"<font hash>"}
  },
  "provenance": {"origin":"approved-edl","originalSourceSha256":"<original hash>","proxy":null,"cooked":null}
}
```

The JSON above is a SHAPE EXAMPLE, not runnable media evidence. The generated
owned fixture and two generated synthetic fixtures below produce complete actual
project objects. Project validation retains every supplied word exactly once in
caption groups, ordered source-frame cuts, registered assets, narration anchors,
observed face bounds and selected safe-zone profiles. Directed wording is not
silently rewritten. The worker must supply trusted, reviewed words and cuts.

Input paths are privileged worker-internal paths, not user-submitted browser
paths. The app must materialize only authorized project assets into an isolated
job workspace. Hashes and local-file checks are custody checks, not authorization
or a replacement filesystem sandbox. Files over 2 GiB and direct symlinks are
rejected. Local parent path junctions are not an independent trust boundary.

Preparation probes video type, dimensions, duration, average rate and the exact
original frame count. Originals must use the composition frame rate. No preview
proxy is enabled: previewFile/non-null proxy is rejected rather than accepted
with an invented source-clock mapping. A post-edit source-cut.mp4 is not an
original. Aligned audio must already match the complete cut timeline; preparation
decodes it to PCM without gain, EQ, normalization, denoising or reordering.
Render encodes that PCM once to 256k AAC; video chunks have no audio.

## Commands and artifacts

Run from this directory, using configured Node/Python:

```text
python prepare.py --manifest INPUT.json --output NEW_PROJECT --runtime RUNTIME.json
node run.mjs validate PROJECT --runtime RUNTIME.json
node run.mjs stills PROJECT --runtime RUNTIME.json
node run.mjs render PROJECT --runtime RUNTIME.json
python qa.py PROJECT --runtime RUNTIME.json
node run.mjs serve PROJECT --runtime RUNTIME.json
```

Preparation creates NEW_PROJECT exclusively. It never overwrites another revision;
a failed partial directory is preserved for diagnosis. Render preserves any
existing final and fails rather than overwriting it. Exit 0 means that command
passed, exit 1 means preparation/runtime/render/QA failure; Python argparse usage
errors exit 2. A successful render alone is not an accepted output.

Fixed artifacts: project.json, prepare-receipt.json, public/assets/*,
public/font.ttf, public/speech.wav, render-receipt.json, final.mp4,
qa/final-verification.json. Key-frame PNGs are optional review artifacts in qa/.
A failed command does not create an accepted receipt; do not infer readiness from
an existing filename. The loopback preview gates the download against current
bindings and receipt hashes. It is a local review tool, not a hosted multi-user
app endpoint.

QA performs complete decode, dimensions/frame count/duration/codec checks,
aligned-audio correlation and per-second continuity checks, original/staged
asset verification, runtime/source/font bindings, and sampled unchanged-picture
SSIM where graphics do not cover it. Captions and effects are measured in Chrome
before frames are released; fixed geometry with opacity-only reveals makes those
bounds invariant through an effect. Text fails if unreadable at the fixed font
size. Image panels use contain inside measured cards. Observed face protection
is not automatic tracking. Focal coverage warnings still require review.

QA technical PASS is distinct from creative approval. No continuous human
listening is claimed. Do not gate posting or a user approval UI solely on the
preview download's technical-ready flag.

## Verification fixtures

```text
node --test tests/*.test.mjs
node make-synthetic-fixtures.mjs RUNTIME.json /worker/fonts/Body-Bold.ttf NEW_FIXTURE_DIRECTORY
```

The synthetic generator creates two unrelated complete 6-second projects with
local test patterns/tones, flow versus exchange, and one versus two image panels.
Run validate/stills/render/QA for each generated project. These are runtime tests,
not evidence of speech transcription or creative acceptance.

For the existing owned acceptance only:

```text
python make-owned-fixture.py EXISTING_EASY_SAMPLE_ROOT ABS_FFMPEG ABS_FFPROBE ABS_NODE
python prepare.py --manifest owned.local.json --output projects/NEW_OWNED_REVISION --runtime runtime.local.json
```

The harness reuses the verified approved source cuts/words/audio, registered owned
B-roll and extracted stills. It never commits them. It is a test harness for the
already owned Easy fixture, not the production asset resolver. See
SOURCE-RUNTIME-MANIFEST.md for custody and font licensing.
