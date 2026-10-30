import { alignmentHash, coveringFrames, createSourceMap, removableInteriorFrames, sourceWordId } from '../../libraries/nestjs-libraries/src/media-editing/studio-source-clock';

const source = 'a'.repeat(64);
const identity = { sourceSha256: source, rawAlignmentBytesSha256: 'b'.repeat(64), engineName: 'fixture-aligner', engineVersion: '1.0.0',
  modelArtifactSha256: 'c'.repeat(64), language: 'en', canonicalOptionsSha256: '44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a',
  clock: { fpsNumerator: 30, fpsDenominator: 1, audioSampleRate: 48000, origin: 'known-zero' } };
const alignment = alignmentHash(identity);

it('uses fixed versioned tuple vectors and binds every supplied identity component', () => {
  expect(alignment).toBe('3e36f18abf3dada533d6d66835c6b0546386467577981be9f809c87b86357b02');
  expect(sourceWordId(source, alignment, 0)).toBe('53c43924db849d399b4e61f244546dd4e9ee73a5d79a50c25b82112f934c5d66');
  expect(sourceWordId(source, alignment, 1)).toBe('7541ec0967de7bf9cf12121bd6f269131c66090e1f94e2a152e4e186f42f104c');
  expect(createSourceMap(source, alignment, 180, [[0, 60], [90, 180]]).mapHash).toBe('e1cad0d5aee58b59939cf5803921685438c8631975b80fd5e212287f4266a81b');
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
