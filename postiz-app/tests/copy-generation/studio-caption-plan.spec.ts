import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { groupStudioCaptions } from '../../libraries/nestjs-libraries/src/media-editing/studio-caption-plan';

const make = (tokens: string[], starts = tokens.map((_, i) => i * .2), duration = .15) =>
  tokens.map((text, i) => ({ id: 'w' + i, text, start: starts[i], end: starts[i] + duration }));
const ids = (groups: { wordIds: string[] }[]) => groups.map(g => g.wordIds);
function check(words: ReturnType<typeof make>, ends = [300]) {
  const original = JSON.stringify(words), boundaries = [...ends];
  const groups = groupStudioCaptions(words, ends);
  assert.deepEqual(groups.flatMap(g => g.wordIds), words.map(w => w.id));
  assert.ok(groups.every(g => g.wordIds.length >= 1 && g.wordIds.length <= 4));
  assert.equal(JSON.stringify(words), original); assert.deepEqual(ends, boundaries);
  assert.deepEqual(groupStudioCaptions(words, ends), groups);
  return ids(groups);
}
it('splits sentences and long silence without changing names, numbers, case or punctuation', () => {
  const words = make(['Dr.', 'Ada', 'paid', '$1,200.50.', 'Then', 'left!'], [0, .2, .4, .6, 2, 2.2]);
  assert.deepEqual(check(words), [['w0', 'w1', 'w2', 'w3'], ['w4', 'w5']]);
  assert.deepEqual(check(make(['Wait', 'here', 'Carry', 'on'], [0, .2, 2, 2.2])), [['w0', 'w1'], ['w2', 'w3']]);
  assert.deepEqual(check(make(['Yes.', 'Really?', 'Go!'])), [['w0'], ['w1'], ['w2']]);
});
it('uses a 350ms pause threshold and sensible comma boundaries', () => {
  assert.deepEqual(check(make(['one', 'two'], [0, .5])), [['w0'], ['w1']]);
  assert.deepEqual(check(make(['one', 'two'], [0, .499])), [['w0', 'w1']]);
  assert.deepEqual(check(make(['First', 'point,', 'next', 'point'], [0, .31, .61, .91])),
    [['w0', 'w1'], ['w2', 'w3']]);
  assert.deepEqual(check(make(['one,', 'two,', 'three'], [0, .05, .1], .04)), [['w0', 'w1', 'w2']]);
});
it('bounds rapid speech, long text and duration without dropping isolated words or brief phrases', () => {
  assert.deepEqual(check(make(['a', 'b', 'c', 'd', 'e', 'f', 'g'], undefined, .01)),
    [['w0', 'w1', 'w2', 'w3'], ['w4', 'w5', 'w6']]);
  assert.deepEqual(check(make(['Supercalifragilisticexpialidocious', 'works'])), [['w0'], ['w1']]);
  assert.deepEqual(check(make(['extraordinary', 'demonstration', 'today'])), [['w0', 'w1'], ['w2']]);
  assert.deepEqual(check(make(['slow', 'held', 'phrase'], [0, .8, 1.6], .9)), [['w0', 'w1'], ['w2']]);
  const overlap = make(['Yes.', 'Go!', 'Now'], [0, .21, .23], 0);
  overlap[0].end = .24; overlap[1].end = .22; overlap[2].end = .7;
  assert.deepEqual(check(overlap), [['w0', 'w1'], ['w2']]);
  const visible = (groups: string[][], ws = overlap) => {
    const seen = new Set<string>(), byId = new Map(ws.map(w => [w.id, w]));
    for (let frame = 0; frame < 30 * ws[ws.length - 1].end; frame++) {
      const active = groups.find(g => frame >= Math.floor(byId.get(g[0])!.start * 30) &&
        frame < Math.ceil(Math.min(byId.get(g[g.length - 1])!.end + .12, ws[ws.length - 1].end) * 30));
      active?.forEach(id => seen.add(id));
    }
    return [...seen].sort();
  };
  assert.deepEqual(visible(check(overlap)), visible([overlap.map(w => w.id)]));
  const full = make(['a', 'b', 'c', 'long.', 'brief!', 'later'], [0, .01, .02, .03, .04, .3], 0);
  [.1, .11, .12, .5, .1, .7].forEach((end, i) => full[i].end = end);
  assert.deepEqual(check(full), [['w0', 'w1', 'w2', 'w3'], ['w4', 'w5']]);
  assert.deepEqual(visible(check(full), full), visible([['w0', 'w1', 'w2', 'w3'], ['w4', 'w5']], full));
  assert.deepEqual(check(make(['alone'])), [['w0']]); assert.deepEqual(check([]), []);
});
it('separates retained spans at cumulative output boundaries, including exact-boundary words', () => {
  const words = make(['before', 'after', 'next'], [1.8, 2, 2.2], .2);
  assert.deepEqual(check(words, [60, 150]), [['w0'], ['w1', 'w2']]);
  const finalBrief = make(['Before', 'Go!'], [.1, 1], 0);
  finalBrief[0].end = 1; finalBrief[1].end = 1.01;
  // Visibility cannot justify merging across a retained-span seam.
  assert.deepEqual(check(finalBrief, [30, 31]), [['w0'], ['w1']]);
  // Source spans [0,60), [90,180): the removed source second is absent.
  // Using source in=90 as the seam would wrongly merge these output words.
  assert.deepEqual(check(make(['left', 'right'], [1.95, 2], .05), [60, 150]), [['w0'], ['w1']]);
});
it('preserves fractional times, zero-duration and overlapping tokens, isolating seam straddles', () => {
  const words = make(['overlap', 'zero', 'end', 'seam', 'right'], [.1234567, .2, 1.95, 2, 2.01], 0);
  words[0].end = .4; words[2].end = 2; words[3].end = 2.02;
  assert.deepEqual(check(words, [60, 150]), [['w0', 'w1'], ['w2'], ['w3', 'w4']]);
  assert.deepEqual(check(make(['left', 'zero', 'right'], [1.9, 2, 2.01], 0), [60, 150]),
    [['w0'], ['w1'], ['w2']]);
  const tolerated = make(['straddle', 'right'], [1.9995, 2.0001], .001);
  assert.deepEqual(check(tolerated, [60, 150]), [['w0'], ['w1']]);
});

