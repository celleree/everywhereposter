import { alignmentHash, coveringFrames, createSourceMap, removableInteriorFrames, sourceWordId } from '../../libraries/nestjs-libraries/src/media-editing/studio-source-clock';

const source = 'a'.repeat(64);
const identity = { sourceSha256: source, rawAlignmentBytesSha256: 'b'.repeat(64), engineName: 'engine', engineVersion: '1',
  modelArtifactSha256: 'c'.repeat(64), language: 'en', canonicalOptionsSha256: 'd'.repeat(64),
  clock: { fpsNumerator: 30, fpsDenominator: 1, audioSampleRate: 48000, origin: 'known-zero' } };
const alignment = alignmentHash(identity);

it('uses fixed versioned tuple vectors and binds every supplied identity component', () => {
  expect(alignment).toBe('e478b64065b062198c48923475a9f32c435109417c3faba33fa8243b75172e3c');
  expect(sourceWordId(source, alignment, 0)).toBe('a520a7f902e970ff9cf00fa46b079188cd1dd3ad27bad7ffa49b7c64664b4324');
  expect(createSourceMap(source, alignment, 180, [[0, 60], [90, 180]]).mapHash).toBe('8d0ece8d67e484e35e3af74a9dfd52bf1225fc33bda5adc571e19918ca20d2b4');
  for (const change of [{ sourceSha256: 'e'.repeat(64) }, { rawAlignmentBytesSha256: 'e'.repeat(64) },
    { engineName: 'other' }, { engineVersion: '2' }, { modelArtifactSha256: 'e'.repeat(64) },
    { language: 'fr' }, { canonicalOptionsSha256: 'e'.repeat(64) }, { clock: { ...identity.clock, audioSampleRate: 44100 } }]) {
    const changed = alignmentHash({ ...identity, ...change });
    expect(changed).not.toBe(alignment);
    expect(sourceWordId(source, changed, 0)).not.toBe(sourceWordId(source, alignment, 0));
  }
  for (const bad of [{ sourceSha256: 'A'.repeat(64) }, { rawAlignmentBytesSha256: '' }, { engineName: ' ' },
    { clock: { ...identity.clock, fpsNumerator: 29 } }, { clock: { ...identity.clock, origin: 'shifted' } },
    { clock: { ...identity.clock, audioSampleRate: 0 } }, { clock: { ...identity.clock, audioSampleRate: undefined } }])
    expect(() => alignmentHash({ ...identity, ...bad } as any)).toThrow();
  expect(() => sourceWordId(source, alignment, -1)).toThrow();
});

it('rounds the actual binary64 product without correction or clamping', () => {
  expect(coveringFrames(.01, .09, 180)).toEqual([0, 3]);
  expect(removableInteriorFrames(.01, .09, 180)).toEqual([1, 2]);
  expect(coveringFrames(1, 2, 180)).toEqual([30, 60]);
  expect(removableInteriorFrames(1, 2, 180)).toEqual([30, 60]);
  expect(() => removableInteriorFrames(.01, .02, 180)).toThrow();
  const below = 1 - Number.EPSILON / 2, above = 1 + Number.EPSILON;
  expect(coveringFrames(below, above, 180)).toEqual([29, 31]);
  expect(() => removableInteriorFrames(below, above, 180)).toThrow();
  for (const [s, e] of [[NaN, 1], [0, Infinity], [-.1, 1], [1, 1], [2, 1], [0, 6.01]])
    expect(() => coveringFrames(s, e, 180)).toThrow();
});

it('maps ordered half-open intervals and output joins in both directions', () => {
  const uncut = createSourceMap(source, alignment, 180, [[0, 180]]);
  expect([uncut.forward(0), uncut.forward(179), uncut.forward(180)]).toEqual([0, 179, null]);
  const map = createSourceMap(source, alignment, 180, [[0, 60], [90, 180]]);
  expect([map.forward(59), map.forward(60), map.forward(89), map.forward(90), map.forward(180)]).toEqual([59, null, null, 60, null]);
  expect([map.inverse(59), map.inverse(60), map.inverse(149), map.inverse(150)]).toEqual([59, 90, 179, null]);
  for (let i = 0; i < map.outputFrames; i++) expect(map.forward(map.inverse(i)!)).toBe(i);
  expect(createSourceMap(source, alignment, 180, [[0, 60], [60, 180]]).inverse(60)).toBe(60);
  expect(map.mapHash).not.toBe(createSourceMap(source, alignment, 180, [[1, 61], [90, 180]]).mapHash);
  for (const ranges of [[[0, 60], [59, 90]], [[90, 100], [0, 20]], [[0, 0]], [[0, 181]], [[0, 60], [0, 60]]])
    expect(() => createSourceMap(source, alignment, 180, ranges as any)).toThrow();
  expect(() => map.forward(-1)).toThrow(); expect(() => map.inverse(151)).toThrow();
});

it('projects whole fractional words, preserves original IDs, and rejects partial or invalid words', () => {
  const ranges: [number, number][] = [[0, 60], [90, 180]];
  const words = [{ ordinal: 0, text: 'same', start: .01, end: .09 }, { ordinal: 1, text: 'gone', start: 2.1, end: 2.9 },
    { ordinal: 2, text: 'same', start: 3.1, end: 6 }];
  const before = JSON.stringify({ ranges, words });
  const map = createSourceMap(source, alignment, 180, ranges), result = map.projectWords(words);
  expect(result).toEqual([{ ...words[0], id: sourceWordId(source, alignment, 0) },
    { ...words[2], id: sourceWordId(source, alignment, 2), start: 2 + (3.1 - 3), end: 5 }]);
  expect(result[0].id).not.toBe(result[1].id);
  expect(createSourceMap(source, alignment, 180, [[0, 180]]).projectWords(words)[2].id).toBe(result[1].id);
  expect(JSON.stringify({ ranges, words })).toBe(before);
  for (const invalid of [[{ ordinal: 0, text: 'x', start: 1.9, end: 2.1 }],
    [{ ordinal: 0, text: 'x', start: 2.9, end: 3.1 }], [{ ...words[0], end: NaN }],
    [{ ...words[0], end: 0 }], [words[2], words[0]], [words[0], { ...words[1], start: .05 }],
    [{ ...words[0], ordinal: 1.5 }]]) expect(() => map.projectWords(invalid)).toThrow();
});
