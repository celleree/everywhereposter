import { test, expect, openApp, noHorizontalOverflow, capture, reachable, mobileProject } from './fixtures';
import { readFileSync } from 'node:fs';
import path from 'node:path';

for (const [width, height] of [[180, 320], [320, 180], [240, 300], [240, 240]]) {
  test(`Resumable upload: full-frame ${width}x${height} preview clears only attached transfer`, async ({ page }, info) => {
    const videoBytes = readFileSync(path.resolve(`tests/browser/assets/composer-${width}x${height}.mp4`));
    const media = { id: 'layout-video', name: 'server-session.mp4', originalName: 'Original phone video.mp4',
      path: '/audit-fixtures/layout-video.mp4', type: 'video', transcriptionStatus: 'READY' };
    const session = { id: 'saved-session', originalName: media.originalName, byteSize: videoBytes.length,
      status: 'COMPLETE', parts: [], manifest: [], media };
    await page.route('**/backend-api/media/uploads**', route => route.fulfill({ json: { sessions: [session] } }));
    await page.route('**/backend-api/media?*', route => route.fulfill({ json: { pages: 1, results: [media] } }));
    await page.route('**/backend-api/media/layout-video**', route => route.fulfill({ json:
      route.request().url().includes('/transcription') ? { mediaId: media.id, status: 'READY', transcription: 'Synthetic test transcript' } : media }));
    await page.route('**/audit-fixtures/layout-video.mp4', route => route.fulfill({ contentType: 'video/mp4', body: videoBytes }));
    await openApp(page, '/create');
    const card = page.locator('.composer-upload-card');
    const tray = card.getByRole('region', { name: 'Video transfers' });
    await expect(tray.getByText('Transfer complete', { exact: true })).toBeVisible();
    await card.getByRole('button', { name: 'Media Library', exact: true }).click();
    const picker = page.getByRole('dialog', { name: 'Media Library', exact: true });
    await picker.getByRole('button', { name: `Select ${media.originalName}`, exact: true }).click({ position: { x: 10, y: 10 } });
    await picker.getByRole('button', { name: 'Add selected media', exact: true }).click();
    await expect(picker).toHaveCount(0);
    await expect(tray).toHaveCount(0);
    await expect(card.getByText('Shared media', { exact: true })).toHaveCount(0);
    const video = card.locator('video');
    await expect(video).toHaveAttribute('controls', '');
    await expect(video).toHaveAttribute('playsinline', '');
    await expect(video).toHaveCSS('object-fit', 'contain');
    await expect.poll(() => video.evaluate(v => (v as HTMLVideoElement).readyState)).toBeGreaterThanOrEqual(2);
    const dimensions = await video.evaluate(v => { const x = v as HTMLVideoElement; return { width: x.videoWidth, height: x.videoHeight, boxWidth: x.clientWidth, boxHeight: x.clientHeight, paused: x.paused }; });
    expect(dimensions.width / dimensions.height).toBeCloseTo(width / height, 2);
    expect(dimensions.boxWidth).toBeGreaterThan(280);
    expect(dimensions.boxHeight).toBeGreaterThan(150);
    expect(dimensions.paused).toBe(true);
    await expect(card.getByText(media.originalName, { exact: true })).toBeVisible();
    const captions = page.locator('details').filter({ has: page.locator('summary', { hasText: 'Caption options' }) });
    for (const detail of await captions.all()) expect(await detail.getAttribute('open')).toBeNull();
    await expect(page.getByText('Transcript ready', { exact: true })).toBeVisible();
    expect(await page.getByText('Transcript ready', { exact: true }).evaluate(e => !!e.closest('button'))).toBe(false);
    await noHorizontalOverflow(page);
    await capture(page, info, `composer-full-frame-${width}x${height}`);
    await video.evaluate(v => { const player = v as HTMLVideoElement; player.muted = true; return player.play(); });
    await expect.poll(() => video.evaluate(v => (v as HTMLVideoElement).currentTime)).toBeGreaterThan(0);
  });
}

test('Resumable upload: text mode is explicit and preview errors preserve attachment', async ({ page }, info) => {
  const media = { id: 'broken-video', name: 'Unsupported phone.mov', originalName: 'Unsupported phone.mov', path: '/audit-fixtures/broken.mov', type: 'video' };
  await page.route('**/backend-api/media?*', route => route.fulfill({ json: { pages: 1, results: [media] } }));
  await page.route('**/backend-api/media/broken-video**', route => route.fulfill({ json: media }));
  await page.route('**/audit-fixtures/broken.mov', route => route.fulfill({ status: 404, body: '' }));
  await openApp(page, '/create');
  const card = page.locator('.composer-upload-card');
  const choose = card.getByRole('button', { name: 'Choose files', exact: true });
  const library = card.getByRole('button', { name: 'Media Library', exact: true });
  const a = await choose.boundingBox(), b = await library.boundingBox();
  expect(Math.abs((a!.y + a!.height / 2) - (b!.y + b!.height / 2))).toBeLessThan(2);
  const write = page.getByRole('button', { name: 'Write a text post', exact: true });
  const text = 'Synthetic text post preserved when media attaches.';
  if (mobileProject(info)) {
    await reachable(write);
    await write.click();
    await page.getByRole('textbox', { name: 'Post text', exact: true }).fill(text);
    await expect(page.getByText('This is the text you will publish.', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: 'Close text post', exact: true }).click();
    await write.click();
    await expect(page.getByRole('textbox', { name: 'Post text', exact: true })).toHaveValue(text);
    await expect(page.locator('[contenteditable="true"]:visible')).toHaveCount(0);
  } else {
    await expect(write).toBeHidden();
    await expect(page.getByText('Post text', { exact: true })).toBeVisible();
    const editor = page.locator('[contenteditable="true"]:visible');
    await expect(editor).toHaveCount(1);
    await editor.fill(text);
  }
  await library.click();
  const picker = page.getByRole('dialog', { name: 'Media Library', exact: true });
  await picker.getByRole('button', { name: `Select ${media.originalName}`, exact: true }).click({ position: { x: 10, y: 10 } });
  await picker.getByRole('button', { name: 'Add selected media', exact: true }).click();
  await expect(card.getByText('Preview unavailable in this browser. Your file is still attached.')).toBeVisible();
  await reachable(card.getByRole('button', { name: 'Retry preview' }));
  await capture(page, info, 'composer-preview-failure');
  await card.getByRole('button', { name: 'Retry preview' }).click();
  await expect(card.getByText(media.name, { exact: true })).toBeVisible();
  await noHorizontalOverflow(page);
});
