import assert from 'node:assert/strict';
import { studioAlignmentEvidence } from '../../libraries/nestjs-libraries/src/media-editing/studio-alignment-evidence';
import { alignmentHash, createSourceMap, projectSourceWords, sourceWordId } from '../../libraries/nestjs-libraries/src/media-editing/studio-source-clock';

const a = 'a'.repeat(64), b = 'b'.repeat(64), c = 'c'.repeat(64);
const expected = { organizationId: 'org', mediaId: 'media' };
function fixture() {
  const raw = [{ text: 'same', start: .101, end: .3 }, { text: 'gone', start: 2.2, end: 2.4 },
    { text: 'same', start: 3.101, end: 3.3 }];
  const value = (v: any, sha256 = c) => ({ sha256, value: v });
  return { schemaVersion: 1, ...expected, jobId: '12345678-1234-1234-1234-123456789abc', revision: 0,
    sourceSha256: a, fps: 30, totalFrames: 180, width: 360, height: 640, audio: { sha256: c, bytes: 1 },
    files: { rawWords: value(raw, b), words: value([{ ...raw[0] }, { ...raw[2], start: 2.101, end: 2.3 }]),
      decisions: value([{ start: 0, end: 2 }, { start: 3, end: 6 }]),
      policy: value({ sourceSha256: a, version: 'quiet-block-v1', fps: 30, total: 180 }),
      report: value({ policy: 'quiet-block-v1', fps: 30, final_s: 5, frames: [[0, 60], [90, 180]] }) } };
}
function identity() {
  return { sourceSha256: a, rawAlignmentBytesSha256: b, engineName: 'synthetic', engineVersion: '1',
    modelArtifactSha256: c, language: 'en', canonicalOptionsSha256: c,
    clock: { fpsNumerator: 30, fpsDenominator: 1, audioSampleRate: 44100, origin: 'known-zero' } };
}
const view = (e: any, id?: any, clocks?: any) => studioAlignmentEvidence(e, expected, id, clocks);
it('reports legacy evidence incomplete and never promotes confidence or caller flags', () => {
  const e: any = fixture(); e.confidence = 1; e.semanticCutsEligible = true; e.humanVerified = true;
  const result = view(e, undefined, { decoded: { domain: 'decoded', sampleRate: 16000 } });
  assert.equal(result.identityStatus, 'incomplete'); assert.equal(result.snapshot, null);
  assert.equal(result.clocks.source.sampleRate, null); assert.equal(result.clocks.output.sampleRate, null);
  assert.equal(result.speechCoverageChecked, false); assert.equal(result.semanticCutsEligible, false);
  assert.equal(result.humanVerified, false); assert.ok(result.missingEvidence.includes('trusted provenance'));
});
it('uses A1 identities and original ordinals after removing an earlier word, preserving fractional times', () => {
  const e = fixture(), before = JSON.stringify(e), id = identity(), result = view(e, id,
    { source: { domain: 'source', sampleRate: 44100, origin: 'known-zero' }, decoded: { domain: 'decoded', sampleRate: 16000 } });
  const hash = alignmentHash(id), map = createSourceMap(a, hash, 180, [[0, 60], [90, 180]]);
  assert.equal(result.identityStatus, 'constructible'); assert.equal(result.snapshot!.alignmentHash, hash);
  assert.equal(result.snapshot!.mapHash, map.mapHash); assert.equal(result.snapshot!.words[1].id, sourceWordId(a, hash, 2));
  assert.notEqual(result.snapshot!.words[0].id, result.snapshot!.words[1].id);
  assert.equal(result.snapshot!.words[0].start, .101); assert.equal(result.clocks.source.sampleRate, 44100);
  assert.equal(result.clocks.decoded.sampleRate, 16000); assert.equal(result.clocks.output.sampleRate, null);
  assert.equal(result.semanticCutsEligible, false); assert.equal(JSON.stringify(e), before);
  assert.notEqual(view(e, { ...id, engineVersion: '2' }).snapshot!.words[0].id, result.snapshot!.words[0].id);
  const later = fixture();
  later.files.report.value.frames = [[90, 180]]; later.files.report.value.final_s = 3;
  later.files.decisions.value = [{ start: 3, end: 6 }];
  later.files.words.value = [{ ...later.files.rawWords.value[2], start: .101, end: .3 }];
  assert.equal(view(later, id).snapshot!.words[0].id, result.snapshot!.words[1].id);

});
it('rejects incomplete identity and mismatched source or original byte digest', () => {
  for (const change of [
    (i: any) => delete i.engineVersion, (i: any) => delete i.modelArtifactSha256,
    (i: any) => delete i.canonicalOptionsSha256, (i: any) => delete i.clock.audioSampleRate,
    (i: any) => i.sourceSha256 = c, (i: any) => i.rawAlignmentBytesSha256 = c,
  ]) { const id = identity(); change(id); assert.throws(() => view(fixture(), id)); }
});
it('rejects zero duration, overlap, partial cuts, changed output and malformed timing', () => {
  const mutations = [
    (e: any) => e.files.rawWords.value[0].end = e.files.rawWords.value[0].start,
    (e: any) => e.files.rawWords.value[1].start = .2,
    (e: any) => e.files.rawWords.value[0].end = 2.1,
    (e: any) => e.files.words.value[0].text = 'changed',
    (e: any) => e.files.words.value[0].start += .1,
    (e: any) => e.files.rawWords.value[0].start = NaN,
    (e: any) => e.files.words.value[0].end = e.files.words.value[0].start,
  ];
  for (const mutate of mutations) { const e = fixture(); mutate(e); assert.throws(() => view(e, identity())); }
});
it('rejects conflicting labels, origins and source rates; decoded rate is not source rate', () => {
  const id = identity();
  for (const clocks of [
    { source: { domain: 'decoded', sampleRate: 44100 } },
    { decoded: { domain: 'source', sampleRate: 16000 } },
    { source: { domain: 'source', sampleRate: 16000 } },
    { source: { domain: 'source', origin: 'shifted' } },
    { output: { domain: 'output', sampleRate: 0 } },
  ]) assert.throws(() => view(fixture(), id, clocks));
  const noFs: any = identity(); delete noFs.clock.audioSampleRate;
  assert.throws(() => view(fixture(), noFs, { decoded: { domain: 'decoded', sampleRate: 16000 } }));
});

