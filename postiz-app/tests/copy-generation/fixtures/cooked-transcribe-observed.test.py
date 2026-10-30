"""Offline native-control-flow fixture: generated media, no model or customer data."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
MEDIA = Path(__file__).resolve().parents[3] / "libraries/nestjs-libraries/src/media-editing"
spec = importlib.util.spec_from_file_location("observed", MEDIA / "cooked-transcribe-observed.py")
O = importlib.util.module_from_spec(spec)
spec.loader.exec_module(O)
# Match pinned main's cache -> transcribe -> temporary WAV -> write control flow.
FAKE = '''
import hashlib, json, os, subprocess, sys, tempfile
from pathlib import Path
import sibling
def extract_audio(src, dst):
    sibling.note(["extract", str(src), str(dst)])
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(src), "-vn",
                    "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", str(dst)], check=True)
def run_whisper(wav, lang, terms=()):
    sibling.note(["inference", lang, list(terms), hashlib.sha256(wav.read_bytes()).hexdigest()])
    assert wav.exists()
    if os.environ.get("FAIL_NATIVE"): raise RuntimeError("native sentinel")
    return [{"text":"um", "start":0.1, "end":0.2, "type":"word"}]
def transcribe(media):
    with tempfile.TemporaryDirectory() as tmp:
        wav = Path(tmp) / "a.wav"
        extract_audio(media, wav)
        return run_whisper(wav, "en", [])
def main():
    sibling.note(["main", sys.argv[1:]])
    assert sys.argv[3:] == ["--engine", "whisper", "--lang", "en"]
    cache = Path(os.environ["CACHE"])
    words = json.loads(cache.read_text()) if cache.exists() else transcribe(sys.argv[1])
    print("native transcript", flush=True)
    cache.write_text(json.dumps(words))
    Path(sys.argv[2]).write_text(json.dumps(words, indent=1), encoding="utf-8")
    if os.environ.get("MUTATE_SOURCE"): Path(sys.argv[1]).write_bytes(b"changed")
if __name__ == "__main__": main()
'''


class Observation(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.script = self.root / "transcribe.py"
        self.script.write_text(FAKE)
        (self.root / "sibling.py").write_text(
            'import json, os\ndef note(value):\n with open(os.environ["TRACE"], "a") as f: f.write(json.dumps(value)+"\\n")\n')
        self.source = self.root / "source.wav"
        subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i",
                        "sine=frequency=440:sample_rate=44100:duration=0.1",
                        str(self.source)], check=True)
        self.raw = self.root / "words.raw.json"
        self.receipt = self.root / "alignment-observation.json"
        self.trace = self.root / "trace.jsonl"
        self.cache = self.root / "cache.json"
        self.env = {**os.environ, "TRACE": str(self.trace), "CACHE": str(self.cache),
                    "AI_EDITOR_WHISPER_MODEL": str(self.root / "configured-model")}
        (self.root / "configured-model").mkdir()
        (self.root / "configured-model/model.bin").write_bytes(b"fixture identity only")
        self.args = [str(self.source), str(self.raw), "--engine", "whisper", "--lang", "en"]
        self.driver = self.root / "driver.py"
        self.driver.write_text(
            'import importlib.util, sys\nsys.dont_write_bytecode=True\nspec=importlib.util.spec_from_file_location("o", sys.argv[1])\n'
            'o=importlib.util.module_from_spec(spec); spec.loader.exec_module(o)\n'
            'o.observe(sys.argv[2],sys.argv[3:],expected_sha=o.digest(sys.argv[2]))\n')

    def run_native(self, wrapped=True, env=None):
        command = [sys.executable, "-I", str(MEDIA / "cooked-editor-launcher.py")]
        command += [str(self.driver), str(MEDIA / "cooked-transcribe-observed.py"), str(self.script)] if wrapped else [str(self.script)]
        return subprocess.run([*command, *self.args], env=env or self.env, capture_output=True)

    def events(self):
        return [json.loads(line) for line in self.trace.read_text().splitlines()]

    def test_transparency_and_capture_before_native_temporary_deletion(self):
        direct = self.run_native(False)
        self.assertEqual(direct.returncode, 0)
        baseline, native = self.raw.read_bytes(), self.events()
        self.trace.unlink()
        self.cache.unlink()
        result = self.run_native()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.raw.read_bytes(), baseline)
        self.assertEqual(result.stdout, direct.stdout)
        self.assertEqual(result.stderr, direct.stderr)
        events = self.events()
        self.assertEqual([e[0] for e in events], ["main", "extract", "inference"])
        self.assertEqual(events[0], native[0])
        self.assertEqual(events[2], native[2])
        self.assertFalse(Path(events[1][2]).exists())
        r = json.loads(self.receipt.read_bytes())
        self.assertEqual(r["rawAlignmentBytesSha256"], hashlib.sha256(baseline).hexdigest())
        self.assertEqual(r["sourceSha256"], r["sourceAfterSha256"])
        self.assertEqual(int(r["sourceAudio"]["selectedStream"]["sample_rate"]), 44100)
        self.assertEqual(r["extraction"]["wav"]["sha256"], events[2][3])
        self.assertEqual(r["extraction"]["wav"]["sampleRate"], 16000)
        self.assertEqual(r["extraction"]["wav"]["sampleCount"], 1600)
        self.assertEqual(r["extraction"]["wav"]["sampleWidthBytes"], 2)
        self.assertEqual(r["extraction"]["wav"]["channels"], 1)
        self.assertEqual(r["configuredModel"]["actualLoadedModel"]["state"], "unknown")
        self.assertEqual(r["configuredModel"]["files"]["model.bin"], hashlib.sha256(b"fixture identity only").hexdigest())
        self.assertIsNone(r["configuredModel"]["files"]["config.json"])
        self.assertNotIn(str(self.root), self.receipt.read_text())
        self.assertEqual(self.receipt.stat().st_mode & 0o777, 0o600)

    def test_cache_reuse_is_valid_incomplete_without_extraction_or_inference(self):
        self.cache.write_text('[{"text":"cached"}]')
        self.assertEqual(self.run_native().returncode, 0)
        self.assertEqual([e[0] for e in self.events()], ["main"])
        r = json.loads(self.receipt.read_bytes())
        self.assertEqual(r["status"], "INCOMPLETE")
        self.assertEqual(r["extraction"]["wav"]["state"], "unknown")
        self.assertEqual(json.loads(self.raw.read_bytes()), [{"text": "cached"}])

    def test_oversized_configured_model_cache_hit_rejects_before_reading_or_sdk_import(self):
        self.cache.write_text('[{"text":"cached"}]')
        model = self.root / "configured-model/model.bin"
        with model.open("wb") as f: f.truncate(512 * 1024 * 1024 + 1)
        direct = self.run_native(False)
        self.assertEqual(direct.returncode, 0, direct.stderr)
        raw = self.raw.read_bytes(); self.trace.unlink()
        guard = '''import builtins, os
from pathlib import Path
native_open = builtins.open
class MetadataOnly:
    def __init__(self, stream): self.stream = stream
    def __enter__(self): return self
    def __exit__(self, *args): return self.stream.__exit__(*args)
    def fileno(self): return self.stream.fileno()
    def read(self, *args): raise AssertionError("oversized model content read")
def guarded_open(file, *args, **kwargs):
    stream = native_open(file, *args, **kwargs)
    return MetadataOnly(stream) if isinstance(file, (str, os.PathLike)) and Path(file).parent == Path(os.environ["AI_EDITOR_WHISPER_MODEL"]) and os.fstat(stream.fileno()).st_size >= 512 * 1024 * 1024 else stream
builtins.open = guarded_open
def audit(event, args):
    if event == "import" and args[0].startswith("faster_whisper"): raise AssertionError("cache imported SDK")
sys.addaudithook(audit)
'''
        self.driver.write_text(self.driver.read_text().replace('o.observe(', guard + 'o.observe('))
        for aggregate in (False, True):
            with self.subTest(aggregate=aggregate):
                if aggregate:
                    model.write_bytes(b"x")
                    with (model.parent / "config.json").open("wb") as f: f.truncate(512 * 1024 * 1024)
                self.trace.unlink(missing_ok=True)
                result = self.run_native()
                self.assertNotEqual(result.returncode, 0)
                self.assertIn(b"OBSERVATION_PROTOCOL_FAILURE:CONFIGURED_MODEL", result.stderr)
                self.assertIn(b"model-limit", result.stderr)
                self.assertNotIn(b"oversized model content read", result.stderr)
                self.assertNotIn(b"cache imported SDK", result.stderr)
                self.assertEqual((result.stdout, self.raw.read_bytes()), (direct.stdout, raw))
                self.assertEqual([e[0] for e in self.events()], ["main"])
                self.assertFalse(self.receipt.exists())

    def test_configured_path_replacement_between_files_never_seals(self):
        self.cache.write_text('[{"text":"cached"}]')
        directory = self.root / "configured-model"
        model, config = directory / "model.bin", directory / "config.json"
        direct = self.run_native(False)
        self.assertEqual(direct.returncode, 0, direct.stderr)
        raw = self.raw.read_bytes()
        guard = '''import builtins, os
from pathlib import Path
native_open = builtins.open
directory = Path(os.environ["AI_EDITOR_WHISPER_MODEL"])
switched = False
def replacing_open(file, *args, **kwargs):
    global switched
    if isinstance(file, (str, os.PathLike)) and Path(file) == directory / "config.json" and not switched:
        switched = True
        replacement = directory / "replacement"
        replacement.write_bytes(b"new model"); replacement.replace(directory / "model.bin")
        if os.environ["REPLACE_CONFIG"] == "1":
            replacement.write_bytes(b"new config"); replacement.replace(directory / "config.json")
        (directory / "replacement-marker").write_text("replaced")
    return native_open(file, *args, **kwargs)
builtins.open = replacing_open
def audit(event, args):
    if event == "import" and args[0].startswith("faster_whisper"): raise AssertionError("cache imported SDK")
sys.addaudithook(audit)
'''
        self.driver.write_text(self.driver.read_text().replace('o.observe(', guard + 'o.observe('))
        for replace_config in (False, True):
            with self.subTest(replace_config=replace_config):
                model.write_bytes(b"old model"); config.write_bytes(b"old config")
                self.trace.unlink(missing_ok=True); self.receipt.unlink(missing_ok=True)
                result = self.run_native(env={**self.env, "REPLACE_CONFIG": str(int(replace_config))})
                self.assertIn(b"OBSERVATION_PROTOCOL_FAILURE:CONFIGURED_MODEL", result.stderr)
                self.assertIn(b"model-path-changed", result.stderr)
                self.assertNotIn(b"cache imported SDK", result.stderr)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual((result.stdout, self.raw.read_bytes()), (direct.stdout, raw))
                self.assertEqual((directory / "replacement-marker").read_text(), "replaced")
                self.assertEqual(model.read_bytes(), b"new model")
                self.assertEqual([e[0] for e in self.events()], ["main"])
                self.assertFalse(self.receipt.exists())

    def test_missing_or_symlink_configured_files_preserve_cache_unknowns(self):
        self.cache.write_text('[{"text":"cached"}]')
        directory = self.root / "configured-model"
        (directory / "model.bin").unlink()
        for variant in ("missing-file", "missing-directory", "symlink-file"):
            with self.subTest(variant=variant):
                if variant == "missing-directory": directory.rmdir()
                if variant == "symlink-file":
                    directory.mkdir(); (directory / "model.bin").symlink_to(self.source)
                self.receipt.unlink(missing_ok=True)
                result = self.run_native()
                self.assertEqual(result.returncode, 0, result.stderr)
                receipt = json.loads(self.receipt.read_bytes())
                self.assertEqual(receipt["configuredModel"]["files"], dict.fromkeys(O.MODEL_FILES))
                self.assertEqual(receipt["configuredModel"]["actualLoadedModel"]["state"], "unknown")
                self.assertEqual(receipt["effectiveOptions"]["state"], "unknown")

    def test_upstream_failure_preserved_and_no_seal(self):
        env = {**self.env, "FAIL_NATIVE": "1"}
        for wrapped in (False, True):
            result = self.run_native(wrapped, env)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn(b"RuntimeError: native sentinel", result.stderr)
            self.assertFalse(self.receipt.exists())
            self.assertFalse(self.raw.exists())

    def test_multiple_streams_and_missing_origin_stay_unknown(self):
        single = O.probe(self.source)
        self.assertIsNone(single["candidates"][0]["start_pts"])
        self.assertEqual(single["presentationOrigin"]["state"], "unknown")
        multi = self.root / "multi.mkv"
        subprocess.run(["ffmpeg", "-v", "error", "-i", str(self.source),
                        "-map", "0:a", "-map", "0:a", "-c:a", "pcm_s16le", str(multi)], check=True)
        self.source = multi
        self.args[0] = str(multi)
        self.assertEqual(self.run_native().returncode, 0)
        r = json.loads(self.receipt.read_bytes())
        self.assertEqual(len(r["sourceAudio"]["candidates"]), 2)
        self.assertEqual(r["sourceAudio"]["selectedStream"]["state"], "unknown")

    def test_source_pts_origin_is_rational_presentation_evidence_only(self):
        shifted = self.root / "shifted.mkv"
        subprocess.run(["ffmpeg", "-v", "error", "-itsoffset", "0.125", "-i", str(self.source),
                        "-c:a", "pcm_s16le", str(shifted)], check=True)
        self.assertEqual(O.probe(shifted)["presentationOrigin"],
                         {"numerator": 1, "denominator": 8, "basis": "source-presentation-PTS-only"})

    def test_source_mutation_never_seals(self):
        result = self.run_native(env={**self.env, "MUTATE_SOURCE": "1"})
        self.assertIn(b"OBSERVATION_PROTOCOL_FAILURE:SOURCE_CHANGED", result.stderr)
        self.assertFalse(self.receipt.exists())

    def test_pin_and_exclusive_sealing_and_probe_bounds(self):
        with self.assertRaisesRegex(RuntimeError, "UPSTREAM_PIN"):
            O.observe(self.script, self.args)
        self.receipt.write_bytes(b"existing")
        self.assertNotEqual(self.run_native().returncode, 0)
        self.assertEqual(self.receipt.read_bytes(), b"existing")
        self.assertEqual(list(self.root.glob(".observation-*")), [])
        with self.assertRaisesRegex(ValueError, "probe limit"):
            O.bounded_command([sys.executable, "-c", 'import sys;sys.stdout.write("x"*70000)'])


SDK = r'''import os
from dataclasses import dataclass
from types import SimpleNamespace as N
assert "HF_HOME" in os.environ
__version__ = "fixture-1"
instances = []
attempts = []
@dataclass
class VadOptions:
    threshold: float = 0.5
    neg_threshold: float = None
    min_speech_duration_ms: int = 0
    max_speech_duration_s: float = float("inf")
    min_silence_duration_ms: int = 2000
    speech_pad_ms: int = 400
class WhisperModel:
    def __init__(self, model_size_or_path, **kwargs):
        attempts.append("constructor")
        if os.environ.get("SDK_FAIL") == "constructor": raise RuntimeError("native constructor")
        self.model = N(device="observed-cpu", compute_type="observed-int8")
        self.results = []; instances.append(self)
    def transcribe(self, audio, language=None, word_timestamps=False, initial_prompt=None,
                   beam_size=5, condition_on_previous_text=True, vad_filter=False,
                   vad_parameters=None, clip_timestamps="0"):
        attempts.append("transcribe")
        if os.environ.get("SDK_FAIL") == "transcribe": raise RuntimeError("native transcribe")
        @dataclass
        class Options:
            beam_size: int = 7
        info = N(transcription_options=Options(), vad_options=VadOptions(min_silence_duration_ms=500), language="en",
                 language_probability=0.9, all_language_probs=[("en", 0.9)])
        if os.environ.get("SDK_FAIL") == "unsupported": info.vad_options = object()
        mode = os.environ.get("SDK_FAIL")
        if mode in ("nan-vad", "negative-vad"):
            info.vad_options.max_speech_duration_s = float("nan" if mode == "nan-vad" else "-inf")
        if mode == "infinite-option": info.transcription_options.beam_size = float("inf")
        if mode == "reserved-tag": info.vad_options.max_speech_duration_s = {"$sdkNumber": "positive-infinity"}
        def segments():
            if os.environ.get("SDK_FAIL") == "lazy": raise RuntimeError("native lazy")
            words = [N(word="um", start=0.2, end=2.3)] if clip_timestamps == "0" else [
                N(word="um", start=0.2, end=1.0), N(word="yes", start=1.0, end=2.3)]
            yield N(words=words)
        result = (segments(), info); self.results.append(result)
        return result
'''


class NativeCapture(unittest.TestCase):
    setUp, run_native = Observation.setUp, Observation.run_native
    def sdk(self):
        package = self.root / "faster_whisper"
        package.mkdir(); (package / "__init__.py").write_text(SDK)
        return package

    def test_native_identity_defaults_restoration_and_degradation(self):
        self.sdk()
        with patch.dict(os.environ, self.env), patch.object(sys, "path", [str(self.root), *sys.path]):
            os.environ.setdefault("HF_HOME", str(self.root / "home"))
            import faster_whisper as sdk
            self.addCleanup(lambda: sys.modules.pop("faster_whisper", None))
            constructor = sdk.WhisperModel
            native_import = O.builtins.__import__
            def native(count=2):
                from faster_whisper import WhisperModel
                instance = WhisperModel(self.env["AI_EDITOR_WHISPER_MODEL"], device="cpu", compute_type="int8")
                for i in range(count):
                    result = instance.transcribe("private-audio-path", language="en", vad_filter=True) if i == 0 else instance.transcribe("private-audio-path", clip_timestamps=[0.2, 2.3])
                    self.assertIs(result, instance.results[-1]); self.assertIs(result[1], instance.results[-1][1])
                    self.assertEqual(len(instance.results), i + 1)
                    self.assertEqual(list(result[0])[0].words[0].word, "um")
                return instance
            for mode in ("", "unsupported", "constructor", "transcribe", "lazy", "overflow", "budget", "mutate", "nan-vad", "negative-vad", "infinite-option", "reserved-tag"):
                with self.subTest(mode=mode), patch.dict(os.environ, {"SDK_FAIL": mode}):
                    previous = len(sdk.attempts)
                    observer = O.NativeObserver()
                    if mode == "budget": observer.used = 65535
                    if mode in ("constructor", "transcribe", "lazy"):
                        with self.assertRaisesRegex(RuntimeError, "native " + mode): observer.run(native, {"HOME": self.root})
                    else:
                        instance = observer.run(native, {"HOME": self.root}, 65 if mode == "overflow" else 2)
                        self.assertNotIn("transcribe", vars(instance))
                        if mode == "mutate": (self.root / "configured-model/model.bin").write_bytes(b"changed")
                        loaded, options = observer.finish()
                        if mode: self.assertEqual(options["state"], "unknown")
                        else:
                            self.assertEqual(json.loads(loaded["models"][0]["actualSettings"]["canonicalUTF8"])["device"], "observed-cpu")
                            self.assertNotIn(str(self.root), json.dumps(loaded))
                            calls = options["calls"]
                            self.assertEqual([c["id"] for c in calls], [1, 2])
                            self.assertTrue(json.loads(calls[0]["explicit"]["canonicalUTF8"])["vad_filter"])
                            self.assertFalse(json.loads(calls[1]["defaulted"]["canonicalUTF8"])["vad_filter"])
                            self.assertEqual(json.loads(calls[0]["returned"]["canonicalUTF8"])["transcription_options"]["beam_size"], 7)
                            returned = json.loads(calls[0]["returned"]["canonicalUTF8"], parse_constant=lambda v: self.fail(v))
                            self.assertEqual(returned["vad_options"]["max_speech_duration_s"], {"$sdkNumber": "positive-infinity"})
                            self.assertNotIn("private-audio-path", json.dumps(options))
                            self.assertEqual(loaded["models"][0]["filesBefore"], loaded["models"][0]["filesAfter"])
                    count = 0 if mode == "constructor" else 1 if mode in ("transcribe", "lazy") else 65 if mode == "overflow" else 2
                    self.assertEqual(sdk.attempts[previous:], ["constructor"] + ["transcribe"] * count)
                    self.assertIs(O.builtins.__import__, native_import)
                    self.assertIs(sdk.WhisperModel, constructor)
                    self.assertTrue(all("transcribe" not in vars(i) for i in sdk.instances))
            with patch.dict(sys.modules, {"faster_whisper": None}), self.assertRaises(ModuleNotFoundError):
                O.NativeObserver().run(native, {"HOME": self.root})
            for bad in (object(), float("nan"), float("inf"), float("-inf"), "x" * 70000, ["x" * 10000] * 10):
                with self.assertRaises(ValueError): O.binding(bad)
            model = self.root / "configured-model/model.bin"
            with model.open("wb") as f: f.truncate(75 * 1024 * 1024)
            self.assertEqual(O.model_files(model.parent)["model.bin"], O.digest(model))
            with model.open("wb") as f: f.truncate(512 * 1024 * 1024 + 1)
            with self.assertRaises(ValueError): O.model_files(model.parent)
            model.unlink(); model.symlink_to(self.source)
            with self.assertRaises(OSError): O.model_files(model.parent)

    @unittest.skipUnless(os.environ.get("COOKED_PINNED_TRANSCRIBE"), "opt-in actual pinned import failure")
    def test_pinned_failed_sdk_initialization_is_never_replayed(self):
        import builtins, contextlib, io, runpy
        script = Path(os.environ["COOKED_PINNED_TRANSCRIBE"])
        self.assertEqual(O.digest(script), O.SCRIPT_SHA)
        native = runpy.run_path(str(script), run_name="failure_fixture")["run_whisper"]
        package = self.sdk() / "__init__.py"
        native_import = builtins.__import__
        with patch.dict(os.environ, self.env), patch.object(sys, "path", [str(self.root), *sys.path]):
            for error, transient in (("ImportError", False), ("ImportError", True), ("RuntimeError", False)):
                with self.subTest(error=error, transient=transient):
                    package.write_text('import os\nfrom pathlib import Path\np=Path(os.environ["TRACE"])\n'
                        'n=int(p.read_text())+1 if p.exists() else 1\np.write_text(str(n))\n'
                        'print("SDK initialization", flush=True)\nprint("SDK diagnostic", file=__import__("sys").stderr)\n'
                        + ('if n == 1: ' if transient else '') + 'raise ' + error + '("SDK failure sentinel")\n')
                    results = []
                    for wrapped in (False, True):
                        self.trace.unlink(missing_ok=True); sys.modules.pop("faster_whisper", None)
                        stdout, stderr = io.StringIO(), io.StringIO()
                        with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
                            try:
                                if wrapped: O.NativeObserver().run(native, native.__globals__, self.root / "unused.wav", "en")
                                else: native(self.root / "unused.wav", "en")
                            except BaseException as failure: outcome = (type(failure), str(failure))
                            else: self.fail("native import failure was swallowed")
                        results.append((stdout.getvalue(), stderr.getvalue(), outcome))
                        self.assertEqual(self.trace.read_text(), "1")
                        self.assertIs(builtins.__import__, native_import)
                    self.assertEqual(results[0], results[1])
                    self.assertEqual(results[0][:2], ("SDK initialization\n", "SDK diagnostic\n"))

    @unittest.skipUnless(os.environ.get("COOKED_PINNED_TRANSCRIBE"), "opt-in actual pinned upstream/fake SDK")
    def test_actual_pinned_upstream_fake_sdk_bytes_and_cache(self):
        self.sdk(); self.script = Path(os.environ["COOKED_PINNED_TRANSCRIBE"])
        self.assertEqual(O.digest(self.script), O.SCRIPT_SHA)
        self.driver.write_text(self.driver.read_text().replace('o.observe(', 'sys.path.insert(0, ' + repr(str(self.root)) + '); o.observe('))
        self.env.update(AI_EDITOR_HOME=str(self.root / "native-home"), HF_HOME=str(self.root / "hf"), PYTHONPATH=str(self.root))
        self.env.pop("HF_HOME", None)
        # Isolated mode ignores PYTHONPATH; use the existing launcher with a tiny path-setting driver for the direct baseline.
        direct = self.root / "direct.py"
        direct.write_text('import sys, runpy\nsys.dont_write_bytecode=True\nsys.path.insert(0, ' + repr(str(self.root)) + ')\nsys.argv=sys.argv[1:]\nsys.path.insert(0, str(__import__("pathlib").Path(sys.argv[0]).parent))\nrunpy.run_path(sys.argv[0],run_name="__main__")\n')
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i",
                        "sine=frequency=440:sample_rate=44100:duration=2.5", "-af", "adelay=200,apad=pad_dur=0.3", str(self.source)], check=True)
        baseline = subprocess.run([sys.executable, "-I", str(direct), str(self.script), *self.args], env=self.env, capture_output=True)
        self.assertEqual(baseline.returncode, 0, baseline.stderr); raw = self.raw.read_bytes()
        import shutil
        shutil.rmtree(self.root / "native-home/cache")
        result = self.run_native(); self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((result.stdout, result.stderr, self.raw.read_bytes()), (baseline.stdout, baseline.stderr, raw))
        receipt = json.loads(self.receipt.read_bytes()); calls = receipt["effectiveOptions"]["calls"]
        self.assertEqual(len(calls), 2); self.assertFalse(json.loads(calls[1]["defaulted"]["canonicalUTF8"])["vad_filter"])
        self.receipt.unlink(); (self.root / "faster_whisper/__init__.py").write_text('raise AssertionError("cache imported SDK")')
        result = self.run_native(); self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(self.receipt.read_bytes())["effectiveOptions"]["state"], "unknown")
        self.receipt.unlink()
        with (self.root / "configured-model/model.bin").open("wb") as f: f.truncate(512 * 1024 * 1024 + 1)
        result = self.run_native()
        self.assertIn(b"OBSERVATION_PROTOCOL_FAILURE:CONFIGURED_MODEL", result.stderr)
        self.assertEqual(self.raw.read_bytes(), raw)
        self.assertFalse(self.receipt.exists())

    @unittest.skipUnless(os.environ.get("COOKED_ACTUAL_SDK_VAD") == "1", "opt-in installed SDK, no model/inference")
    def test_z_installed_sdk_vad_without_model_or_inference(self):
        from importlib.metadata import version
        from faster_whisper import WhisperModel
        from faster_whisper.vad import VadOptions
        self.assertEqual(version("faster-whisper"), "1.2.1")
        with patch.object(WhisperModel, "__init__", side_effect=AssertionError("model forbidden")), patch.object(WhisperModel, "transcribe", side_effect=AssertionError("inference forbidden")):
            vad = VadOptions(min_silence_duration_ms=500)
            self.assertEqual(vad.max_speech_duration_s, float("inf"))
            bound = O.binding({"vad_options": vad}, returned_options=True)
            parsed = json.loads(bound["canonicalUTF8"], parse_constant=lambda v: self.fail(v))
            self.assertEqual(parsed["vad_options"]["max_speech_duration_s"], {"$sdkNumber": "positive-infinity"})
            self.assertEqual(parsed["vad_options"]["min_silence_duration_ms"], 500)
            for value in (float("nan"), float("-inf")):
                vad.max_speech_duration_s = value
                with self.assertRaises(ValueError): O.binding({"vad_options": vad}, returned_options=True)
            output = os.environ.get("COOKED_SDK_BINDING_OUTPUT")
            if output: Path(output).write_text(json.dumps({"sdkVersion": version("faster-whisper"), "modelConstructed": False, "inferencePerformed": False, "returned": bound}))


if __name__ == "__main__":
    unittest.main()
