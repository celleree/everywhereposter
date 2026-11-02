"""Private, deliberately incomplete observations around the pinned native transcriber."""
import hashlib
import builtins
import dataclasses
import inspect
import math
import stat
import json
import os
from pathlib import Path
import runpy
import subprocess
import sys
import tempfile
from fractions import Fraction
import wave

PIN = "bce911c1d0652f30b64fd5283cc4aa9fa92811c9"
SCRIPT_SHA = "9964a0bb316e75d666cce6b2f7ebe7d5414b6e3d293c38c8cd22d77e5dd2102e"
MAX = 256 * 1024
MAX_PCM = 16000 * 240 * 4
MODEL_FILES = ("model.bin", "config.json", "tokenizer.json", "vocabulary.txt")


def digest(file):
    h = hashlib.sha256()
    with open(file, "rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def unknown(reason):
    return {"state": "unknown", "reason": reason}


def bounded_command(args):
    # Bound bytes retained even for an unexpectedly large probe. The existing
    # stage supervisor owns subprocess time/resource limits and the process group.
    with subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL) as proc:
        data = proc.stdout.read(64 * 1024 + 1)
        if len(data) > 64 * 1024:
            proc.kill()
            raise ValueError("probe limit")
        if proc.wait() != 0:
            raise ValueError("probe failed")
    return data


def probe(source):
    try:
        raw = bounded_command(["ffprobe", "-v", "error", "-select_streams", "a",
            "-show_program_version", "-show_entries",
            "program_version=version:stream=index,codec_name,sample_rate,channels,time_base,start_pts,start_time",
            "-of", "json", str(source)])
        payload = json.loads(raw)
        streams = payload.get("streams", [])
        if not isinstance(streams, list) or len(streams) > 32:
            raise ValueError("stream limit")
        fields = ("index", "codec_name", "sample_rate", "channels", "time_base", "start_pts", "start_time")
        candidates = [{key: item.get(key) for key in fields} for item in streams]
        origin = unknown("missing-rational-source-origin")
        if len(candidates) == 1:
            stream = candidates[0]
            try:
                timebase = Fraction(stream["time_base"])
                if timebase <= 0 or not isinstance(stream["start_pts"], int):
                    raise ValueError("unknown PTS")
                value = stream["start_pts"] * timebase
                origin = {"numerator": value.numerator, "denominator": value.denominator,
                          "basis": "source-presentation-PTS-only"}
            except (TypeError, ValueError, ZeroDivisionError):
                pass
        return {"state": "observed", "sha256": hashlib.sha256(raw).hexdigest(),
                "toolVersion": payload.get("program_version", {}).get("version"),
                "candidates": candidates, "selectedStream": candidates[0] if len(candidates) == 1
                else unknown("audio-stream-selection-ambiguous"), "presentationOrigin": origin}
    except (OSError, ValueError, TypeError):
        return unknown("source-probe-unavailable-or-out-of-bounds")


# Separate from the 64KiB aggregate options budget: the pinned local model is ~75MiB.
def model_files(directory, *, require_model=True):
    directory = Path(directory)
    if not directory.is_dir():
        if require_model:
            raise ValueError("nonlocal-model")
        return {name: None for name in MODEL_FILES}
    if require_model and directory.is_symlink():
        raise ValueError("nonlocal-model")
    def identity(info):
        return (info.st_dev, info.st_ino, info.st_mode, info.st_size, info.st_mtime_ns, info.st_ctime_ns)
    def path_identity(file):
        try:
            return identity(file.lstat())
        except FileNotFoundError:
            return None
    # Bound the scan once, then revalidate every pathname; never retry model-file hashing.
    initial = {name: path_identity(directory / name) for name in MODEL_FILES}
    result, total = {}, 0
    for name in MODEL_FILES:
        file = directory / name
        if (not file.exists() and not file.is_symlink()) or (not require_model and
                (not file.is_file() or file.is_symlink())):
            result[name] = None
            continue
        with open(file, "rb", opener=lambda path, flags: os.open(path, flags | os.O_NOFOLLOW | os.O_NONBLOCK)) as stream:
            before = os.fstat(stream.fileno())
            if identity(before) != initial[name]:
                raise ValueError("model-path-changed")
            total += before.st_size
            if not stat.S_ISREG(before.st_mode) or total > 512 * 1024 * 1024:
                raise ValueError("model-limit")
            h, count = hashlib.sha256(), 0
            while chunk := stream.read(1024 * 1024):
                count += len(chunk)
                if count > before.st_size:
                    raise ValueError("model-mutated")
                h.update(chunk)
            after = os.fstat(stream.fileno())
            if count != before.st_size or identity(before) != identity(after):
                raise ValueError("model-mutated")
            result[name] = h.hexdigest()
    if initial != {name: path_identity(directory / name) for name in MODEL_FILES}:
        raise ValueError("model-path-changed")
    if require_model and result["model.bin"] is None:
        raise ValueError("missing-model")
    return result


