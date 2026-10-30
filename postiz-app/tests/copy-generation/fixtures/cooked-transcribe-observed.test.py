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


if __name__ == "__main__":
    unittest.main()
