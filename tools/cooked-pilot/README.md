# Local cooked. container candidate

This directory is an opt-in local acceptance package. Nothing adds it to the app Dockerfile, Compose, CI, deployment, public routes or production. It is a single-command fixture runner, not an installed background service or production job dispatcher.

## Package contents

- Official Python 3.12 slim Bookworm base, resolved for the pilot to `python@sha256:34386ef0cb081344d7ec1c103ba398e6e9f64e9ab3a1509accc92a4e24a07258`.
- FFmpeg, fontconfig and DejaVu from Debian. Package repository state is not pinned; a rebuild can produce a different image and needs its own receipt.
- 23 hash-locked Linux x86_64 / CPython 3.12 wheels, headed by faster-whisper 1.2.1. Build-time pip uses only supplied local wheels and checks dependencies.
- Unchanged authored Python/HTML/JS core and cut scripts from cooked. `bce911c1d0652f30b64fd5283cc4aa9fa92811c9`, four caption-preset JSON files needed by native imports, and the native caption planner/exporter. A source hash manifest and MIT notice travel with the image.
- Four pre-downloaded tiny-model files, individually SHA-256 checked by `prepare.py`; no model downloader runs during editing. See `MODEL-NOTICES.md` and the source manifest for provenance.

`prepare.py` requires a clean tracked upstream checkout at the exact pin, vetted model files, supplied wheels, and a new context directory. Generated contexts, wheels, models, fixtures, logs and outputs belong outside this repository.

## Local use

Resolve the official base to a digest locally. Supply the wheel files matching `requirements.lock`; any byte mismatch makes pip fail. Then:

```sh
python3 tools/cooked-pilot/prepare.py --upstream /path/to/pinned/cooked \
  --model /path/to/vetted/tiny --wheels /path/to/wheels --context /new/build/context
docker build --build-arg BASE_IMAGE=python@sha256:34386ef0cb081344d7ec1c103ba398e6e9f64e9ab3a1509accc92a4e24a07258 \
  -t ep-cooked-local:pilot /new/build/context
sh tools/cooked-pilot/run-local.sh ep-cooked-local:pilot /owned/source.mp4 /new/output
# Optional cut/restore acceptance: add the exact raw-source start/end seconds.
```

The runner requires the local Unix Docker endpoint and a daemon identifying as this host. It uses a unique label and removes only the container it just created. It preserves the original source and output directory. No image is pushed and no persistent Docker volume is created.

## Runtime boundary

Networking is disabled; no ports, credentials, app files or Docker socket are mounted. The image root is read-only, all capabilities are dropped and new privileges are forbidden. The only input mount is one read-only source file. The only persistent output mount is a new private directory holding the final MP4 and acceptance evidence. Intermediate files and native draft history live in a temporary 512 MiB filesystem and disappear with the container.

Limits: 1 GiB container memory with swap allowance equal to memory, two-CPU quota, 128 PIDs, 512 MiB per-file limit, 128 MiB `/tmp`, 512 MiB `/work`, 60 seconds per native command, 245-second outer deadline, and an 8 MiB foreground-log limit. The runner overrides the image's unprivileged UID with the invoking local UID so outputs remain owned by that user; do not invoke it as root. The operating system's Docker daemon remains trusted infrastructure. This is not a sandbox for arbitrary untrusted programs.

The image independently probes the input limits: audio, known approximately zero start timestamps, at most 60 seconds / 100 MiB / 1920 by 1080 dimensions in either orientation / 60 fps. These bounds do not establish real-world quality or worst-case capacity.

## Measured local acceptance

The final local image ID was `sha256:3d118a94c192655d02f186449f00d41a48a4f896cb93850006139dcba4b3a9d3`; Docker reported 566,750,035 bytes. Installed Python packages occupied approximately 443 MiB, the model 75 MiB and the selected upstream source 2 MiB. Build cache, wheel downloads and temporary contexts require additional disk space.

| Owned synthetic fixture | Operation | Elapsed | Cgroup memory peak | CPU use | Result |
| --- | --- | --- | --- | --- | --- |
| 10.73 s, 640 by 360, 25 fps | Transcribe, render, verify, three-word cut, restore, three review drafts | 14.531 s | 264.1 MiB | 16.18 CPU seconds | PASS; restored MP4 byte-identical to first render |
| 59.8 s, 1920 by 1080, 60 fps | Transcribe, pause trim, render, verify, initial review | 69.534 s | 836.2 MiB | 121.57 CPU seconds | PASS; 59.30 s output |

Both had zero OOM events, preserved the source and made no paid calls. The long fixture repeats synthetic speech over a solid-color picture. It does not establish motion-heavy encoding capacity, fidelity on human speech, filler removal, mobile UI or signed-in app acceptance. The first trimmed source bundle failed because the native profile import requires caption presets; including those unchanged JSON files resolved it.

## Licenses and exclusions

cooked. authored source and faster-whisper are MIT. The current Systran tiny-model card labels its conversion MIT; the exact historical model README was unavailable, so the underlying OpenAI Whisper notice and that limitation are retained in `MODEL-NOTICES.md`. No blanket license certification is claimed.

The wheel closure also includes Apache, BSD, PSF and MPL components (notably certifi and tqdm), plus PyAV's bundled codec libraries. Debian FFmpeg/codecs and fonts have separate notices/terms. Bundled package notices remain installed and Debian copyright files are retained. Complete image redistribution/source-offer obligations need review before publishing an image externally. Excluded: noncommercial CrisperWhisper, Scribe/paid APIs, Remotion, GSAP, matting, downloaded creator assets, music and remote capture.

## Exact production decision still needed

Local preparation, builds and isolated tests are covered by the existing implementation authorization. The original package pilot proved standalone execution. The authenticated gateway, private worker and native review UI are now implemented but disabled by default; see `../cooked-worker/README.md`. Ordinary app release does not install the model or activate production worker infrastructure.

A production deployment would add a resource-limited worker on the existing host, not a new VM, GPU, paid ASR service or hosted queue. Activation still needs an explicit decision on the reviewed private Unix IPC bind, organization allowlist and worker resource limits. The worker supplies no app Docker socket, shared job queue, new credentials, public listener or firewall change. That isolation/dispatch integration is a consequential architecture/security change; ordinary app deployment authorization does not silently activate it.

Expected new provider/subscription charge for this local-model path: none. It consumes existing CPU, RAM and disk. The shared 4 GiB production host has not passed combined-load acceptance; if it cannot fit one bounded job safely, any paid capacity change needs a separate price/scope decision. A 1 GiB limit is a ceiling, not a reservation or proof of available host headroom. No dollar estimate is invented from the synthetic CPU measurements.

Before activation: complete exact-HEAD independent review of the worker transport and tenant boundary, then approve the exact image, private IPC capability, one organization and bounded functional test. The app integration now preserves global single-session admission, source ownership, revision checks, mobile controls, retained-session lookup and whole-worker cleanup. Its disposable acceptance fixtures do not establish physical-device usability, human speech quality or production combined-load capacity.
