import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const enabled = process.env.EP_VIDEO_EDITOR_BROWSER === '1';
const api = 'http://127.0.0.1:4348';
const origin = 'http://127.0.0.1:4347';
const headers = { auth: 'synthetic-playwright-session' };
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
test.skip(!enabled, 'Owned real-engine fixture is explicitly opt-in');
test.beforeEach(async ({ context, request }) => {
  expect(process.env.BROWSER_FRONTEND_PORT).toBe('4347');
  expect(process.env.BROWSER_API_PORT).toBe('4348');
  expect((await request.post(api + '/__video-editor/reset', { headers })).ok()).toBe(true);
  await context.addCookies([{ name: 'auth', value: headers.auth, url: origin }]);
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort('blockedbyclient');
    // Allow only the owned upload/render mutations. Publishing is always forbidden.
    if (route.request().method() !== 'GET' &&
        !/^\/backend-api\/media\/(uploads(?:\/editor-upload-session(?:\/parts\/0|\/complete)?)?|[^/]+\/video-edits)$/.test(url.pathname)) return route.abort('blockedbyclient');
    return route.continue();
  });
});

for (const uploaded of [false, true]) test(`Video Editor real engine: ${uploaded ? 'picker upload' : 'library source'} to download and composer`, async ({ page, request }, info) => {
  let attemptedPosts = 0;
  page.on('request', req => { if (new URL(req.url()).pathname === '/backend-api/posts' && req.method() !== 'GET') attemptedPosts++; });
  await page.goto('/video-editor');
  await expect(page.locator('.mobile-app-shell')).toBeVisible({ timeout: 60000 });
  await page.addStyleTag({ content: 'nextjs-portal { display:none!important }' });
  await page.getByRole('button', { name: 'Choose video', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Media Library', exact: true });
  if (uploaded) {
    const response = await request.get(api + '/__video-editor/assets/editor-source.mp4');
    const bytes = await response.body(); expect(bytes.length).toBeLessThan(1024 * 1024);
    await picker.locator('input[type=file]').first().setInputFiles({ name: 'Owned uploaded.mp4', mimeType: 'video/mp4', buffer: bytes });
    await expect.poll(async () => (await (await request.get(api + '/__video-editor/stats', { headers })).json()).uploaded).toBe(true);
  } else await picker.getByRole('button', { name: 'Select Owned talking head.mp4', exact: true }).click({ position: { x: 10, y: 10 } });
  if (await picker.isVisible()) {
    // A completed upload may already be selected by the existing picker.
    await picker.getByRole('button', { name: 'Add selected media', exact: true }).click();
  }
  const edited = page.getByLabel('Edited video preview');
  await expect(edited).toBeVisible({ timeout: 45000 });
  await expect.poll(() => edited.evaluate((video: HTMLVideoElement) => video.readyState)).toBeGreaterThanOrEqual(1);
  const outputPath = await edited.getAttribute('src');
  expect(outputPath).toContain('/__video-editor/assets/editor-output-');
  expect(await edited.evaluate((video: HTMLVideoElement) => video.duration)).toBeLessThan(4);
  await page.screenshot({ path: info.outputPath('edited-result.png'), fullPage: true });
  await info.attach('edited-result', { path: info.outputPath('edited-result.png'), contentType: 'image/png' });
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download MP4', exact: true }).click();
  const download = await pending, file = await download.path();
  expect(file).toBeTruthy();
  const downloaded = readFileSync(file!);
  const stored = await (await request.get(origin + outputPath!)).body();
  expect(digest(downloaded)).toBe(digest(stored));
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', file!], { encoding: 'utf8', timeout: 15000, env: { PATH: process.env.PATH, HOME: process.env.HOME } }));
  expect(probe.streams.map((stream: any) => stream.codec_name)).toEqual(expect.arrayContaining(['h264', 'aac']));
  await page.getByRole('button', { name: 'Use in composer', exact: true }).click();
  const composer = page.locator('#social-content');
  await expect(composer).toBeVisible();
  await expect(composer.locator('video').first()).toHaveAttribute('src', outputPath!, { timeout: 30000 });
  await page.screenshot({ path: info.outputPath('composer-attachment.png'), fullPage: true });
  await info.attach('composer-attachment', { path: info.outputPath('composer-attachment.png'), contentType: 'image/png' });
  const stats = await (await request.get(api + '/__video-editor/stats', { headers })).json();
  expect(stats).toMatchObject({ renders: 1, active: 0, peak: 1, postWrites: 0 });
  expect(stats.currentHash).toBe(stats.originalHash);
  if (uploaded) expect(stats.uploadedHash).toBe(stats.originalHash);
  expect(attemptedPosts).toBe(0);
  await info.attach('real-editor-receipt', { body: JSON.stringify({ ...stats, outputPath, downloadedSha256: digest(downloaded), fixture: 'real FFmpeg/local storage; synthetic tenant repository/auth/transport' }), contentType: 'application/json' });
});

test('Video Editor real engine: bounded input, scoped source lookup and single-render admission', async ({ request }) => {
  const bad = await request.post(api + '/media/uploads', { headers, data: { organizationId: 'synthetic-org', byteSize: 1024 * 1024 + 1, manifest: ['bad'] } });
  expect(bad.status()).toBe(400);
  expect((await request.get(api + '/__video-editor/assets/not-owned.mp4')).status()).toBe(404);
  const first = request.post(api + '/media/editor-source/video-edits', { headers, data: { schemaVersion: 1, pacingPreset: 'relaxed' } });
  await expect.poll(async () => (await (await request.get(api + '/__video-editor/stats', { headers })).json()).active).toBe(1);
  expect((await request.post(api + '/__video-editor/reset', { headers })).status()).toBe(409);
  const competing = await request.post(api + '/media/editor-source/video-edits', { headers, data: { schemaVersion: 1 } });
  expect(competing.status()).toBe(429);
  expect((await first).status()).toBe(201);
  const foreign = await request.post(api + '/media/foreign-media/video-edits', { headers, data: { schemaVersion: 1 } });
  expect(foreign.status()).toBe(404);
  const stats = await (await request.get(api + '/__video-editor/stats', { headers })).json();
  expect(stats.outputIds).toHaveLength(1); expect(stats.active).toBe(0);
  expect(stats.currentHash).toBe(stats.originalHash);
});
