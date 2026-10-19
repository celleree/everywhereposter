import { test, expect, openApp, reachable, noHorizontalOverflow, capture } from './fixtures';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import type { Page } from '@playwright/test';
import { trustedCookedHtml, cookedState, cookedData } from '../../libraries/nestjs-libraries/src/media-editing/cooked-review-boundary';
import { adaptCookedReviewHtml } from '../../libraries/nestjs-libraries/src/media-editing/cooked-review-html';

// Actual hash-pinned native review UI; all processing/API results below are synthetic.
// This proves UI contracts and reachability, not transcription, render quality or tenant auth.
const native = trustedCookedHtml(gunzipSync(readFileSync('tests/browser/assets/cooked-review.html.gz')));
const html = adaptCookedReviewHtml(native);
const bytes = readFileSync('tests/browser/assets/synthetic-picker.mp4');
const sourceHash = createHash('sha256').update(bytes).digest('hex');
const source = { id: 'cooked-source', name: 'Synthetic UI fixture.mp4', originalName: 'Synthetic UI fixture.mp4', path: '/audit-fixtures/cooked-source.mp4', type: 'video' };
const output = { ...source, id: 'cooked-output', path: '/audit-fixtures/cooked-output.mp4', originalName: 'Saved synthetic UI fixture.mp4' };
const jobId = 'b2eb8d01-443d-4d49-8b3c-617afaa9c28f';
const blocks = [[7 / 30, 13 / 30], [16 / 30, 22 / 30]];
type Mode = { empty?: boolean; reject?: number; receiptFailure?: boolean; holdPrepare?: Promise<void>; holdEdit?: Promise<void>; holdSave?: Promise<void>; lostSave?: boolean; lostPrepare?: boolean; failSource?: boolean };
async function fixture(page: Page, mode: Mode = {}) {
  let requestId = '', revision = 0, removed: number[][] = [], creates = 0, saves = 0, mutations = 0, posts = 0, uploaded = false, transfer: any;
  const receipt = () => ({ requestId, jobId, revision, status: 'ready', editing: { mode: 'quiet-block-v1', wordCuts: false, arbitraryPhrases: false, pauseEdits: false, blocks: mode.empty ? [] : blocks, removedBlocks: removed } });
  await page.route('**/audit-fixtures/**', route => route.fulfill({ contentType: 'video/mp4', body: bytes }));
  await page.route('**/backend-api/**', async route => {
    const req = route.request(), url = new URL(req.url()), p = url.pathname.replace('/backend-api', ''), method = req.method();
    if (/^\/posts(?:\/|$)/.test(p) && method !== 'GET') { posts++; return route.fulfill({ status: 405, json: {} }); }
    if (p === '/integrations/list') return route.fulfill({ json: { integrations: [{ id: 'fixture-channel', providerIdentifier: 'x', identifier: 'x', type: 'social', name: 'Fixture account', picture: '/icons/platforms/x.png', disabled: false }] } });
    if (p === '/media/cooked/status') return route.fulfill({ json: { enabled: true, ready: true } });
    if (p === '/media/uploads' && method === 'GET') return route.fulfill({ json: { sessions: transfer ? [transfer] : [] } });
    if (p === '/media/uploads' && method === 'POST') {
      transfer = { ...req.postDataJSON(), id: 'cooked-upload', status: 'UPLOADING', parts: [] };
      return route.fulfill({ json: transfer });
    }
    if (p.startsWith('/media/uploads/cooked-upload')) {
      if (method === 'PUT') transfer.parts.push({ index: 0, byteSize: bytes.length, digest: transfer.manifest[0] });
      if (p.endsWith('/complete')) { uploaded = true; transfer = { ...transfer, status: 'COMPLETE', media: source }; }
      return route.fulfill({ json: transfer });
    }
    if (p === '/media' || p === '/media/post-attached') return route.fulfill({ json: { pages: 1, results: [source] } });
    if (p === '/media/cooked-source') return route.fulfill({ status: mode.failSource ? 503 : 200, json: source });
    if (p === '/media/cooked-output') return route.fulfill({ json: output });
    if (!p.startsWith('/media/cooked/')) return route.fallback();
    if (p === '/media/cooked/cooked-source' && method === 'POST') {
      creates++; requestId = req.postDataJSON().requestId; await mode.holdPrepare;
      if (mode.lostPrepare) return route.abort('failed');
      return route.fulfill({ json: receipt() });
    }
    if (p.endsWith('/find')) return route.fulfill({ status: mode.receiptFailure && req.frame().parentFrame() ? 503 : 200, json: receipt() });
    if (method === 'DELETE') return route.fulfill({ json: {} });
    if (p.endsWith('/review')) return route.fulfill({ contentType: 'text/html', body: html });
    if (p.endsWith('/state')) return route.fulfill({ json: cookedState({ stage: 'cut', round: revision + 1, revision, busy: false,
      rounds: Array.from({ length: revision + 1 }, (_, i) => ({ stage: 'cut', round: i + 1 })) }) });
    if (p.endsWith('/data')) {
      const r = Number(url.searchParams.get('k')?.split('-')[1]) - 1;
      const cuts = r === 1 ? [blocks[0]] : [];
      const words = 'Synthetic UI fixture only these words demonstrate the actual native review screen and exact block interactions'.split(' ');
      return route.fulfill({ json: cookedData({ duration: 1, transcript: { source_s: 1, cuts: cuts.length, kept: cuts.length ? [[0, blocks[0][0]], [blocks[0][1], 1]] : [[0, 1]],
        lines: [{ t: 0, tokens: words.map((w, i) => ({ w, s: i / words.length, e: (i + 1) / words.length, t: i / words.length })) }] } }) });
    }
    if (p.endsWith('/video') || p.endsWith('/download')) return route.fulfill({ contentType: 'video/mp4', body: bytes });
    if (p.endsWith('/edits') && method === 'POST') {
      mutations++; const body = req.postDataJSON();
      expect(req.headers()['content-type']).toContain('application/json');
      expect(body.revision).toBe(revision);
      expect(Object.keys(body).sort()).toEqual(['revision', removed.length ? 'restore' : 'cut'].sort());
      expect(body[removed.length ? 'restore' : 'cut']).toEqual([blocks[0]]);
      await mode.holdEdit;
      if (mode.reject) { const status = mode.reject; mode.reject = undefined; if (status === 409) revision++; return route.fulfill({ status, json: {} }); }
      removed = removed.length ? [] : [blocks[0]]; revision++;
      return route.fulfill({ json: { event: true, revision } });
    }
    if (p.endsWith('/output') && method === 'POST') {
      saves++; expect(req.postDataJSON()).toEqual({ revision }); await mode.holdSave;
      if (mode.lostSave) return route.abort('failed');
      return route.fulfill({ json: { outputMedia: output, revision } });
    }
    return route.fulfill({ status: 404, json: {} });
  });
  return { receipt, stats: () => ({ creates, saves, mutations, posts, uploaded, sourceHash, currentSourceHash: createHash('sha256').update(bytes).digest('hex') }) };
}
async function choose(page: Page, uploaded = false) {
  await page.getByRole('button', { name: 'Choose video', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Media Library', exact: true });
  if (uploaded) await picker.locator('input[type=file]').first().setInputFiles({ name: source.originalName, mimeType: 'video/mp4', buffer: bytes });
  else await picker.getByRole('button', { name: 'Select ' + source.originalName, exact: true }).click({ position: { x: 10, y: 10 } });
  if (await picker.isVisible()) await picker.getByRole('button', { name: 'Add selected media', exact: true }).click();
  await expect(picker).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Prepare video', exact: true })).toBeEnabled();
}
const frame = (page: Page) => page.frameLocator('iframe[title="Cooked video review"]');
const cut = (page: Page) => frame(page).getByRole('button', { name: /^Cut block 1\b/ });
const restore = (page: Page) => frame(page).getByRole('button', { name: /^Restore block 1\b/ });
async function prepare(page: Page) {
  await page.getByRole('button', { name: 'Prepare video', exact: true }).click();
  await expect(frame(page).locator('#txlines .tw').first()).toBeVisible();
}

test('Cooked mobile: explicit preparation, exact blocks, recovery and saved composer handoff', async ({ page }, info) => {
  const f = await fixture(page); await openApp(page, '/video-editor'); await choose(page);
  expect(f.stats().creates).toBe(0);
  await expect(page.getByLabel('Original video preview')).toBeVisible();
  await prepare(page); await expect(cut(page)).toBeEnabled();
  await expect(frame(page).locator('#txbar')).toBeHidden();
  await expect(frame(page).locator('#txtools')).toBeHidden();
  await reachable(cut(page));
  if (info.project.name.startsWith('phone-')) await cut(page).tap(); else await cut(page).click();
  await expect(restore(page)).toBeEnabled();
  await expect(frame(page).locator('#v')).toHaveAttribute('src', /k=cut-2/);
  await reachable(restore(page)); await restore(page).focus(); await page.keyboard.press('Enter'); await expect(cut(page)).toBeEnabled();
  await page.reload(); await expect(cut(page)).toBeEnabled(); expect(f.stats().creates).toBe(1);
  await expect.poll(() => frame(page).locator('#v').evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThanOrEqual(1);
  await frame(page).getByRole('button', { name: 'Compare', exact: true }).click();
  await expect(frame(page).locator('#p2')).toBeVisible();
  const comparison = frame(page).getByRole('combobox', { name: 'compare with', exact: true });
  await reachable(comparison); await comparison.selectOption('1');
  await expect(frame(page).locator('#v2')).toHaveAttribute('src', /k=cut-1/);
  await frame(page).getByRole('button', { name: 'Watch', exact: true }).click();

  for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport); await noHorizontalOverflow(page); await reachable(cut(page));
    await reachable(page.getByRole('button', { name: 'Save current edit', exact: true }));
    const size = await page.locator('iframe').evaluate((el: HTMLIFrameElement) => ({ width: el.clientWidth, scroll: el.contentDocument?.documentElement.scrollWidth }));
    expect(size.scroll).toBeLessThanOrEqual(size.width + 1);
    await capture(page, info, 'cooked-review-' + viewport.width + 'x' + viewport.height);
  }
  await page.getByRole('button', { name: 'Save current edit', exact: true }).click();
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: /Download (saved )?MP4/, exact: false }).click();
  const download = await downloadEvent; const dest = info.outputPath('cooked-saved.mp4'); await download.saveAs(dest);
  expect(readFileSync(dest)).toEqual(bytes);
  await page.getByRole('button', { name: /Use (saved copy )?in composer/ }).click();
  await expect(page.locator('#social-content')).toBeVisible();
  await expect(page.locator('#social-content video').first()).toHaveAttribute('src', output.path);
  await capture(page, info, 'cooked-composer');
  expect(f.stats()).toMatchObject({ creates: 1, saves: 1, mutations: 2, posts: 0, currentSourceHash: sourceHash });
});