def binding(value, *, returned_options=False):
    # Only bounded primitives/containers/dataclasses. No repr, arbitrary iteration or audio paths.
    budget = [8192, 65536]
    def clean(v, depth=0, path=()):
        if type(v) is str and len(v) > 65536:
            raise ValueError("options-limit")
        budget[0] -= 1
        budget[1] -= len(json.dumps(v, ensure_ascii=True)) if type(v) is str else 8
        if budget[0] < 0 or budget[1] < 0 or depth > 12:
            raise ValueError("options-limit")
        # This SDK field uses +inf for an unbounded duration; retain its value in strict JSON.
        if returned_options and path == ("vad_options", "max_speech_duration_s") and type(v) is float and v == math.inf:
            return {"$sdkNumber": "positive-infinity"}
        if v is None or type(v) in (str, bool, int, float):
            if type(v) is str and len(v) > 65536 or type(v) in (int, float) and (not math.isfinite(v) or abs(v) > 2**53 - 1):
                raise ValueError("unsupported-scalar")
            return v
        if dataclasses.is_dataclass(v) and not isinstance(v, type):
            if len(dataclasses.fields(v)) > 1024:
                raise ValueError("options-limit")
            v = {f.name: getattr(v, f.name) for f in dataclasses.fields(v)}
        if type(v) is dict and "$sdkNumber" in v:
            raise ValueError("reserved-observation-tag")
        if type(v) in (list, tuple) and len(v) <= 1024:
            return [clean(x, depth + 1, path + (str(i),)) for i, x in enumerate(v)]
        if type(v) is dict and len(v) <= 1024 and all(type(k) is str and len(k) <= 1024 for k in v):
            budget[1] -= sum(len(json.dumps(k, ensure_ascii=True)) for k in v)
            return {k: clean(v[k], depth + 1, path + (k,)) for k in sorted(v)}
        raise ValueError("unsupported-options")
    data = json.dumps(clean(value), sort_keys=True, separators=(",", ":"), ensure_ascii=True, allow_nan=False)
    raw = data.encode("utf-8")
    if len(raw) > 65536:
        raise ValueError("options-limit")
    return {"canonicalUTF8": data, "byteCount": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}


