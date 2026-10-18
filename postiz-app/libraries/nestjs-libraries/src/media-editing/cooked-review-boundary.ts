import { createHash } from 'crypto';
import { COOKED_EDITOR_LIMITS } from './cooked-editor-limits';

// Only this audited upstream document may execute on the application's origin.
const REVIEW_SHA256 = 'bfdffe39feb7891e07d70a0b31240d1aaa46c9ac8ec3b3dc754625fa8b5685bf';
const fail = (): never => { throw new Error('INVALID_WORKER_RESPONSE'); };
const integer = (v: unknown, min = 0, max = 128): number => typeof v === 'number' && Number.isSafeInteger(v) && v >= min && v <= max ? v : fail();
const seconds = (v: unknown): number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= COOKED_EDITOR_LIMITS.maxDurationMs / 1000 + .1 ? v : fail();
const text = (v: unknown, max = 128): string => typeof v === 'string' && v.length <= max ? v : fail();
const list = (v: unknown, max: number): any[] => Array.isArray(v) && v.length <= max ? v : fail();
export function trustedCookedHtml(bytes: Buffer) {
  if (createHash('sha256').update(bytes).digest('hex') !== REVIEW_SHA256) fail();
  return bytes.toString('utf8');
}
export function cookedState(v: any) {
  if (!v || v.stage !== 'cut' || typeof v.busy !== 'boolean') fail();
  const round = integer(v.round, 1), revision = integer(v.revision, 0, 127);
  const rounds = list(v.rounds, 128).map((r, i) => {
    if (!r || r.stage !== 'cut' || r.round !== i + 1) fail();
    const at = typeof r.at === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z?$/.test(r.at) ? r.at : undefined;
    return { stage: 'cut', round: i + 1, video: 'available', alts: [], final: true, stills: false, at, vertical: r.vertical === true };
  });
  if (round !== rounds.length || revision !== round - 1) fail();
  return { name: 'Your video', stage: 'cut', round, revision, rounds, busy: v.busy, final: true, stills: false, vertical: v.vertical === true,
    comments: [], events: [], alts: [], sent: false, raw: false, rawvideo: true, listening: true,
    page: 'cooked-app-v1', intro: false, home: null, jobs: 0, assets: [], skills: [], made: null };
}
export function cookedData(v: any) {
  if (!v?.transcript) fail();
  let count = 0;
  const lines = list(v.transcript.lines, 2000).map(l => ({ t: l.t == null ? null : seconds(l.t), tokens: list(l.tokens, 4000).map(x => {
    if (++count > 4000 || !x) fail();
    if (x.p != null) return { p: seconds(x.p) };
    const result: Record<string, unknown> = { w: text(x.w), t: x.t == null ? null : seconds(x.t) };
    if (x.s != null) { result.s = seconds(x.s); result.e = seconds(x.e); if ((result.e as number) < (result.s as number)) fail(); }
    if (x.nt != null) { if (![true, false, 0, 1].includes(x.nt)) fail(); result.nt = !!x.nt; }
    if (x.g != null) result.g = integer(x.g, 0, 4000);
    if (x.k != null) { if (!['pause', 'retake', 'filler', 'manual'].includes(x.k)) fail(); result.k = x.k; }
    if (x.n != null) result.n = text(x.n, 512);
    return result;
  }) }));
  const kept = list(v.transcript.kept, 4000).map(r => { if (!Array.isArray(r) || r.length !== 2) fail(); const s = seconds(r[0]), e = seconds(r[1]); if (e < s) fail(); return [s, e]; });
  return { duration: seconds(v.duration), points: [], transcript: { lines, cuts: integer(v.transcript.cuts, 0, 4000), source_s: seconds(v.transcript.source_s), kept, points: [] } };
}