test('Cooked mobile: upload, preparing state and duplicate submits', async ({ page }) => {
  let prepared!: () => void, edited!: () => void, saved!: () => void;
  const mode: Mode = { holdPrepare: new Promise(r => { prepared = r; }), holdEdit: new Promise(r => { edited = r; }), holdSave: new Promise(r => { saved = r; }) };
  const f = await fixture(page, mode); await openApp(page, '/video-editor'); await choose(page, true);
  expect(f.stats().uploaded).toBe(true); expect(f.stats().creates).toBe(0);
  await page.getByRole('button', { name: 'Prepare video', exact: true }).evaluate((b: HTMLButtonElement) => { b.click(); b.click(); });
  await expect.poll(() => f.stats().creates).toBe(1); await expect(page.getByRole('button', { name: 'Choose video', exact: true })).toBeDisabled();
  prepared(); await expect(cut(page)).toBeEnabled();
  await cut(page).evaluate((b: HTMLButtonElement) => { b.click(); b.click(); });
  await expect.poll(() => f.stats().mutations).toBe(1);
  await expect(page.getByRole('button', { name: 'Save current edit', exact: true })).toBeDisabled();
  edited(); await expect(restore(page)).toBeEnabled();
  await page.getByRole('button', { name: 'Save current edit', exact: true }).evaluate((b: HTMLButtonElement) => { b.click(); b.click(); });
  await expect.poll(() => f.stats().saves).toBe(1); saved();
  await expect(page.getByRole('button', { name: /Use (saved copy )?in composer/ })).toBeEnabled();
  expect(f.stats().posts).toBe(0);
});