class NativeObserver:
    def __init__(self):
        self.models, self.calls, self.restores, self.checks = [], [], [], []
        self.used, self.failed = 0, False
        self.wav_path, self.wav_sha, self.decoders, self.pcm_bytes = None, None, [], 0

    def capture(self, value, *, returned_options=False):
        result = binding(value, returned_options=returned_options)
        self.used += result["byteCount"]
        if self.used > 65536:
            raise ValueError("aggregate-options-limit")
        return result

    def degrade(self):
        self.failed = True

    def wav_digest(self, path):
        with open(path, "rb", opener=lambda p, f: os.open(p, f | os.O_NOFOLLOW | os.O_NONBLOCK)) as stream:
            before = os.fstat(stream.fileno())
            if not stat.S_ISREG(before.st_mode) or before.st_size > MAX_PCM:
                raise ValueError("input-limit")
            h, count = hashlib.sha256(), 0
            while chunk := stream.read(min(1024 * 1024, MAX_PCM + 1 - count)):
                count += len(chunk)
                if count > MAX_PCM:
                    raise ValueError("input-limit")
                h.update(chunk)
            after = os.fstat(stream.fileno())
            if count != before.st_size or any(getattr(before, k) != getattr(after, k) for k in
                    ("st_dev", "st_ino", "st_mode", "st_size", "st_mtime_ns", "st_ctime_ns")):
                raise ValueError("input-mutated")
            return h.hexdigest()

    def decoded_call(self, original, call, package, input_audio, *args, **kwargs):
        # The pinned SDK decodes eagerly in transcribe's globals. Never wrap or
        # consume its lazy segments, patch installed files, or retry inference.
        observation = unknown("decoder-not-intercepted")
        namespace = getattr(getattr(original, "__func__", original), "__globals__", {})
        decoder = namespace.get("decode_audio")
        restored, count = False, 0
        def decoded(*positional, **keywords):
            nonlocal observation, count
            count += 1
            before = None
            try:
                bound = inspect.signature(decoder).bind(*positional, **keywords)
                bound.apply_defaults()
                audio = bound.arguments["input_file"]
                if (type(audio) is not str or type(input_audio) is not str or audio != input_audio or self.wav_path is None or
                        Path(audio) != self.wav_path or Path(audio).stat().st_size > MAX_PCM):
                    raise ValueError("unbound-input")
                before = self.wav_digest(audio)
                if before != self.wav_sha:
                    raise ValueError("input-mutated")
            except Exception:
                before = None
            result = decoder(*positional, **keywords)  # Native decoder errors propagate exactly once.
            try:
                if count != 1:
                    raise ValueError("multiple-decodes")
                np = sys.modules.get("numpy")
                rate = bound.arguments["sampling_rate"]
                if (before is None or self.wav_digest(audio) != before or
                        decoder.__module__ != "faster_whisper.audio" or
                        type(rate) is not int or not 0 < rate <= 192000 or bound.arguments["split_stereo"] is not False or
                        np is None or type(result) is not np.ndarray or result.dtype.str != "<f4" or
                        result.ndim != 1 or not result.flags.c_contiguous or not 0 < result.nbytes <= MAX_PCM or
                        self.pcm_bytes + result.nbytes > 64 * 1024 * 1024):
                    raise ValueError("unsupported-or-unbound-decoder-buffer")
                self.pcm_bytes += result.nbytes
                # memoryview avoids a PCM copy. Bound every hashed window and the aggregate.
                view, h = memoryview(result).cast("B"), hashlib.sha256()
                for start in range(0, len(view), 1024 * 1024):
                    h.update(view[start:start + 1024 * 1024])
                observation = {"state": "observed", "callId": call["id"], "modelId": call["modelId"],
                    "inputWavSha256": before, "sampleRate": rate, "dtype": result.dtype.str,
                    "shape": list(result.shape), "sampleCount": result.size, "byteCount": result.nbytes,
                    "bufferSha256": h.hexdigest(), "implementation": "faster_whisper.audio.decode_audio",
                    "codeSha256": digest(inspect.getfile(decoder)), "sdkVersion": package.__version__,
                    "avVersion": sys.modules["av"].__version__, "numpyVersion": np.__version__,
                    "origin": unknown("SDK-discards-frame-PTS"), "resamplingMap": unknown("mapping-not-observed")}
            except Exception:
                observation = unknown("decoder-input-buffer-or-instrumentation-uncertain")
            return result
        try:
            if call is not None and callable(decoder):
                namespace["decode_audio"] = decoded
                restored = True
        except Exception:
            observation = unknown("decoder-instrumentation-unavailable")
        try:
            return original(*args, **kwargs)
        finally:
            if restored:
                namespace["decode_audio"] = decoder
            try:
                if observation.get("state") == "observed" and self.wav_digest(self.wav_path) != observation["inputWavSha256"]:
                    raise ValueError("input-mutated-after-decode")
            except Exception:
                observation = unknown("decoder-input-mutated-or-unavailable")
            self.decoders.append(observation)

    def constructor(self, original, package, *args, **kwargs):
        entry = None
        try:
            if self.failed or len(self.models) >= 64:
                raise ValueError("observation-degraded-or-model-limit")
            path = args[0] if args else kwargs["model_size_or_path"]
            files = model_files(path)
            requested = {k: kwargs[k] for k in ("device", "compute_type", "cpu_threads", "num_workers", "local_files_only") if k in kwargs}
            entry = {"id": "model-" + str(len(self.models) + 1), "filesBefore": files,
                     "requested": self.capture(requested), "sdkVersion": self.capture(getattr(package, "__version__", None)),
                     "constructorCodeSha256": digest(inspect.getfile(original))}
        except Exception:
            self.degrade()
        instance = original(*args, **kwargs)  # Native failures must never enter observation-degrade handlers.
        try:
            if entry is None or len(self.models) >= 64:
                raise ValueError("constructor-observation-unavailable")
            backend = getattr(instance, "model", None)
            settings = {k: getattr(backend, k) for k in ("device", "compute_type") if hasattr(backend, k)}
            entry["actualSettings"] = self.capture(settings) if settings else unknown("settings-not-exposed")
            self.models.append(entry)
            self.checks.append((entry, path))
            original_call = instance.transcribe
            signature = inspect.signature(original_call)
            def transcribe(*positional, **keywords):
                call, input_audio = None, None
                try:
                    if self.failed or len(self.calls) >= 64:
                        raise ValueError("call-limit")
                    bound = signature.bind(*positional, **keywords)
                    input_audio = bound.arguments.get("audio")
                    explicit = {k: v for k, v in bound.arguments.items() if k != "audio"}
                    bound.apply_defaults()
                    defaulted = {k: v for k, v in bound.arguments.items() if k != "audio" and k not in explicit}
                    call = {"id": len(self.calls) + 1, "modelId": entry["id"],
                            "explicit": self.capture(explicit), "defaulted": self.capture(defaulted)}
                except Exception:
                    self.degrade()
                result = self.decoded_call(original_call, call, package, input_audio, *positional, **keywords)  # Exact native result.
                try:
                    if call is None:
                        raise ValueError("call-observation-unavailable")
                    info = result[1]
                    call["returned"] = self.capture({k: getattr(info, k) for k in
                        ("transcription_options", "vad_options", "language", "language_probability", "all_language_probs") if hasattr(info, k)}, returned_options=True)
                    self.calls.append(call)
                except Exception:
                    self.degrade()
                return result
            owned = "transcribe" in vars(instance)
            previous = vars(instance).get("transcribe")
            self.restores.append(lambda: setattr(instance, "transcribe", previous) if owned else delattr(instance, "transcribe"))
            instance.transcribe = transcribe
        except Exception:
            self.degrade()
        return instance

    def run(self, original, actual, *args, **kwargs):
        package, previous = None, None
        native_import = builtins.__import__
        def imported(name, globals=None, locals=None, fromlist=(), level=0):
            nonlocal package, previous
            module = native_import(name, globals, locals, fromlist, level)  # Native initialization failures propagate once.
            if name == "faster_whisper" and globals is original.__globals__ and "WhisperModel" in (fromlist or ()) and package is None:
                try:
                    package, previous = module, module.WhisperModel
                    package.WhisperModel = lambda *a, **k: self.constructor(previous, package, *a, **k)
                except Exception:
                    self.degrade()
                    if previous is not None:
                        package.WhisperModel = previous
            return module
        try:
            # Upstream owns HF_HOME and its sole SDK import; observe only successful return before IMPORT_FROM.
            builtins.__import__ = imported
        except Exception:
            self.degrade()
        try:
            return original(*args, **kwargs)
        finally:
            builtins.__import__ = native_import
            for restore in reversed(self.restores):
                try:
                    restore()
                except Exception:
                    self.degrade()
            self.restores.clear()
            if previous is not None:
                package.WhisperModel = previous

    def finish(self):
        try:
            for entry, path in self.checks:
                entry["filesAfter"] = model_files(path)
                if entry["filesAfter"] != entry["filesBefore"]:
                    raise ValueError("model-mutated")
        except Exception:
            self.degrade()
        if self.failed or not self.models:
            return unknown("native-model-observation-unavailable-or-degraded"), unknown("native-options-observation-unavailable-or-degraded")
        return {"state": "observed", "models": self.models}, {"state": "observed", "basis": "transcribe-API-calls", "calls": self.calls, "byteCount": self.used}


