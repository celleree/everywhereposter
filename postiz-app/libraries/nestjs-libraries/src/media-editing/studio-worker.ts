import { spawn } from 'child_process';
import { createHash } from 'crypto';
import { createReadStream } from 'fs';
import { copyFile, lstat, mkdir, readFile, realpath, writeFile } from 'fs/promises';
import { isAbsolute, join, resolve, sep } from 'path';
import { prepareEditorSource } from './video-editor-source';
import { acceptStudioReceipt, studioFingerprint } from './studio-receipt';

// Server-only authored input. Never accept manifest paths, executable paths or
// plans from an HTTP request. Creating this aligned plan is an upstream stage.
export interface StudioApprovedPlan { manifest: any; assetMediaIds: Record<string, string> }
export interface StudioRuntime { root: string; file: string; work: string; node: string; python: string }
export const studioHashFile = async (file: string) => {
  const h = createHash('sha256'); for await (const b of createReadStream(file)) h.update(b); return h.digest('hex');
};
export async function studioJson(file: string, limit = 8 * 1024 * 1024) {
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || info.size > limit) throw new Error('Invalid Studio metadata');
  return JSON.parse(await readFile(file, 'utf8'));
}
export async function studioRuntime(org: string): Promise<StudioRuntime> {
  if (process.env.STUDIO_EDITOR_ENABLED !== 'true' || !(process.env.STUDIO_EDITOR_ORGANIZATIONS || '').split(',').includes(org)) throw new Error('Studio is unavailable');
  const root = process.env.STUDIO_EDITOR_PACKAGE_ROOT!, file = process.env.STUDIO_EDITOR_RUNTIME!, work = process.env.STUDIO_EDITOR_WORK_ROOT!;
  if (![root, file, work].every(v => typeof v === 'string' && isAbsolute(v))) throw new Error('Studio runtime is not configured');
  const config = await studioJson(file, 65536);
  if (![config.nodeExecutable, config.pythonExecutable].every(v => typeof v === 'string' && isAbsolute(v))) throw new Error('Studio tools are not configured');
  return { root, file, work, node: config.nodeExecutable, python: config.pythonExecutable };
}

