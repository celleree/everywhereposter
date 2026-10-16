import { test, expect, openApp, noHorizontalOverflow, reachable, capture } from './fixtures';

for (const width of [375, 390, 430, 1440]) {
  test(`Resumable upload: inline layout and recovery at ${width}px in both themes`, async ({ page, context }, info) => {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
    let restored = false;
    await page.route('**/backend-api/media/uploads**', route => route.fulfill({ json: { sessions: restored ? [{
      id: 'layout-session', originalName: 'Original video from my phone with a long filename.mp4', byteSize: 100,
      status: 'UPLOADING', parts: [{ byteSize: 48 }], manifest: [],
    }] : [] } }));
    await openApp(page, '/create');
    const card = page.locator('.composer-upload-card');
    const choose = card.getByRole('button', { name: 'Choose files', exact: true });
    const library = card.getByRole('button', { name: 'Media Library', exact: true });
    const first = await choose.boundingBox(), second = await library.boundingBox();
    expect(Math.abs(first!.y - second!.y)).toBeLessThan(2);
    expect(first!.height).toBeGreaterThanOrEqual(44);
    expect(second!.height).toBeGreaterThanOrEqual(44);
    await expect(card.locator('.mobile-upload-icon')).toHaveCount(0);
    await expect(card.getByText('Images and video are supported.')).toHaveCount(0);
    expect((await card.boundingBox())!.height).toBeLessThan(150);
    await capture(page, info, `upload-empty-${width}`);
    restored = true;
    await page.reload();
    // Reload must finish the same composer bootstrap as the initial openApp visit.
    await expect(choose).toBeVisible({ timeout: 60_000 });
    const transfers = card.getByRole('region', { name: 'Video transfers' });
    await expect(transfers.getByRole('progressbar')).toHaveAttribute('value', '48');
    await expect(transfers.getByText('Keep this browser open and on screen while uploading.')).toHaveCount(0);
    await expect(transfers.getByText(/%/)).toHaveCount(0);
    expect(await transfers.evaluate(element => getComputedStyle(element).position)).toBe('static');
    for (const theme of ['light', 'dark']) {
      await context.addCookies([{ name: 'mode', value: theme, url: 'http://127.0.0.1:4217' }]);
      await page.reload();
      await expect(choose).toBeVisible({ timeout: 60_000 });
      await expect(page.locator('body')).toHaveClass(new RegExp(`(?:^| )${theme}(?: |$)`));
      await expect(transfers.getByRole('progressbar')).toHaveAttribute('value', '48');
      await noHorizontalOverflow(page);
      const retry = transfers.getByRole('button', { name: 'Retry upload', exact: true });
      await reachable(retry);
      await retry.focus();
      await expect(retry).toBeFocused();
      const chooser = page.waitForEvent('filechooser');
      await page.keyboard.press('Enter');
      await chooser;
      await reachable(transfers.getByRole('button', { name: 'Cancel upload', exact: true }));
      await capture(page, info, `upload-inline-${width}-${theme}`);
    }
  });
}

test('Resumable upload: image upload keeps inline progress and cancellation', async ({ page }) => {
  let requested = false, release!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/backend-api/media/upload-server', async route => {
    if (route.request().method() !== 'POST') return route.fallback();
    requested = true;
    await hold;
    await route.abort('failed');
  });
  await openApp(page, '/create');
  const card = page.locator('.composer-upload-card');
  const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aOioAAAAASUVORK5CYII=', 'base64');
  await card.locator('input[type=file]').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: image });
  await expect.poll(() => requested).toBe(true);
  const transfers = card.getByRole('region', { name: 'File transfers' });
  await expect(transfers.getByRole('progressbar', { name: 'Upload progress for photo.png' })).toBeVisible();
  await expect(transfers.getByText(/%/)).toHaveCount(0);
  await transfers.getByRole('button', { name: 'Cancel upload', exact: true }).click();
  await expect(transfers).toHaveCount(0);
  await expect(card.getByRole('button', { name: 'Choose files', exact: true })).toBeEnabled();
  release();
});