for (const status of [409, 422]) test('Cooked mobile: rejected edit ' + status + ' refreshes without automatic retry', async ({ page }) => {
  const f = await fixture(page, { reject: status }); await openApp(page, '/video-editor'); await choose(page); await prepare(page);
  await cut(page).click(); await expect(frame(page).getByRole('status').filter({ hasText: /revision changed|block edit was rejected/ })).toBeVisible();
  expect(f.stats().mutations).toBe(1);
  await expect(cut(page)).toBeEnabled(); await cut(page).click(); await expect(restore(page)).toBeEnabled();
  expect(f.stats().mutations).toBe(2);
});

test('Cooked mobile: no eligible blocks and unavailable receipts fail closed', async ({ page }) => {
  const mode: Mode = { empty: true }; await fixture(page, mode); await openApp(page, '/video-editor'); await choose(page); await prepare(page);
  await expect(frame(page).getByText(/no eligible/i)).toBeVisible(); await expect(cut(page)).toHaveCount(0);
  mode.receiptFailure = true; await page.reload();
  await expect(frame(page).getByRole('button', { name: 'Retry loading editing controls', exact: true })).toBeVisible();
  mode.receiptFailure = false; mode.empty = false;
  await frame(page).getByRole('button', { name: 'Retry loading editing controls', exact: true }).click(); await expect(cut(page)).toBeEnabled();
});

