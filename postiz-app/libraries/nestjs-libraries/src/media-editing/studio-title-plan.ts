import { copyFile, lstat, mkdir, readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { studioFingerprint } from './studio-receipt';
import { StudioApprovedPlan, StudioRuntime, studioCommand, studioHashFile, studioJson } from './studio-worker';
import { StudioFraming, validateStudioEvidence } from './studio-evidence';
import { ACCEPTED_EDITOR_STYLE, ACCEPTED_FONT_HASHES } from './studio-accepted-timeline';

export async function studioAcceptedFonts(config: StudioRuntime) {
  const fonts = { caption: { path: join(config.root, 'fonts/LiberationSans-Bold.ttf'), sha256: ACCEPTED_FONT_HASHES.caption },
    headline: { path: join(config.root, 'fonts/TikTokSans36pt-Bold.ttf'), sha256: ACCEPTED_FONT_HASHES.headline } };
  for (const font of Object.values(fonts)) {
    const info = await lstat(font.path);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 1024 * 1024 || await studioHashFile(font.path) !== font.sha256) throw Error('Stage the exact approved licensed fonts before creating this edit');
  }
  return fonts;
}

export async function studioTitleFont(config: StudioRuntime) {
  const path = join(config.work, 'Body-Bold.ttf'), info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 10 * 1024 * 1024 ||
      !['00010000', '4f54544f'].includes((await readFile(path)).subarray(0, 4).toString('hex'))) throw Error('Stage the licensed Studio font before direction');
  return { path, sha256: await studioHashFile(path) };
}
function studioOpeningWords(e: ReturnType<typeof validateStudioEvidence>) {
  const end = e.words.findIndex((w, i) => {
    const token = w.text.replace(/["'”’)}\]]+$/, '');
    if (!/[.!?]$/.test(token)) return false;
    if (/[!?]$/.test(token)) return true;
    if (/^(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|[A-Za-z])\.$/i.test(token)) return false;
    const next = e.words[i + 1]?.text.replace(/^["'“‘(]+/, '') ?? '';
    if (/^(?:[A-Za-z]\.){2,}$/.test(token) || /^(?:Inc|Ltd|Corp|Co|vs|etc)\.$/i.test(token)) {
      if (/^[a-z]/.test(next)) return false;
      throw Error('Needs adjustment: ambiguous opening abbreviation');
    }
    if (/^[a-z0-9]/.test(next)) throw Error('Needs adjustment: ambiguous opening sentence boundary');
    return true;
  });
  const words = e.words.slice(0, end + 1), text = words.map(w => w.text).join(' ');
  if (end < 0 || words.length < 3 || words.length > 9 || text.length > 60 || text.split(/\s+/).length > 9) throw Error('Needs adjustment: opening sentence must contain 3-9 words within 60 characters');
  return { words, text };
}
export function studioAcceptedTitle(e: ReturnType<typeof validateStudioEvidence>, headline?: string) {
  const selected = headline === undefined ? studioOpeningWords(e) : { text: headline, words: [] };
  if (!selected.text.trim() || selected.text.length > 60 || /[\u0000-\u001f]/.test(selected.text)) throw Error('Needs adjustment: enter a shorter single-line headline');
  return { version: 1, style: ACCEPTED_EDITOR_STYLE, text: selected.text, wordIds: selected.words.map(w => w.id), from: 0,
    frames: Math.min(135, e.frames), bounds: { x: 108, y: 276, width: 720, height: 132 } };
}
export function studioGroundedTitle(e: ReturnType<typeof validateStudioEvidence>, rectangles: any[], framing: StudioFraming) {
  const { words, text } = studioOpeningWords(e);
  const face = { x: framing.x * 1080 - 20, y: framing.y * 1920 - 20,
    right: (framing.x + framing.width) * 1080 + 20, bottom: (framing.y + framing.height) * 1920 + 20 };
  const slots: any[] = [];
  for (const r of rectangles) {
    const x = Math.ceil(r.x * 1080 + 16), right = Math.floor((r.x + r.width) * 1080 - 16);
    const y = Math.ceil(r.y * 1920 + 16), bottom = Math.floor((r.y + r.height) * 1920 - 16);
    for (const b of [{ x, y, right, bottom: Math.min(bottom, face.y) }, { x, y: Math.max(y, face.bottom), right, bottom },
      { x, y, right: Math.min(right, face.x), bottom }, { x: Math.max(x, face.right), y, right, bottom }]) {
      const width = Math.min(960, Math.floor(b.right - b.x)), height = Math.min(300, Math.floor(b.bottom - b.y));
      if (b.y <= 768 && width >= 400 && height >= 268) slots.push({ x: Math.ceil(b.x), y: Math.ceil(b.y), width, height });
    }
  }
  slots.sort((a, b) => b.width * b.height - a.width * a.height || a.y - b.y || a.x - b.x);
  if (!slots.length || e.totalFrames < 60) throw Error('Needs adjustment: no readable upper title slot');
  return { version: 1, style: 'block-title-v1', text, wordIds: words.map(w => w.id), from: 0,
    frames: Math.min(120, e.totalFrames, Math.max(60, Math.ceil(words.at(-1)!.end * 30))), bounds: slots[0] };
}
export function studioTitledPlan(plan: StudioApprovedPlan, title: any): StudioApprovedPlan {
  return { ...plan, manifest: { ...plan.manifest, schemaVersion: 2,
    project: { ...plan.manifest.project, schemaVersion: 2, profile: 'talking-head-v2', title } } };
}
// Existing candidates are immutable custody. A partial/failed probe is retained
// for verification; recovery never reselects a title or recreates its receipt.
export async function freezeStudioTitle(config: StudioRuntime, dir: string, identity: unknown, font: { path: string; sha256: string }, build: () => StudioApprovedPlan) {
  const candidate = join(dir, 'title-candidate'), binding = studioFingerprint(identity);
  let fresh = false;
  const intent = join(dir, 'title-candidate-intent.json');
  try { await writeFile(intent, JSON.stringify({ binding }), { flag: 'wx', mode: 0o600 }); fresh = true; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    if ((await studioJson(intent)).binding !== binding) throw Error('Frozen Studio title changed; verification required');
  }
  if (fresh) await mkdir(candidate, { mode: 0o700 });
  let plan: StudioApprovedPlan;
  if (fresh) {
    plan = build(); await mkdir(join(candidate, 'public'));
    const path = join(candidate, 'public/font.ttf'); await copyFile(font.path, path, 1);
    if (await studioHashFile(path) !== font.sha256) throw Error('Title font changed while staging');
    plan.manifest.inputs.font = { path, sha256: font.sha256 };
    if (plan.manifest.project.editorStyle === ACCEPTED_EDITOR_STYLE) {
      const headline = (await studioAcceptedFonts(config)).headline, headlinePath = join(candidate, 'public/headline-font.ttf');
      await copyFile(headline.path, headlinePath, 1);
      if (await studioHashFile(headlinePath) !== headline.sha256) throw Error('Headline font changed while staging');
      plan.manifest.inputs.headlineFont = { path: headlinePath, sha256: headline.sha256 };
      await writeFile(join(candidate, 'project.json'), JSON.stringify(plan.manifest.project), { flag: 'wx', mode: 0o600 });
      const captions = JSON.parse(await studioCommand(config, 'accepted-captions', [candidate, '--runtime', config.file]));
      if (!Array.isArray(captions) || studioFingerprint(captions.flatMap(c => c.wordIds)) !== studioFingerprint(plan.manifest.project.words.map((w: any) => w.id))) throw Error('Measured captions changed word identity');
      plan.manifest.project.captions = captions;
      // The provisional singleton project is private planner input, never an
      // accepted render. Freeze the measured project before title preflight.
      await writeFile(join(candidate, 'project.json'), JSON.stringify(plan.manifest.project), { mode: 0o600 });
    }
    else await writeFile(join(candidate, 'project.json'), JSON.stringify(plan.manifest.project), { flag: 'wx', mode: 0o600 });
    await writeFile(join(candidate, 'binding.json'), JSON.stringify({ binding, plan }), { flag: 'wx', mode: 0o600 });
    await studioCommand(config, 'title-preflight', [candidate, '--runtime', config.file]);
  } else {
    const saved = await studioJson(join(candidate, 'binding.json'));
    plan = saved.plan;
    if (saved.binding !== binding || studioFingerprint(await studioJson(join(candidate, 'project.json'))) !== studioFingerprint(plan.manifest.project) ||
        plan.manifest.inputs.font.sha256 !== font.sha256 || await studioHashFile(join(candidate, 'public/font.ttf')) !== font.sha256) throw Error('Frozen Studio title changed; verification required');
  }
  await studioCommand(config, 'title-preflight-check', [candidate, '--runtime', config.file]);
  return { candidate, plan };
}
export async function checkStudioTitleFinal(config: StudioRuntime, candidate: string, plan: StudioApprovedPlan) {
  const file = join(candidate, 'final-project.json');
  try { await writeFile(file, JSON.stringify(plan.manifest.project), { flag: 'wx', mode: 0o600 }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || studioFingerprint(await studioJson(file)) !== studioFingerprint(plan.manifest.project)) throw Error('Studio final title project changed during recovery');
  }
  await studioCommand(config, 'title-preflight-check', [candidate, '--runtime', config.file, '--project', file]);
}
