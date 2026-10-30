import assert from 'node:assert/strict';
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
  assert.deepEqual(check(make(['alone'])), [['w0']]); assert.deepEqual(check([]), []);
});
it('separates retained spans at cumulative output boundaries, including exact-boundary words', () => {
  const words = make(['before', 'after', 'next'], [1.8, 2, 2.2], .2);
  assert.deepEqual(check(words, [60, 150]), [['w0'], ['w1', 'w2']]);
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