it.each([undefined, identity()])('enforces source and output bounds and output agreement with identity %s', id => {
  const beyondSource = fixture();
  beyondSource.files.report.value.frames = [[0, 60]]; beyondSource.files.report.value.final_s = 2;
  beyondSource.files.decisions.value = [{ start: 0, end: 2 }];
  beyondSource.files.rawWords.value = [beyondSource.files.rawWords.value[0], { text: 'late', start: 6, end: 6.0005 }];
  beyondSource.files.words.value = [beyondSource.files.words.value[0]];
  assert.throws(() => view(beyondSource, id));

  const beyondOutput = fixture();
  beyondOutput.files.rawWords.value[2] = { text: 'same', start: 5.8, end: 6 };
  beyondOutput.files.words.value[1] = { text: 'same', start: 4.8, end: 5.0005 };
  assert.throws(() => view(beyondOutput, id));

  const shifted = fixture(); shifted.files.words.value[1].start += .0005;
  assert.throws(() => view(shifted, id));
  // The decimal projection differs by a few binary64 units, but is still the same timing.
  assert.doesNotThrow(() => view(fixture(), id));
});

it('shares A1 projection without an identity and preserves mapping and rejection behavior', () => {
  const ranges: [number, number][] = [[0, 60], [90, 180]];
  const words = fixture().files.rawWords.value.map((w, ordinal) => ({ ...w, ordinal }));
  const before = JSON.stringify({ ranges, words });
  const plain = projectSourceWords(180, ranges, words);
  const identified = createSourceMap(a, alignmentHash(identity()), 180, ranges).projectWords(words);
  assert.deepEqual(identified.map(({ id, ...word }) => word), plain);
  assert.deepEqual(plain.map(w => w.ordinal), [0, 2]);
  assert.equal(JSON.stringify({ ranges, words }), before);
  const partial = [{ ...words[0], end: 2.1 }];
  assert.throws(() => projectSourceWords(180, ranges, partial));
  assert.throws(() => createSourceMap(a, alignmentHash(identity()), 180, ranges).projectWords(partial));
  assert.throws(() => projectSourceWords(180, [[0, 61], [60, 180]], words));
});

it.each([undefined, identity()])('reports missing source clock observations independently of identity %s', id => {
  const absent = view(fixture(), id);
  assert.ok(absent.missingEvidence.includes('observed source sample rate'));
  assert.ok(absent.missingEvidence.includes('observed source origin'));
  const rateOnly = view(fixture(), id, { source: { domain: 'source', sampleRate: 44100 } });
  assert.equal(rateOnly.missingEvidence.includes('observed source sample rate'), false);
  assert.ok(rateOnly.missingEvidence.includes('observed source origin'));
  const originOnly = view(fixture(), id, { source: { domain: 'source', origin: 'known-zero' } });
  assert.ok(originOnly.missingEvidence.includes('observed source sample rate'));
  assert.equal(originOnly.missingEvidence.includes('observed source origin'), false);
  const complete = view(fixture(), id, { source: { domain: 'source', sampleRate: 44100, origin: 'known-zero' } });
  assert.equal(complete.missingEvidence.includes('observed source sample rate'), false);
  assert.equal(complete.missingEvidence.includes('observed source origin'), false);
  assert.ok(complete.missingEvidence.includes('trusted provenance'));
  assert.equal(complete.semanticCutsEligible, false);
});