test('Cooked mobile: uncertain save survives reload without another save', async ({ page }) => {
  const f = await fixture(page, { lostSave: true }); await openApp(page, '/video-editor'); await choose(page); await prepare(page);
  await page.getByRole('button', { name: 'Save current edit', exact: true }).click();
  await expect(page.getByRole('main', { name: 'Video Editor workspace' }).getByRole('alert')).toContainText('Media Library');
  await page.reload(); await expect(cut(page)).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Save current edit', exact: true })).toBeDisabled(); expect(f.stats().saves).toBe(1);
});


test('Cooked mobile: source failure and uncertain preparation recover deliberately', async ({ page }) => {
  const mode: Mode = { failSource: true, lostPrepare: true }; const f = await fixture(page, mode);
  await openApp(page, '/video-editor');
  await page.getByRole('button', { name: 'Choose video', exact: true }).click();
  let picker = page.getByRole('dialog', { name: 'Media Library', exact: true });
  await picker.getByRole('button', { name: 'Select ' + source.originalName, exact: true }).click({ position: { x: 10, y: 10 } });
  await picker.getByRole('button', { name: 'Add selected media', exact: true }).click();
  await expect(page.getByRole('main', { name: 'Video Editor workspace' }).getByRole('alert')).toBeVisible();
  expect(f.stats().creates).toBe(0); mode.failSource = false;
  await choose(page); await page.getByRole('button', { name: 'Prepare video', exact: true }).click();
  await expect(page.getByRole('main', { name: 'Video Editor workspace' }).getByRole('alert')).toContainText('uncertain');
  await page.getByRole('button', { name: 'Recover session', exact: true }).click();
  await expect(cut(page)).toBeEnabled(); expect(f.stats().creates).toBe(1);
  await page.evaluate(() => window.postMessage({ type: 'ep-cooked-review', height: 20000, busy: true }, location.origin));
  await expect(page.getByRole('button', { name: 'Save current edit', exact: true })).toBeEnabled();
  await expect(page.locator('iframe')).not.toHaveCSS('height', '20000px');
});