// Bounded offline child process group. No inherited provider credentials, shell,
// arbitrary command or browser service. The deployed worker still needs its own
// memory/disk/network container limits; this supervisor is not a sandbox.
export async function studioCommand(config: StudioRuntime, kind: 'prepare' | 'validate' | 'render' | 'qa' | 'bindings', args: string[]): Promise<string> {
  if (!['prepare', 'validate', 'render', 'qa', 'bindings'].includes(kind)) throw new Error('Unknown Studio command');
  if (process.platform !== 'linux') throw new Error('Studio app worker requires Linux acceptance');
  const python = kind === 'prepare' || kind === 'qa';
  const script = kind === 'prepare' ? 'prepare.py' : kind === 'qa' ? 'qa.py' : kind === 'bindings' ? 'receipt-bindings.mjs' : 'run.mjs';
  const commandArgs = [...(python ? [] : kind === 'bindings' ? [] : [kind]), ...args];
  return new Promise((done, reject) => {
    const env: NodeJS.ProcessEnv = {};
    for (const k of ['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'SYSTEMROOT']) if (process.env[k]) env[k] = process.env[k];
    const child = spawn(python ? config.python : config.node, [join(config.root, script), ...commandArgs], {
      cwd: config.root, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '', size = 0, failed = false;
    const kill = () => { if (child.pid) { try { process.kill(-child.pid, 'SIGKILL'); } catch {} } };
    const fail = () => { failed = true; kill(); };
    const timer = setTimeout(fail, kind === 'render' ? 15 * 60_000 : 3 * 60_000);
    child.stdout.on('data', b => { size += b.length; if (size > 2 * 1024 * 1024) fail(); else stdout += b.toString(); });
    child.stderr.on('data', b => { size += b.length; if (size > 2 * 1024 * 1024) fail(); });
    child.on('error', () => { clearTimeout(timer); kill(); reject(new Error('Studio command could not start')); });
    child.on('close', code => { clearTimeout(timer); kill(); if (code || failed) reject(new Error('Studio command failed; recovery needs verification')); else done(stdout); });
  });
}
const exists = async (file: string) => lstat(file).then(() => true, e => { if (e.code === 'ENOENT') return false; throw e; });
export function studioDirectory(c: StudioRuntime, job: { id: string; generation: number }) {
  if (!/^[0-9a-f-]{36}$/.test(job.id) || !Number.isInteger(job.generation) || job.generation < 1) throw new Error('Invalid worker identity');
  return join(c.work, job.id, 'g' + job.generation);
}
export function assertStudioPlan(job: any, plan: StudioApprovedPlan) {
  const m = plan.manifest, request = job.input.request;
  if (JSON.stringify(plan).length > 2 * 1024 * 1024 || m?.schemaVersion !== 1 || m.project?.profile !== request.profile ||
      !['approved-edl', 'cooked'].includes(m.provenance?.origin) || m.provenance?.proxy !== null ||
      m.provenance.originalSourceSha256 !== m.project?.source?.sha256 || !Array.isArray(m.project?.assets) ||
      m.project.assets.length !== Object.keys(plan.assetMediaIds).length ||
      plan.assetMediaIds[m.project.source.assetId] !== request.sourceMediaId ||
      studioFingerprint([...new Set(Object.values(plan.assetMediaIds))].sort()) !== studioFingerprint([request.sourceMediaId, ...request.brollMediaIds].sort()) ||
      m.project.assets.some((a: any) => !plan.assetMediaIds[a.id] || a.previewFile || a.originalPath) ||
      !Array.isArray(m.project.safeZones?.profiles) || !m.project.safeZones.profiles.length) throw new Error('Approved plan does not bind the admitted media');
  const source = m.project.assets.find((a: any) => a.id === m.project.source.assetId);
  if (!Number.isFinite(source?.duration) || source.duration <= 0 || source.duration > 60 || m.project.assets.length > 9) throw new Error('This initial Studio scope supports up to 60 seconds and eight visual assets');
  // Each destination must be represented; ad-derived/provisional labels remain
  // visible in the package's profile and review limitations.
  if (request.destinations.some((d: string) => !m.project.safeZones.profiles.some((p: string) => p.startsWith(d + '-')))) throw new Error('A selected destination has no safe-zone profile');
}

export async function stageStudioPlan(c: StudioRuntime, job: any, plan: StudioApprovedPlan) {
  assertStudioPlan(job, plan);
  const dir = studioDirectory(c, job); await mkdir(dir, { recursive: true });
  const manifestPath = join(dir, 'manifest.json'), prior = join(dir, 'plan-fingerprint.json');
  const signature = studioFingerprint(plan);
  if (await exists(prior)) {
    if ((await studioJson(prior)).sha256 !== signature) throw new Error('Studio plan changed during recovery');
    return { dir, manifestPath };
  }
  const manifest = JSON.parse(JSON.stringify(plan.manifest));
  manifest.project.id = job.id; manifest.project.revision = job.generation;
  const staged = [];
  for (const asset of manifest.project.assets) {
    const media = job.input.media.find((m: any) => m.id === plan.assetMediaIds[asset.id]);
    if (!media || media.type !== asset.kind) throw new Error('Studio asset type mismatch');
    // Existing configured upload boundary; no client-supplied URL is resolved.
    const prepared = await prepareEditorSource(media.path);
    const file = join(dir, 'input-' + staged.length);
    try {
      if (!(await exists(file))) await copyFile(prepared.inputPath, file);
      if (await studioHashFile(file) !== asset.sha256) throw new Error('Studio asset bytes changed');
    } finally { await prepared.cleanup(); }
    staged.push({ id: asset.id, path: file, sha256: asset.sha256 });
  }
  // Audio/font/Cooked evidence are trusted upstream worker artifacts. Paths are
  // restricted to this explicit work root, not arbitrary client filesystem paths.
  const root = await realpath(c.work) + sep;
  const refs = [manifest.inputs?.audio, manifest.inputs?.font,
    ...(manifest.provenance.origin === 'cooked' ? ['decisions', 'captions', 'receipt'].map(k => manifest.provenance.cooked?.[k]) : [])];
  for (let i = 0; i < refs.length; i++) {
    const ref = refs[i];
    if (!ref || !isAbsolute(ref.path) || !(await realpath(ref.path)).startsWith(root) || (await lstat(ref.path)).isSymbolicLink() ||
        await studioHashFile(ref.path) !== ref.sha256) throw new Error('Unbound upstream Studio artifact');
    const file = join(dir, 'upstream-' + i);
    if (!(await exists(file))) await copyFile(ref.path, file);
    if (await studioHashFile(file) !== ref.sha256) throw new Error('Upstream Studio artifact changed');
    ref.path = file;
  }
  manifest.inputs.assets = staged;
  await writeFile(manifestPath, JSON.stringify(manifest), { flag: 'wx' });
  await writeFile(prior, JSON.stringify({ sha256: signature }), { flag: 'wx' });
  return { dir, manifestPath };
}

export async function inspectStudioExport(c: StudioRuntime, job: any) {
  const dir = studioDirectory(c, job), project = join(dir, 'project');
  const [render, qa, manifest] = await Promise.all([studioJson(join(project, 'render-receipt.json')),
    studioJson(join(project, 'qa/final-verification.json')), studioJson(join(dir, 'manifest.json'))]);
  const current = JSON.parse(await studioCommand(c, 'bindings', [project, c.file]));
  const file = join(project, 'final.mp4'); const sha256 = await studioHashFile(file);
  const accepted = acceptStudioReceipt(render, qa, current, sha256, { projectId: job.id, revision: job.generation,
    sourceSha256: manifest.project.source.sha256 });
  return { file, bytes: (await lstat(file)).size, accepted: { ...accepted, safeZoneProfiles: manifest.project.safeZones.profiles } };
}
export async function runStudioProject(c: StudioRuntime, job: any, plan: StudioApprovedPlan) {
  const { dir, manifestPath } = await stageStudioPlan(c, job, plan), project = join(dir, 'project');
  try { await mkdir(join(dir, 'dispatch-lock')); }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    // A restart/repeated dispatch can recover only a fully verified existing
    // final. It never steals an uncertain native invocation or starts another.
    return inspectStudioExport(c, job);
  }
  if (!(await exists(project))) await studioCommand(c, 'prepare', ['--manifest', manifestPath, '--output', project, '--runtime', c.file]);
  await studioCommand(c, 'validate', [project, '--runtime', c.file]);
  // Never overwrite/re-render an uncertain final. A crash before receipts are
  // complete preserves artifacts and fails closed rather than inventing success.
  if (!(await exists(join(project, 'final.mp4')))) await studioCommand(c, 'render', [project, '--runtime', c.file]);
  await studioCommand(c, 'qa', [project, '--runtime', c.file]);
  return inspectStudioExport(c, job);
}
