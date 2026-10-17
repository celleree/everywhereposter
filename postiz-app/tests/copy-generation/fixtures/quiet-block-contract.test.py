import json
from pathlib import Path
import runpy
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
            for meta in [metadata(audio=9.1), metadata(video=8.8), {'streams': []}]:
                audit.__globals__['probe'] = lambda _, result=meta: result
                with self.assertRaises(ValueError):
                    audit(edit, self.policy)
            (edit/'decisions.json').write_text('[{"start":0,"end":0.9},{"start":2,"end":10}]')
            with self.assertRaisesRegex(ValueError, 'UNSAFE_NATIVE_TIMELINE'):
                audit(edit, self.policy)


if __name__ == '__main__':
    unittest.main()
