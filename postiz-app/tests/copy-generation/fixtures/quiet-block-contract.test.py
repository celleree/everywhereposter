import json
from pathlib import Path
import runpy
import shutil
import tempfile
import unittest

helper = Path(__file__).resolve().parents[3]/'libraries/nestjs-libraries/src/media-editing/cooked-quiet-blocks.py'
functions = runpy.run_path(str(helper))


class QuietBlockContract(unittest.TestCase):
    def setUp(self):
        self.policy = dict(version='quiet-block-v1', fps=25, total=250,
            blocks=[[1, 2], [3, 5]], blockFrames=[[25, 50], [75, 125]])

    def test_explicit_blocks_and_restore_preserve_exact_selection(self):
        selected = functions['selected']
        self.assertEqual(selected(self.policy, {'cut': [[3, 5], [1, 2]]}, []), [[1, 2], [3, 5]])
        self.assertEqual(selected(self.policy, {'restore': [[1, 2]]}, [[1, 2], [3, 5]]), [[3, 5]])
        for edits in [{'cut': [[1.48, 1.62]]}, {'cut': [[1.48, 2.08]]}, {'cut': [[1, 5]]},
            {'cut': [[1, 2], [1, 2]]}, {'restore': [[1, 2]]}, {'pause': [[1, 2]]},
            {'cut': [[1, 2]], 'restore': [[1, 2]]}, {'word': [[1, 2]]}, {}]:
            with self.subTest(edits=edits), self.assertRaises(ValueError):
                selected(self.policy, edits, [])

    def test_only_bounded_decoder_padding_beyond_matching_presentation_ends_is_trimmed(self):
        presentation = functions['presentation_audio']
        def meta(audio=1, video=1):
            return dict(streams=[dict(codec_type='audio', duration=str(audio)),
                dict(codec_type='video', duration=str(video))])
        samples = [1]*16005
        self.assertEqual(len(presentation(samples, meta())), 16000)
        self.assertEqual(len(presentation([1]*16017, meta())), 16017)
        self.assertEqual(len(presentation(samples, meta(audio=1.1))), 16005)
        self.assertEqual(len(presentation(samples, meta(video=1.1))), 16005)
        self.assertEqual(len(presentation([1]*15999, meta())), 15999)
        aac = meta(); aac['streams'][0].update(codec_name='aac', sample_rate='44100')
        self.assertEqual(len(presentation([1]*16212, aac)), 16000)
        self.assertEqual(len(presentation([1]*16400, aac)), 16400)
        aac['streams'][1]['duration'] = '1.1'
        self.assertEqual(len(presentation([1]*16212, aac)), 16212)
        # Decode/render map the FIRST stream: a later track cannot authorize padding.
        first_mismatch = meta(audio=1.01)
        first_mismatch['streams'][0].update(codec_name='aac', sample_rate='44100')
        first_mismatch['streams'].append(dict(codec_type='audio', duration='1', codec_name='aac', sample_rate='44100'))
        self.assertEqual(len(presentation([1]*16160, first_mismatch)), 16160)
        first_mismatch = meta(audio=1.01)
        first_mismatch['streams'][0].update(codec_name='aac', sample_rate='44100')
        first_mismatch['streams'].append(dict(codec_type='video', duration='1.01'))
        self.assertEqual(len(presentation([1]*16160, first_mismatch)), 16160)

    def test_uncut_audio_only_replaces_after_exact_packet_and_asr_pcm_identity(self):
        preserve = functions['preserve_uncut_audio']
        g = preserve.__globals__
        original_command, original_probe = g['command'], g['probe']
        with tempfile.TemporaryDirectory() as folder:
            edit = Path(folder); source = edit/'source.mp4'; source.write_bytes(b'original')
            cut = edit/'cut.mp4'; cut.write_bytes(b'native render')
            (edit/'safe-cuts.json').write_text('[]')
            (edit/'report.json').write_text('{"frames":[[0,250]]}')
            (edit/'decisions.json').write_text('[{"start":0,"end":10}]')
            meta = dict(streams=[dict(codec_type='video', codec_name='h264', start_time='0', duration='10'),
                dict(codec_type='audio', codec_name='aac', start_time='0', duration='10')])
            g['probe'] = lambda _: meta
            mismatch = None; calls = []
            def fake_command(args):
                from types import SimpleNamespace
                calls.append(args)
                if '-show_packets' in args:
                    kind = args[args.index('-select_streams')+1]
                    changed = mismatch == kind and 'uncut-audio-' in args[-1]
                    return SimpleNamespace(stdout=json.dumps({'packets':[kind, 'changed' if changed else 'same']}))
                if '-f' in args:
                    path = args[args.index('-i')+1]
                    return SimpleNamespace(stdout='different' if mismatch == 'pcm' and 'uncut-audio-' in path else 'SHA256=same')
                Path(args[-1]).write_bytes(b'preserved')
                return SimpleNamespace(stdout='')
            g['command'] = fake_command
            try:
                for mismatch in ['a:0', 'v:0', 'pcm']:
                    with self.assertRaisesRegex(ValueError, 'UNCUT_MEDIA_CHANGED'):
                        preserve(source, edit, self.policy)
                    self.assertEqual(cut.read_bytes(), b'native render')
                    self.assertFalse(any(edit.glob('uncut-audio-*')))
                mismatch = None
                self.assertTrue(preserve(source, edit, self.policy))
                self.assertEqual(cut.read_bytes(), b'preserved')
                self.assertEqual(source.read_bytes(), b'original')
                calls.clear(); (edit/'safe-cuts.json').write_text('[[1,2]]')
                self.assertFalse(preserve(source, edit, self.policy)); self.assertEqual(calls, [])
                (edit/'safe-cuts.json').write_text('[]'); meta['streams'][1]['codec_name'] = 'alac'
                self.assertFalse(preserve(source, edit, self.policy)); self.assertEqual(calls, [])
                meta['streams'][1]['codec_name'] = 'aac'
                meta['streams'].append(dict(meta['streams'][1], index=2))
                self.assertFalse(preserve(source, edit, self.policy)); self.assertEqual(calls, [])
                meta['streams'].pop(); meta['streams'][1]['duration'] = '9.98'
                self.assertFalse(preserve(source, edit, self.policy)); self.assertEqual(calls, [])
                meta['streams'][1]['duration'] = '10'; meta['streams'][1]['start_time'] = '0.02'
                self.assertFalse(preserve(source, edit, self.policy)); self.assertEqual(calls, [])
                (edit/'report.json').write_text('{"frames":[[0,249]]}')
                with self.assertRaisesRegex(ValueError, 'UNSAFE_NATIVE_TIMELINE'):
                    preserve(source, edit, self.policy)
            finally:
                g['command'], g['probe'] = original_command, original_probe

    @unittest.skipUnless(shutil.which('ffmpeg') and shutil.which('ffprobe'), 'FFmpeg required')
    def test_real_full_span_preserves_source_aac_native_video_and_model_pcm(self):
        import hashlib
        import subprocess
        functions = runpy.run_path(str(helper))
        preserve, audit = functions['preserve_uncut_audio'], functions['audit']
        command = functions['command']
        def run(args):
            subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-y', *args],
                check=True, capture_output=True, timeout=15)
        def digest(path):
            return hashlib.sha256(path.read_bytes()).hexdigest()
        def packets(path, stream):
            return command(['ffprobe', '-v', 'error', '-select_streams', stream,
                '-show_packets', '-show_data_hash', 'sha256', '-show_entries',
                'packet=pts_time,dts_time,duration_time,data_hash,side_data_list', '-of', 'json', str(path)]).stdout
        def pcm(path):
            return command(['ffmpeg', '-nostdin', '-v', 'error', '-i', str(path), '-vn',
                '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', '-f', 'hash', '-hash', 'sha256', '-']).stdout
        with tempfile.TemporaryDirectory() as folder:
            edit = Path(folder); source = edit/'source.mp4'; cut = edit/'cut.mp4'
            run(['-f', 'lavfi', '-i', 'color=c=blue:s=64x64:r=25', '-f', 'lavfi',
                '-i', 'sine=frequency=880:sample_rate=48000', '-t', '2', '-c:v', 'libx264',
                '-preset', 'ultrafast', '-c:a', 'aac', '-b:a', '64k', str(source)])
            run(['-i', str(source), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '27',
                '-af', 'afade=t=in:d=0.008,afade=t=out:st=1.992:d=0.008',
                '-c:a', 'aac', '-b:a', '192k', str(cut)])
            policy = dict(version='quiet-block-v1', fps=25, total=50, blocks=[], blockFrames=[])
            (edit/'safe-cuts.json').write_text('[]')
            (edit/'report.json').write_text('{"frames":[[0,50]]}')
            (edit/'decisions.json').write_text('[{"start":0,"end":2}]')
            original, source_audio, source_pcm = digest(source), packets(source, 'a:0'), pcm(source)
            native_video = packets(cut, 'v:0')
            self.assertNotEqual(pcm(cut), source_pcm)
            audit(edit, policy)
            self.assertTrue(preserve(source, edit, policy))
            audit(edit, policy)
            self.assertEqual(digest(source), original)
            self.assertEqual(packets(cut, 'a:0'), source_audio)
            self.assertEqual(packets(cut, 'v:0'), native_video)
            self.assertEqual(pcm(cut), source_pcm)
            before = digest(cut); (edit/'safe-cuts.json').write_text('[[0.4,0.8]]')
            self.assertFalse(preserve(source, edit, policy))
            self.assertEqual(digest(cut), before)
            self.assertEqual(digest(source), original)
            self.assertFalse(any(edit.glob('uncut-audio-*')))

    def test_final_decisions_and_av_must_match_the_exact_block_plan(self):
        with tempfile.TemporaryDirectory() as folder:
            edit = Path(folder)
            (edit/'safe-cuts.json').write_text('[[1,2]]')
            spans = [dict(start=0, end=1), dict(start=2, end=10)]
            (edit/'decisions.json').write_text(json.dumps(spans))
            audit = functions['audit']
            def metadata(audio=9, video=9):
                return dict(streams=[dict(codec_type='video', start_time='0', duration=str(video)),
                    dict(codec_type='audio', start_time='0', duration=str(audio), sample_rate='48000')])
            audit.__globals__['probe'] = lambda _: metadata()
            audit(edit, self.policy)
            for meta in [metadata(audio=9.1), metadata(video=8.8), {'streams': []},
                dict(streams=metadata()['streams']+[dict(codec_type='audio', start_time='0', duration='9', sample_rate='48000')])]:
                audit.__globals__['probe'] = lambda _, result=meta: result
                with self.assertRaises(ValueError):
                    audit(edit, self.policy)
            (edit/'decisions.json').write_text('[{"start":0,"end":0.9},{"start":2,"end":10}]')
            with self.assertRaisesRegex(ValueError, 'UNSAFE_NATIVE_TIMELINE'):
                audit(edit, self.policy)

    def test_output_timing_rejects_unknown_metadata_and_direct_av_drift(self):
        audit = functions['audit']
        original_probe = audit.__globals__['probe']
        with tempfile.TemporaryDirectory() as folder:
            edit = Path(folder)
            (edit/'safe-cuts.json').write_text('[[1,2]]')
            (edit/'decisions.json').write_text('[{"start":0,"end":1},{"start":2,"end":10}]')
            def metadata(audio=9, video=9):
                return dict(streams=[dict(codec_type='video', start_time='0', duration=str(video)),
                    dict(codec_type='audio', start_time='0', duration=str(audio), sample_rate='48000')])
            try:
                # Keep ordinary frame/AAC rounding within the existing 45ms tolerance.
                for meta in [metadata(), metadata(audio=9.02, video=8.98)]:
                    audit.__globals__['probe'] = lambda _, result=meta: result
                    audit(edit, self.policy)
                invalid = [metadata(audio=9.042, video=8.958)]
                for stream in (0, 1):
                    for field in ('start_time', 'duration'):
                        for value in ('NaN', 'Infinity', '-Infinity', 'N/A', None):
                            meta = metadata(); meta['streams'][stream][field] = value
                            invalid.append(meta)
                        meta = metadata(); del meta['streams'][stream][field]
                        invalid.append(meta)
                for rate in ('0', '-48000', 'N/A', None):
                    meta = metadata(); meta['streams'][1]['sample_rate'] = rate
                    invalid.append(meta)
                for meta in invalid:
                    with self.subTest(metadata=meta), self.assertRaisesRegex(ValueError, 'INVALID_OUTPUT_SYNC'):
                        audit.__globals__['probe'] = lambda _, result=meta: result
                        audit(edit, self.policy)
            finally:
                audit.__globals__['probe'] = original_probe


if __name__ == '__main__':
    unittest.main()
