import { test, expect, type Page } from '@playwright/test';
import { reachable } from './fixtures';
import { readFileSync } from 'node:fs';

test.skip(process.env.EP_COOKED_BROWSER !== '1', 'Requires the isolated authenticated Cooked runtime');
test.setTimeout(240_000);
test.use({ actionTimeout: 30_000 });

async function state(page: Page, base: string) {
  const response = await page.request.get(base + '/state');
  expect(response.ok()).toBe(true);
  return response.json();
}

test('Cooked authenticated native editor: whole blocks, history, recovery, saved Media and composer review', async ({ page, context, request, isMobile }, info) => {
  const sessionResponse = await request.get('http://127.0.0.1:4548/__cooked/session');
  expect(sessionResponse.ok()).toBe(true);
  const { token, otherToken } = await sessionResponse.json();
  await context.addCookies([{ name: 'auth', value: token, url: 'http://127.0.0.1:4547', httpOnly: true, sameSite: 'Lax' }]);
  const readFaults = { state: 0, data: 0 };
  await page.route('**/backend-api/media/cooked/**', async route => {
    const view = new URL(route.request().url()).pathname.split('/').pop();
    if (route.request().method() !== 'GET' || (view !== 'state' && view !== 'data') || readFaults[view]) return route.fallback();
    // Observe a real successful native read first, then inject exactly one transient response.
    const actual = await route.fetch();
    if (!actual.ok()) return route.fulfill({ response: actual });
    readFaults[view]++;
    await route.fulfill({ status: 503, json: { message: 'Controlled transient read failure' } });
  });
  let editing: { sourceId: string; requestId: string; jobId: string } | undefined;
  const requests: string[] = [];
  page.on('request', r => { if (r.method() !== 'GET' && r.url().includes('/backend-api/')) requests.push(new URL(r.url()).pathname); });
    await expect.poll(async () => {
      const health = await page.request.get('/backend-api/media/cooked/status');
      return health.ok() && (await health.json()).enabled;
    }, { timeout: 45_000 }).toBe(true);
    await page.goto('/video-editor');
    const created = page.waitForResponse(r => r.request().method() === 'POST' && /^\/backend-api\/media\/cooked\/[\w-]+$/.test(new URL(r.url()).pathname));
    await page.getByRole('button', { name: 'Choose video', exact: true }).click();
    const picker = page.getByRole('dialog', { name: 'Media Library', exact: true });
    if (!isMobile) {
      const source = await page.request.get('/backend-api/__video-editor/assets/editor-source.mp4');
      expect(source.ok()).toBe(true);
      const buffer = await source.body();
      expect(buffer.length).toBeLessThan(1024 * 1024);
      await picker.locator('input[type=file]').first().setInputFiles({ name: 'Owned uploaded.mp4', mimeType: 'video/mp4', buffer });
      await expect.poll(async () => (await (await page.request.get('/backend-api/__video-editor/stats')).json()).uploaded).toBe(true);
    } else await picker.getByRole('button', { name: 'Select Owned talking head.mp4', exact: true }).click({ position: { x: 10, y: 10 } });
    if (await picker.isVisible()) await picker.getByRole('button', { name: 'Add selected media', exact: true }).click();
    await expect(picker).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Prepare video', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Prepare video', exact: true }).click();
    expect((await created).ok()).toBe(true);
    // Only the normal chooser creates a session; no imported JSON, mocked route or engine mutation.
    await expect(page.getByTitle('Cooked video review')).toBeVisible({ timeout: 120_000 });
    editing = await page.evaluate(() => {
      const key = Object.keys(localStorage).find(k => k.startsWith('everywhereposter:cooked-review:v1:'))!;
      return JSON.parse(localStorage.getItem(key)!);
    });
    expect(editing?.sourceId).toBe(isMobile ? 'editor-source' : 'editor-uploaded');
    const base = '/backend-api/media/cooked/' + editing!.sourceId + '/' + editing!.jobId;
    const foreign = await page.request.get(base + '/state', { headers: { Cookie: 'auth=' + otherToken } });
    expect([403, 404]).toContain(foreign.status());
    let frame = page.frameLocator('iframe[title="Cooked video review"]');
    // The injected state-read failure requires a deliberate refresh, never a mutation retry.
    await frame.getByRole('button', { name: 'Retry loading editing controls', exact: true }).click();
    const words = frame.locator('#txlines .tw:not(.nt)');
    await expect.poll(() => words.count(), { timeout: 30_000 }).toBeGreaterThan(15);
    expect(readFaults).toEqual({ state: 1, data: 1 });
    const before = await state(page, base);
    expect(before.revision).toBe(0);
    await expect(frame.locator('#txtools [data-apply]')).toHaveCount(0);
    const receiptResponse = await page.request.get('/backend-api/media/cooked/' + editing!.sourceId + '/find?request=' + editing!.requestId);
    expect(receiptResponse.ok()).toBe(true);
    const receipt = await receiptResponse.json();
    expect(receipt.editing.mode).toBe('quiet-block-v1');
    expect(receipt.editing.wordCuts).toBe(false);
    expect(receipt.editing.blocks.length).toBeGreaterThan(0);
    for (const [operation, revision] of [['Cut', 1], ['Restore', 2]] as const) {
      const mutation = page.waitForResponse(r => r.url().includes(base + '/edits') && r.request().method() === 'POST');
      const button = frame.getByRole('button', { name: new RegExp('^' + operation + ' block 1 [(]') });
      await expect(button).toBeEnabled();
      await reachable(button); if (isMobile) await button.tap(); else await button.click();
      const response = await mutation;
      expect(response.ok()).toBe(true);
      expect(response.request().postDataJSON()).toEqual({ revision: revision - 1, [operation.toLowerCase()]: [receipt.editing.blocks[0]] });
      await expect.poll(async () => (await state(page, base)).revision).toBe(revision);
    }
    const after = await state(page, base);
    expect(after.rounds.length).toBeGreaterThan(before.rounds.length + 1);
    await frame.getByRole('button', { name: 'Compare', exact: true }).click();
    await expect(frame.locator('#ver2 option')).toHaveCount(after.rounds.length - 1);
    await frame.locator('#ver2').selectOption(String(after.rounds.length - 2));
    await expect(frame.locator('#v2')).toHaveAttribute('src', /k=cut-1/);
    await expect.poll(() => frame.locator('#v2').evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThanOrEqual(1);
    await frame.getByRole('button', { name: 'Watch', exact: true }).click();
    await expect(frame.locator('#txlines .tw').first()).toBeVisible();
    await frame.getByRole('button', { name: 'play or pause' }).click();
    await expect.poll(() => frame.locator('#v').evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(0.1);
    await frame.getByRole('button', { name: 'play or pause' }).click();
    const video = await frame.locator('#v').getAttribute('src');
    const range = await page.request.get(new URL(video!, 'http://127.0.0.1:4547' + base + '/review').toString(), { headers: { Range: 'bytes=0-1023' } });
    expect(range.status()).toBe(206);
    expect(range.headers()['content-range']).toMatch(/^bytes 0-1023\//);
    const found = page.waitForResponse(r => r.url().includes('/find?request=') && r.request().method() === 'GET');
    await page.reload();
    expect((await found).ok()).toBe(true);
    frame = page.frameLocator('iframe[title="Cooked video review"]');
    await expect(frame.locator('#txlines .tw').first()).toBeVisible();
    expect((await state(page, base)).revision).toBe(2);
    const savedResponse = page.waitForResponse(r => r.url().endsWith(base + '/output') && r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Save current edit', exact: true }).click();
    const saved = await (await savedResponse).json();
    expect(saved.revision).toBe(2); expect(saved.outputMedia.id).not.toBe(editing!.sourceId);
    await expect(page.getByText('Saved copy · revision 2.', { exact: false })).toBeVisible();
    const downloadEvent = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download saved MP4', exact: true }).click();
    const download = await downloadEvent;
    const destination = info.outputPath('cooked-saved.mp4');
    await download.saveAs(destination);
    const savedBytes = await page.request.get(saved.outputMedia.path);
    expect(savedBytes.ok()).toBe(true);
    expect(readFileSync(destination)).toEqual(await savedBytes.body());
    expect(readFileSync(destination).length).toBeGreaterThan(1024);
    await page.screenshot({ path: info.outputPath('cooked-native-editor.png'), fullPage: true });
    await page.getByRole('button', { name: 'Use saved copy in composer', exact: true }).click();
    const composer = page.locator('#social-content');
    await expect(composer).toBeVisible();
    await expect(composer.locator('video').first()).toBeVisible();
    await expect(composer.locator('video').first()).toHaveAttribute('src', saved.outputMedia.path);
    await page.screenshot({ path: info.outputPath('cooked-composer-review.png'), fullPage: true });
    const statsResponse = await page.request.get('/backend-api/__video-editor/stats');
    expect(statsResponse.ok()).toBe(true);
    const stats = await statsResponse.json();
    expect(stats.outputIds).toContain(saved.outputMedia.id);
    expect(stats.currentHash).toBe(stats.originalHash);
    if (!isMobile) expect(stats.uploadedHash).toBe(stats.originalHash);
    expect(stats.postWrites).toBe(0);
    expect(requests.some(p => /^\/backend-api\/posts(?:\/|$)/.test(p))).toBe(false);
    await info.attach('verified-behavior', { body: JSON.stringify({ project: info.project.name, gesture: isMobile ? 'touch block button' : 'mouse block button', revision: after.revision, rounds: after.rounds.length, outputCount: stats.outputIds.length, originalPreserved: true, postWrites: stats.postWrites, readFaults }), contentType: 'application/json' });

});

test.afterEach(async ({ page }, info) => {
  if (info.status !== info.expectedStatus) {
    const editor = page.frames().find(frame => /\/media\/cooked\/.*\/review/.test(frame.url()));
    const geometry = await editor?.evaluate(() => ['#tx', '#pair', '#txbar', '#cmprow', '[data-op=restore]', '[data-op=cut]'].map(selector => {
      const el = document.querySelector(selector); if (!el) return { selector };
      const rect = el.getBoundingClientRect(), style = getComputedStyle(el);
      const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      return { selector, rect: rect.toJSON(), position: style.position, zIndex: style.zIndex, contain: style.contain, overflow: style.overflow, hit: hit?.tagName + '#' + hit?.id };
    })).catch(() => undefined);
    if (geometry) await info.attach('failure-geometry', { body: JSON.stringify(geometry), contentType: 'application/json' });
  }
  // Playwright gives teardown its own timeout, including when the test body times out.
  const editing = await page.evaluate(() => {
    const key = Object.keys(localStorage).find(k => k.startsWith('everywhereposter:cooked-review:v1:'));
    return key ? JSON.parse(localStorage.getItem(key)!) : undefined;
  }).catch(() => undefined);
  if (editing) {
    const close = await page.request.delete('/backend-api/media/cooked/' + editing.sourceId + '/request/' + editing.requestId,
      { headers: { Origin: 'http://127.0.0.1:4547' }, timeout: 30_000 });
    expect([200, 404]).toContain(close.status());
  }
});
