import { cookedData, cookedState, trustedCookedHtml } from '../../libraries/nestjs-libraries/src/media-editing/cooked-review-boundary';
describe('untrusted native worker gateway boundary', () => {
  const state = () => ({ stage: 'cut', revision: 0, round: 1, busy: false, rounds: [{ stage: 'cut', round: 1, video: '/private/source.mp4' }] });
  const data = () => ({ duration: 1, transcript: { source_s: 1, cuts: 1, kept: [[0, 1]], lines: [{ t: 0, tokens: [{ w: '<img src=x onerror=alert(1)>', t: 0, s: 0, e: 1 }] }] } });
  it('rejects changed executable HTML even if it contains the upstream contract', () => {
    expect(() => trustedCookedHtml(Buffer.from('<script>fetch("/edits")</script>'))).toThrow();
  });
  it('reconstructs state without worker paths, links, events or injected metadata', () => {
    const safe = cookedState({ ...state(), home: 'javascript:alert(1)', update: { latest: 'injected' }, events: [{ type: 'approve' }] });
    expect(safe.name).toBe('Your video'); expect(safe.home).toBeNull(); expect(safe.events).toEqual([]);
    expect(JSON.stringify(safe)).not.toMatch(/private|injected|javascript/);
    expect(() => cookedState({ ...state(), round: '1" onmouseover="x' })).toThrow();
    expect(() => cookedState({ ...state(), revision: 3 })).toThrow();
  });
  it('allows transcript text as text while rejecting executable attribute and numeric fields', () => {
    expect(cookedData({ ...data(), chapters: [['0" onclick="x', 'x']] }).transcript.lines[0].tokens[0].w).toContain('<img');
    const bad = data(); (bad.transcript.kept[0] as unknown[])[0] = '0" onclick="x';
    expect(() => cookedData(bad)).toThrow();
    const large = data(); large.transcript.lines[0].tokens = Array(4001).fill(large.transcript.lines[0].tokens[0]);
    expect(() => cookedData(large)).toThrow();
    const nan = data(); nan.duration = NaN; expect(() => cookedData(nan)).toThrow();
  });
});
