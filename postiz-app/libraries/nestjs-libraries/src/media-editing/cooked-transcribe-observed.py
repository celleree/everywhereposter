"""Private, deliberately incomplete observations around the pinned native transcriber."""
import hashlib
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


def observe(script, args, expected_sha=SCRIPT_SHA):
    script = Path(script).resolve()
    if digest(script) != expected_sha:
        raise RuntimeError("OBSERVATION_PROTOCOL_FAILURE:UPSTREAM_PIN")
    source, raw = Path(args[0]), Path(args[1])
    before, source_probe = digest(source), probe(source)
    wavs = []
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
            with wave.open(str(dst), "rb") as wav:
                wavs.append({"state": "observed", "sha256": digest(dst),
                    "sampleRate": wav.getframerate(), "channels": wav.getnchannels(),
                    "sampleWidthBytes": wav.getsampwidth(), "sampleCount": wav.getnframes(),
                    "compression": wav.getcomptype(), "origin": unknown("decoder-delay-trim-unobserved")})
        except (OSError, ValueError, EOFError, wave.Error):
            wavs.append(unknown("extracted-WAV-header-unavailable"))
        return result

    actual["extract_audio"] = observed_extract
    main()  # Preserve exceptions, native arguments, stdout and transcript bytes.
    after = digest(source)
    if before != after:
        raise RuntimeError("OBSERVATION_PROTOCOL_FAILURE:SOURCE_CHANGED")
    model = Path(os.environ.get("AI_EDITOR_WHISPER_MODEL", "small"))
    files = {}
    for name in MODEL_FILES:
        file = model / name
        files[name] = digest(file) if file.is_file() and not file.is_symlink() else None
    try:
        version = bounded_command(["ffmpeg", "-version"]).decode("utf-8").splitlines()[0]
    except (OSError, ValueError, UnicodeError, IndexError):
        version = None
    receipt = {"version": "alignment-observation-v1", "status": "INCOMPLETE",
        "sourceSha256": before, "sourceAfterSha256": after, "rawAlignmentBytesSha256": digest(raw),
        "upstream": {"commit": PIN, "transcribeSha256": expected_sha}, "sourceAudio": source_probe,
        "configuredModel": {"basis": "configured-file-hashes-only", "files": files,
                            "actualLoadedModel": unknown("constructor-not-observed")},
        "extraction": {"requested": {"sampleRate": 16000, "channels": 1, "codec": "pcm_s16le"},
                       "toolVersion": version, "wav": wavs[0] if wavs
                       else unknown("no-extraction-observed-cache-reuse-possible")},
        "decoderArray": unknown("decoder-not-observed"), "effectiveOptions": unknown("options-not-observed"),
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
