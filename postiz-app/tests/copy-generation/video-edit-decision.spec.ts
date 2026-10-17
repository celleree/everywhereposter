import { assertValidVideoEditDecisionList, buildVideoEditDecisionList, getKeptDurationMs, parseSilenceDetectionOutput } from '../../libraries/nestjs-libraries/src/media-editing/video-edit-decision';

const input = { mediaId: 'source', durationMs: 6000, pacingPreset: 'balanced' as const, detectedSilence: [{ sourceStartMs: 1000, sourceEndMs: 3000 }] };
describe('versioned video edit decisions', () => {
  it('partitions the source with padding and explicit unaligned provenance', () => {
    const list = buildVideoEditDecisionList(input);
    expect(list.source.transcription).toBeNull();
    expect(list.decisions.map((d) => [d.action, d.sourceStartMs, d.sourceEndMs])).toEqual([
      ['keep', 0, 1120], ['cut', 1120, 2880], ['keep', 2880, 6000],
    ]);
    expect(getKeptDurationMs(list)).toBe(4240);
  });
  it('merges overlapping ranges and handles leading/trailing silence', () => {
    expect(parseSilenceDetectionOutput('silence_start: 0\nsilence_end: 1\nsilence_start: 4', 6000)).toEqual([
      { sourceStartMs: 0, sourceEndMs: 1000 }, { sourceStartMs: 4000, sourceEndMs: 6000 },
    ]);
    const list = buildVideoEditDecisionList({ ...input, detectedSilence: [input.detectedSilence[0], { sourceStartMs: 2500, sourceEndMs: 4000 }] });
    expect(list.decisions[1].sourceEndMs).toBe(3880);
  });
  it('configures pacing without inventing transcript timing', () => {
    const build = (pacingPreset: 'tight' | 'relaxed') => buildVideoEditDecisionList({ ...input, pacingPreset, detectedSilence: [{ sourceStartMs: 1000, sourceEndMs: 1500 }] });
    expect(build('tight').decisions).toHaveLength(3);
    expect(build('relaxed').decisions).toHaveLength(1);
  });
  it('rejects silence-only and excessive segment sources', () => {
    expect(() => buildVideoEditDecisionList({ ...input, detectedSilence: [{ sourceStartMs: 0, sourceEndMs: 6000 }] })).toThrow(expect.objectContaining({ code: 'NO_USEFUL_SEGMENTS' }));
    expect(() => buildVideoEditDecisionList({ ...input, durationMs: 200000, detectedSilence: Array.from({ length: 101 }, (_, i) => ({ sourceStartMs: i * 1500 + 100, sourceEndMs: i * 1500 + 1100 })) })).toThrow(expect.objectContaining({ code: 'TOO_MANY_SEGMENTS' }));
  });
  it.each(['version', 'gap', 'nan', 'duplicate', 'caption', 'unaligned', 'all-cut'])('rejects unsupported or corrupt %s decisions', (kind) => {
    const list = buildVideoEditDecisionList(input);
    if (kind === 'version') (list as any).schemaVersion = 2;
    if (kind === 'gap') list.decisions[1].sourceStartMs++;
    if (kind === 'nan') list.decisions[0].sourceEndMs = NaN;
    if (kind === 'duplicate') list.decisions[1].id = list.decisions[0].id;
    if (kind === 'caption') list.tracks.captions.push({ id: 'caption', outputStartMs: 0, outputEndMs: 100, text: 'test' });
    if (kind === 'unaligned') list.source.transcription = { id: 't', generation: 1, alignment: 'word' as any };
    if (kind === 'all-cut') list.decisions.forEach((d) => d.action = 'cut');
    expect(() => assertValidVideoEditDecisionList(list)).toThrow();
  });
});