def observe(script, args, expected_sha=SCRIPT_SHA):
    script = Path(script).resolve()
    if digest(script) != expected_sha:
        raise RuntimeError("OBSERVATION_PROTOCOL_FAILURE:UPSTREAM_PIN")
    source, raw = Path(args[0]), Path(args[1])
    before, source_probe = digest(source), probe(source)
    wavs = []
    observer = NativeObserver()
    # Restore the same sibling-import context installed by the original launcher.
    sys.path.insert(0, str(script.parent))
    sys.argv = [str(script), *args]
    namespace = runpy.run_path(str(script), run_name="cooked_observed_upstream")
    main = namespace["main"]
    actual = main.__globals__
    extract = actual["extract_audio"]

    def observed_extract(*positional, **keywords):
        result = extract(*positional, **keywords)
        if len(wavs) >= 1:
            raise RuntimeError("OBSERVATION_PROTOCOL_FAILURE:EXTRA_EXTRACTION")
        try:
            dst = positional[1] if len(positional) > 1 else keywords["dst"]
            observer.wav_path = Path(dst)
            with wave.open(str(dst), "rb") as wav:
                wavs.append({"state": "observed", "sha256": digest(dst),
                    "sampleRate": wav.getframerate(), "channels": wav.getnchannels(),
                    "sampleWidthBytes": wav.getsampwidth(), "sampleCount": wav.getnframes(),
                    "compression": wav.getcomptype(), "origin": unknown("decoder-delay-trim-unobserved")})
        except (OSError, ValueError, EOFError, wave.Error):
            wavs.append(unknown("extracted-WAV-header-unavailable"))
        if wavs[0].get("state") == "observed":
            observer.wav_sha = wavs[0]["sha256"]
        return result

    native = actual["run_whisper"]
    actual["run_whisper"] = lambda *a, **k: observer.run(native, actual, *a, **k)
    actual["extract_audio"] = observed_extract
    try:
        main()  # Preserve exceptions, native arguments, stdout and transcript bytes.
    finally:
        actual["extract_audio"], actual["run_whisper"] = extract, native
    after = digest(source)
    if before != after:
        raise RuntimeError("OBSERVATION_PROTOCOL_FAILURE:SOURCE_CHANGED")
    loaded, options = observer.finish()
    model = Path(os.environ.get("AI_EDITOR_WHISPER_MODEL", "small"))
    try:
        files = model_files(model, require_model=False)
    except (OSError, ValueError) as error:
        raise RuntimeError("OBSERVATION_PROTOCOL_FAILURE:CONFIGURED_MODEL") from error
    try:
        version = bounded_command(["ffmpeg", "-version"]).decode("utf-8").splitlines()[0]
    except (OSError, ValueError, UnicodeError, IndexError):
        version = None
    receipt = {"version": "alignment-observation-v2", "status": "INCOMPLETE",
        "sourceSha256": before, "sourceAfterSha256": after, "rawAlignmentBytesSha256": digest(raw),
        "upstream": {"commit": PIN, "transcribeSha256": expected_sha}, "sourceAudio": source_probe,
        "configuredModel": {"basis": "configured-file-hashes-only", "files": files,
                            "actualLoadedModel": loaded},
        "extraction": {"requested": {"sampleRate": 16000, "channels": 1, "codec": "pcm_s16le"},
                       "toolVersion": version, "wav": wavs[0] if wavs
                       else unknown("no-extraction-observed-cache-reuse-possible")},
        "decoderArray": {"state": "observed", "basis": "pre-SDK-VAD-decode-output", "calls": observer.decoders}
            if options.get("state") == "observed" else unknown("native-calls-unavailable"),
        "effectiveOptions": options,
        "quietBlockVAD": unknown("separate-waveform-not-observed"), "outputPCM": unknown("output-not-observed")}
    data = (json.dumps(receipt, separators=(",", ":"), allow_nan=False) + "\n").encode()
    if len(data) > MAX:
        raise RuntimeError("OBSERVATION_PROTOCOL_FAILURE:RECEIPT_LIMIT")
    # Publish only a complete receipt, exclusively; a failed upstream never seals.
    with tempfile.NamedTemporaryFile(dir=raw.parent, prefix=".observation-", delete=False) as tmp:
        temporary = Path(tmp.name)
        try:
            tmp.write(data)
            tmp.flush()
            os.fsync(tmp.fileno())
            os.link(temporary, raw.parent / "alignment-observation.json")
        finally:
            temporary.unlink()


if __name__ == "__main__":
    observe(sys.argv[1], sys.argv[2:])
