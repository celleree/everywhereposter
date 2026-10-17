"""Real, bounded FFmpeg adversarial corpus; no model or network calls."""
import hashlib
from array import array
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest


HELPER = Path(os.environ.get('COOKED_AUDIO_HELPER', str(
    Path(__file__).resolve().parents[3] /
    'libraries/nestjs-libraries/src/media-editing/cooked-audio-integrity.py')))


def run(*args):
    return subprocess.run([str(a) for a in args], check=True,
        capture_output=True, timeout=25)


def ffmpeg(*args):
    return run('ffmpeg', '-nostdin', '-v', 'error', '-y', '-threads', '1', *args)


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write(path, value):
    path.write_text(json.dumps(value), encoding='utf-8')


def packets(path):
    return json.loads(run('ffprobe', '-v', 'error', '-select_streams', 'a:0',
        '-show_packets', '-of', 'json', path).stdout)['packets']


def pcm(path):
    samples = array('h')
    samples.frombytes(run('ffmpeg', '-nostdin', '-v', 'error', '-i', path,
        '-map', '0:a:0', '-ac', '1', '-ar', '16000', '-f', 's16le', '-').stdout)
    return samples


class AudioIntegrityCorruption(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Missing binaries/helpers are failures, never a silently skipped acceptance gate.
        if not HELPER.is_file():
            raise AssertionError(f'Missing audio authority helper: {HELPER}')
        cls.workspace = tempfile.TemporaryDirectory(prefix='cooked-audio-corpus-')
        cls.root = Path(cls.workspace.name)
        cls.sources = {}
        for fps in (25, 30):
            source = cls.root / f'source-{fps}.mp4'
            ffmpeg('-f', 'lavfi', '-i', f'testsrc2=size=64x64:rate={fps}:duration=2',
                '-f', 'lavfi', '-i',
                'aevalsrc=0.25*sin(2*PI*(230*t+120*t*t))+0.1*sin(2*PI*719*t):s=48000:d=2',
                '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'libx264',
                '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac',
                '-b:a', '192k', '-movflags', '+faststart', source)
            cls.sources[fps] = source

    @classmethod
    def tearDownClass(cls):
        cls.workspace.cleanup()

    def setUp(self):
        self.folder = tempfile.TemporaryDirectory(dir=self.root)
        self.edit = Path(self.folder.name)
        self.source = self.sources[25]
        self.plan = dict(version='source-plan-audio-v1', sourceSha256=sha(self.source),
            removedBlocks=[[0.8, 1.2]])

    def tearDown(self):
        self.folder.cleanup()

    def manifests(self, blocks=None, fps=25):
        blocks = self.plan['removedBlocks'] if blocks is None else blocks
        # Explicit expectations for this fixed 2s corpus; no production helper imports.
        frames = [[0, round(blocks[0][0]*fps)], [round(blocks[0][1]*fps), 2*fps]] if blocks else [[0, 2*fps]]
        spans = [dict(start=a/fps, end=b/fps) for a, b in frames]
        write(self.edit / 'safe-cuts.json', blocks)
        write(self.edit / 'decisions.json', spans)
        write(self.edit / 'report.json', dict(frames=frames, fps=fps, duration=2,
            final_s=sum((b-a)/fps for a, b in frames)))
        return frames

    def render(self, blocks=None, fps=25, source=None):
        source = source or self.source
        frames = self.manifests(blocks, fps)
        if frames == [[0, 2*fps]]:
            shutil.copyfile(source, self.edit / 'cut.mp4')
            return
        filters = []
        for i, (a, b) in enumerate(frames):
            start, end, duration = a/fps, b/fps, (b-a)/fps
            filters.append(f'[0:v:0]trim=start_frame={a}:end_frame={b},setpts=PTS-STARTPTS[v{i}]')
            filters.append(f'[0:a:0]atrim=start={start:.6f}:end={end:.6f},asetpts=PTS-STARTPTS,'
                f'afade=t=in:st=0:d=0.008,afade=t=out:st={max(0, duration-0.008):.6f}:d=0.008[a{i}]')
        filters.append(''.join(f'[v{i}]' for i in range(len(frames))) +
            f'concat=n={len(frames)}:v=1:a=0[v]')
        filters.append(''.join(f'[a{i}]' for i in range(len(frames))) +
            f'concat=n={len(frames)}:v=0:a=1[a]')
        ffmpeg('-i', source, '-filter_complex', ';'.join(filters), '-map', '[v]',
            '-map', '[a]', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt',
            'yuv420p', '-r', str(fps), '-c:a', 'aac', '-b:a', '192k',
            '-movflags', '+faststart', self.edit / 'cut.mp4')

    def verify(self, plan=None, source=None):
        raw = json.dumps(self.plan if plan is None else plan)
        result = subprocess.run([sys.executable, '-I', str(HELPER), 'verify',
            str(source or self.source), str(self.edit), raw], capture_output=True,
            timeout=30)
        return result, raw

    def accepted(self):
        result, raw = self.verify()
        self.assertEqual(result.returncode, 0, result.stderr.decode() + result.stdout.decode())
        proof = json.loads((self.edit / 'audio-integrity.json').read_text())
        self.assertEqual(proof['version'], 'source-plan-audio-v1')
        self.assertEqual(proof['sourceSha256'], sha(self.source))
        self.assertEqual(proof['outputSha256'], sha(self.edit / 'cut.mp4'))
        self.assertEqual(proof['planSha256'], hashlib.sha256(raw.encode()).hexdigest())
        self.assertGreater(proof['audioPackets'], 1)
        self.assertEqual(proof['frameCount'], 2*int(self.source.stem.split('-')[-1]) -
            round(sum(b-a for a, b in self.plan['removedBlocks'])*int(self.source.stem.split('-')[-1])))
        self.assertLess((self.edit / 'audio-integrity.json').stat().st_size, 4096)

    def rejected(self, plan=None, source=None):
        # A forged, internally consistent receipt must never authorize altered media.
        write(self.edit / 'audio-integrity.json', dict(version='source-plan-audio-v1',
            sourceSha256=sha(source or self.source), outputSha256=sha(self.edit / 'cut.mp4'),
            planSha256=hashlib.sha256(json.dumps(self.plan if plan is None else plan).encode()).hexdigest(),
            audioPackets=len(packets(self.edit / 'cut.mp4')), frameCount=40))
        result, _ = self.verify(plan, source)
        self.assertNotEqual(result.returncode, 0, 'Corrupted media accepted with forged proof')

    def remux_audio(self, audio_filter=None, offset=None, extra=False):
        original = self.edit / 'original.mp4'
        (self.edit / 'cut.mp4').rename(original)
        args = ['-i', original]
        if offset is not None:
            args += ['-itsoffset', str(offset), '-i', original]
        args += ['-map', '0:v:0', '-map', '1:a:0' if offset is not None else '0:a:0']
        if extra:
            args += ['-map', '0:a:0']
        args += ['-c:v', 'copy', '-c:a', 'aac' if audio_filter else 'copy']
        if audio_filter:
            args += ['-af', audio_filter, '-b:a', '192k']
        ffmpeg(*args, '-movflags', '+faststart', self.edit / 'cut.mp4')

    def test_valid_edited_proof_at_25_and_30fps(self):
        for fps in (25, 30):
            with self.subTest(fps=fps):
                self.source = self.sources[fps]
                self.plan['sourceSha256'] = sha(self.source)
                self.render(fps=fps)
                self.accepted()

    def test_valid_uncut_and_restored_proof(self):
        self.render()
        self.accepted()
        self.plan['removedBlocks'] = []
        self.render(blocks=[])
        self.accepted()
        self.assertEqual(packets(self.source), packets(self.edit / 'cut.mp4'))

    def test_uncut_copy_cannot_accept_altered_audio_with_forged_receipt(self):
        self.plan['removedBlocks'] = []
        self.render(blocks=[])
        self.remux_audio('volume=0.5,atrim=duration=2')
        self.rejected()

    def test_optional_asr_diagnostic_runs_only_after_complete_physical_proof(self):
        self.render()
        upstream = self.edit / 'fake-upstream'
        script = upstream / 'plugins/ai-editor/skills/cut/scripts/verify_cut.py'
        script.parent.mkdir(parents=True)
        script.write_text(
            "import json, sys\nfrom pathlib import Path\n"
            "(Path(sys.argv[1])/'fake-asr-invocation.json').write_text(json.dumps(sys.argv[1:]))\n"
            "print('Deliberate model-free diagnostic failure')\nraise SystemExit(1)\n",
            encoding='utf-8')
        marker = self.edit / 'fake-asr-invocation.json'
        diagnostic_path = self.edit / 'asr-diagnostic.json'
        self.accepted()
        self.assertFalse(marker.exists(), 'Normal verify must not invoke ASR')
        proof = json.loads((self.edit / 'audio-integrity.json').read_text())
        before = (sha(self.source), sha(self.edit / 'cut.mp4'))
        command = [sys.executable, '-I', str(HELPER), 'diagnose', str(self.source),
            str(self.edit), json.dumps(self.plan), str(upstream)]
        result = subprocess.run(command, capture_output=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stderr.decode())
        self.assertEqual(json.loads(marker.read_text()), [str(self.edit), '--engine', 'whisper'])
        diagnostic = json.loads(diagnostic_path.read_text())
        self.assertIs(diagnostic['authoritative'], False)
        self.assertEqual(diagnostic['exitCode'], 1)
        self.assertEqual(diagnostic['status'], 'differences-or-unavailable')
        self.assertIn('Deliberate model-free diagnostic failure', diagnostic['report'])
        self.assertEqual(diagnostic['audioIntegrity'], proof)
        self.assertEqual(json.loads((self.edit / 'audio-integrity.json').read_text()), proof)
        self.assertEqual((sha(self.source), sha(self.edit / 'cut.mp4')), before)

        marker.unlink()
        diagnostic_path.unlink()
        self.remux_audio('volume=0.5,atrim=duration=1.6')
        corrupted = (sha(self.source), sha(self.edit / 'cut.mp4'))
        self.assertNotEqual(corrupted[1], before[1])
        # A matching mutable receipt cannot replace reconstruction before ASR.
        write(self.edit / 'audio-integrity.json', dict(proof, outputSha256=corrupted[1]))
        result = subprocess.run(command, capture_output=True, timeout=30)
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(marker.exists(), 'Incomplete physical proof must prevent every ASR invocation')
        self.assertFalse(diagnostic_path.exists())
        self.assertEqual((sha(self.source), sha(self.edit / 'cut.mp4')), corrupted)

    def test_omitted_retained_audio_same_duration(self):
        self.render()
        before = pcm(self.edit / 'cut.mp4')
        self.remux_audio('volume=0:enable=between(t\\,0.25\\,0.35),atrim=duration=1.6')
        after = pcm(self.edit / 'cut.mp4')
        self.assertEqual(len(after), len(before), 'Omission must preserve decoded audio duration')
        energy = lambda samples: sum(x*x for x in samples[4320:5280])
        self.assertLess(energy(after), energy(before)/100, 'Retained 100ms must actually be silenced')
        self.rejected()

    def test_coherent_wrong_range_manifests_and_audio(self):
        # Same total duration and frame count, but different retained source samples.
        self.render(blocks=[[0.4, 0.8]])
        coherent = dict(self.plan, removedBlocks=[[0.4, 0.8]])
        result, _ = self.verify(coherent)
        self.assertEqual(result.returncode, 0, result.stderr.decode())
        self.rejected()

    def test_each_mutable_manifest_is_checked_against_trusted_plan(self):
        for filename, value in (
            ('safe-cuts.json', []),
            ('report.json', dict(frames=[[0, 19], [30, 50]])),
            ('decisions.json', [dict(start=0.04, end=0.8), dict(start=1.2, end=2)]),
        ):
            with self.subTest(filename=filename):
                self.render()
                write(self.edit / filename, value)
                self.rejected()
                (self.edit / filename).unlink()
                self.rejected()

    def test_duplicate_or_reordered_payload_with_identical_mp4_clock(self):
        for duplicate in (False, True):
            with self.subTest(duplicate=duplicate):
                self.render()
                cut = self.edit / 'cut.mp4'
                clock = packets(cut)
                data = bytearray(cut.read_bytes())
                pair = next(((a, b) for i, a in enumerate(clock) for b in clock[i+1:]
                    if a['size'] == b['size'] and int(a['size']) > 100 and
                    data[int(a['pos']):int(a['pos'])+int(a['size'])] !=
                    data[int(b['pos']):int(b['pos'])+int(b['size'])]), None)
                self.assertIsNotNone(pair, 'Corpus needs two different equal-length AAC packets')
                a, b = pair
                x, y, n = int(a['pos']), int(b['pos']), int(a['size'])
                left, right = bytes(data[x:x+n]), bytes(data[y:y+n])
                data[y:y+n] = left
                if not duplicate:
                    data[x:x+n] = right
                cut.write_bytes(data)
                self.assertEqual(packets(cut), clock, 'Mutation must preserve every packet clock/header')
                self.rejected()

    def test_audio_shift_and_drift(self):
        for change in ('shift', 'drift'):
            with self.subTest(change=change):
                self.render()
                if change == 'shift':
                    self.remux_audio(offset=0.08)
                else:
                    self.remux_audio('asetrate=47000,aresample=48000,apad,atrim=duration=1.6')
                self.rejected()

    def test_substituted_source_cannot_be_authorized_by_forged_json(self):
        self.render()
        substitute = self.edit / 'substitute.mp4'
        ffmpeg('-i', self.source, '-map', '0:v:0', '-map', '0:a:0', '-c:v', 'copy',
            '-af', 'volume=0.5', '-c:a', 'aac', '-b:a', '192k', substitute)
        # Attacker rewrites both mutable source fields but trusted CLI source hash stays fixed.
        report = json.loads((self.edit / 'report.json').read_text())
        report.update(source=str(substitute), sourceSha256=sha(substitute))
        write(self.edit / 'report.json', report)
        self.rejected(source=substitute)
        # Even replacing the trusted hash cannot make audio from the old source match.
        forged = dict(self.plan, sourceSha256=sha(substitute))
        self.rejected(plan=forged, source=substitute)

    def test_video_clock_and_extra_audio_track(self):
        self.render()
        self.remux_audio(extra=True)
        self.rejected()
        self.render()
        original = self.edit / 'video-original.mp4'
        (self.edit / 'cut.mp4').rename(original)
        ffmpeg('-i', original, '-map', '0:v:0', '-map', '0:a:0', '-vf',
            'setpts=1.1*PTS', '-fps_mode', 'passthrough', '-c:v', 'libx264',
            '-preset', 'ultrafast', '-c:a', 'copy', self.edit / 'cut.mp4')
        self.rejected()

    def test_missing_or_unsupported_trusted_proof(self):
        self.render()
        for plan in ({}, dict(self.plan, version='source-plan-audio-v0'),
            dict(self.plan, sourceSha256='0'*64), dict(self.plan, removedBlocks=[])):
            with self.subTest(plan=plan):
                self.rejected(plan=plan)
        result = subprocess.run([sys.executable, '-I', str(HELPER), 'verify',
            str(self.source), str(self.edit)], capture_output=True, timeout=10)
        self.assertNotEqual(result.returncode, 0)


if __name__ == '__main__':
    unittest.main()