it('keeps zero-duration final tokens visible through actual renderer ranges without crossing internal seams', () => {
  const module = pathToFileURL(resolve(__dirname, '../../../tools/video-studio/13_editing_pipeline/v1/project.mjs')).href;
  const visible = (words: ReturnType<typeof make>, ends: number[], captions = groupStudioCaptions(words, ends)) => {
    const script = `import {readFileSync} from 'node:fs'; import {captionFrameRanges} from ${JSON.stringify(module)};
      const p=JSON.parse(readFileSync(0,'utf8')),ranges=captionFrameRanges(p),seen=new Set();
      for(let frame=0;frame<p.frames;frame++)p.captions.find((_,i)=>frame>=ranges[i][0]&&frame<ranges[i][1])?.wordIds.forEach(id=>seen.add(id));
      process.stdout.write(JSON.stringify([...seen]));`;
    return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      input: JSON.stringify({ canvas: { fps: 30 }, words, captions, frames: ends[ends.length - 1],
        captionTimingPolicy: 'trim-trailing-hold-v1' }), encoding: 'utf8',
    }));
  };
  for (const words of [make(['Before.', 'End'], [.6, 1], 0),
      make(['one', 'two', 'three', 'four', 'End'], [0, .2, .4, .6, 1], .15)]) {
    words[words.length - 2].end = .75; words[words.length - 1].end = 1;
    const groups = check(words, [30]);
    assert.deepEqual(visible(words, [30]), words.map(w => w.id));
    if (words.length === 2) {
      assert.deepEqual(groups, [['w0', 'w1']]);
      assert.deepEqual(visible(words, [30], groupStudioCaptions(words, [30], 'initial-a9a')), ['w0']);
    } else assert.deepEqual(groups, [['w0', 'w1', 'w2'], ['w3', 'w4']]);
  }
  const seam = make(['left', 'zero', 'right'], [.8, 1, 1.01], 0);
  assert.deepEqual(check(seam, [30, 60]), [['w0'], ['w1'], ['w2']]);
});
