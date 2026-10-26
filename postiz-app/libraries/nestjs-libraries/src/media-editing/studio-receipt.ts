import { createHash } from 'crypto';

export const studioFingerprint = (value: unknown): string => {
  const canonical = (v: any): any => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object'
    ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
};
const hash = (v: unknown) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);

// Inputs are trusted local worker receipts, never client assertions. The worker
// recomputes current bindings and hashes the actual final before calling this.
export function acceptStudioReceipt(render: any, qa: any, current: any, finalHash: string,
  expected: { projectId: string; revision: number; sourceSha256: string }) {
  const required = ['projectHash', 'prepareReceiptSha256', 'sourceSha256', 'fontSha256', 'audioSha256',
    'rendererHash', 'runtimeHash', 'runtimeConfigSha256', 'lockfileSha256'];
  const tools = ['nodeExecutable', 'pythonExecutable', 'browserExecutable', 'ffmpegExecutable', 'ffprobeExecutable'];
  if (!current || required.some(k => !hash(current[k])) || tools.some(k => !hash(current.toolHashes?.[k])) ||
      current.projectId !== expected.projectId || current.revision !== expected.revision || current.profile !== 'easy-graphics-v1' ||
      current.sourceSha256 !== expected.sourceSha256 || !Object.keys(current.assetHashes || {}).length ||
      Object.values(current.assetHashes).some(v => !hash(v)) || !current.audioTimeline ||
      !['@remotion/bundler', '@remotion/renderer', '@remotion/player', 'remotion'].every(k => current.packages?.[k] === '4.0.530') ||
      current.packages?.react !== '19.0.0' || current.packages?.['react-dom'] !== '19.0.0' || !current.packages?.esbuild ||
      render?.schemaVersion !== 1 || qa?.schemaVersion !== 1 || render.status !== 'RENDERED_QA_PENDING' ||
      qa.status !== 'PASS' || qa.acceptance !== 'TECHNICAL_PASS_CREATIVE_REVIEW_REQUIRED' ||
      qa.creativeApproval !== 'PENDING' || qa.continuousHumanListening !== 'NOT_CLAIMED' ||
      qa.fullDecode !== 'PASS' || qa.sourcePreserved !== true || !hash(finalHash) ||
      render.sha256 !== finalHash || qa.sha256 !== finalHash || render.projectHash !== current.projectHash ||
      qa.projectSha256 !== current.projectHash || render.rendererHash !== current.rendererHash || qa.rendererHash !== current.rendererHash ||
      ![render, qa].every(r => r.projectId === current.projectId && r.revision === current.revision && r.profile === current.profile &&
        studioFingerprint(r.bindings) === studioFingerprint(current)) ||
      !Number.isSafeInteger(render.frames) || render.frames < 1 || qa.frames !== render.frames ||
      !Number.isFinite(qa.durationSeconds) || qa.durationSeconds <= 0 || !Number.isFinite(render.seconds) || Math.abs(qa.durationSeconds - render.seconds) > .001 ||
      !Number.isFinite(qa.audioLagMs) || Math.abs(qa.audioLagMs) > 1 || !Number.isFinite(qa.audioCorrelation) || qa.audioCorrelation <= .995 ||
      !Array.isArray(qa.audioWindows) || qa.audioWindows.some((w: any) => !Number.isFinite(w.correlation) || w.correlation <= .97) ||
      !Number.isFinite(qa.fps) || qa.fps < 24 || qa.fps > 60 || Math.abs(qa.durationSeconds * qa.fps - qa.frames) > .01 ||
      !Array.isArray(qa.resolution) || qa.resolution.length !== 2 || qa.resolution.some((n: any) => !Number.isSafeInteger(n) || n < 320 || n > 3840) ||
      qa.resolution[0] !== render.canvas?.width || qa.resolution[1] !== render.canvas?.height || qa.fps !== render.canvas?.fps) {
    throw new Error('Studio export is stale or needs verification');
  }
  return { schemaVersion: 1, sha256: finalHash, bindings: current, creativeApproval: 'PENDING',
    acceptance: qa.acceptance, limitations: Array.isArray(qa.limitations) ? qa.limitations : [] };
}
