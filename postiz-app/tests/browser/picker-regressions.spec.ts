import { test, expect, capture, noHorizontalOverflow, openApp } from './fixtures';
import type { Locator, Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const syntheticVideo = readFileSync(path.resolve('tests/browser/assets/synthetic-picker.mp4'));

const records = Array.from({ length: 22 }, (_, index) => ({
  id: `synthetic-picker-${index + 1}`, name: `synthetic-${index + 1}.svg`,
  path: index === 21 ? '/audit-fixtures/video.mp4' : `/audit-fixtures/image-${index + 1}.svg`,
  originalName: `Synthetic asset ${index + 1}${index === 21 ? '.mp4' : ''}`, type: index === 21 ? 'video' : 'image',
}));

async function installMedia(page: Page, mode: { value: 'ok' | 'error' }) {
  await page.route('**/backend-api/media**', async route => {
    const request = route.request(), url = new URL(request.url());
    // Browser-local response for this one synthetic video; nothing reaches the API.
    if (request.method() === 'POST' && url.pathname === '/backend-api/media/synthetic-picker-22/transcription/ensure') {
      return route.fulfill({ json: { status: 'ready' } });
    }
    if (request.method() !== 'GET') return route.fallback();
    if (url.pathname === '/backend-api/media') {
      if (mode.value === 'error') return route.fulfill({ status: 503, json: {} });
      const pageNumber = Number(url.searchParams.get('page') || 1);
      return route.fulfill({ json: { pages: 2, results: records.slice((pageNumber - 1) * 18, pageNumber * 18) } });
    }
    const record = records.find(item => url.pathname === `/backend-api/media/${item.id}`);
    if (record) return route.fulfill({ json: record });
    return route.fallback();
  });
  await page.route('**/audit-fixtures/**', async route => {
    if (new URL(route.request().url()).pathname.endsWith('.mp4')) return route.fulfill({ contentType: 'video/mp4', body: syntheticVideo });
    return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect width="640" height="480" fill="#36557c"/><text x="32" y="230" fill="white" font-size="44">Synthetic audit media</text></svg>' });
  });
}

// Deliberately no scrolling: these controls must be usable in the first viewport.
async function immediate(locator: Locator) {
  await expect(locator).toBeVisible();
  await expect.poll(() => locator.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
    const hit = document.elementFromPoint(x, y);
    return rect.top >= 0 && rect.bottom <= innerHeight && rect.left >= 0 && rect.right <= innerWidth
      && !!hit && (hit === element || element.contains(hit));
  })).toBe(true);
}

async function pickerGeometry(page: Page) {
  const picker = page.getByRole('dialog', { name: 'Media Library', exact: true });
  await immediate(picker.getByRole('button', { name: 'Close dialog', exact: true }));
  await immediate(picker.getByRole('button', { name: 'Cancel', exact: true }));
  await immediate(picker.getByRole('button', { name: 'Add selected media', exact: true }));
  await immediate(picker.getByRole('button', { name: 'Upload', exact: true }));
  await immediate(picker.getByRole('button', { name: 'Next', exact: true }));
  await expect(picker.getByRole('button', { name: 'Posted media', exact: true })).toHaveCount(0);
  await expect(picker.getByRole('button', { name: 'Media Library', exact: true })).toHaveCount(0);
  await expect.poll(() => picker.locator('.upload-picker-grid').evaluate(element => ({
    columns: getComputedStyle(element).gridTemplateColumns.split(' ').length,
    overflow: Math.max(0, element.scrollHeight - element.clientHeight),
  }))).toEqual({ columns: 3, overflow: 0 });
  for (const button of await picker.getByRole('button', { name: /^(Preview|Previous|Next|Cancel|Add selected|Close dialog|Upload)/ }).all()) {
    const bounds = await button.boundingBox();
    expect(bounds?.height).toBeGreaterThanOrEqual(44);
    expect(bounds?.width).toBeGreaterThanOrEqual(44);
  }
  await noHorizontalOverflow(page);
  return picker;
}

test('Upload picker: viewport pages, repeat selection, contained previews and attachment without autoplay', async ({ page }, info) => {
  await installMedia(page, { value: 'ok' });
  await openApp(page, '/create');
  await page.getByRole('button', { name: 'Media Library', exact: true }).click();
  const picker = await pickerGeometry(page);
  await expect(picker.getByRole('button', { name: 'Close dialog', exact: true })).toBeFocused();
  await capture(page, info, 'upload-picker-first-page');
  const selectFirst = picker.getByRole('button', { name: 'Select Synthetic asset 1', exact: true });
  await selectFirst.click({ position: { x: 10, y: 10 } });
  await expect(picker.getByRole('button', { name: 'Deselect Synthetic asset 1', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await picker.getByRole('button', { name: 'Deselect Synthetic asset 1', exact: true }).click({ position: { x: 10, y: 10 } });
  await expect(picker.getByRole('button', { name: 'Add selected media', exact: true })).toBeDisabled();
  await selectFirst.click({ position: { x: 10, y: 10 } });
  await picker.getByRole('button', { name: 'Preview Synthetic asset 1', exact: true }).click();
  const preview = page.getByRole('dialog', { name: 'Synthetic asset 1', exact: true });
  await expect(preview.getByRole('button', { name: 'Close dialog', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(preview.getByRole('button', { name: 'Close dialog', exact: true })).toBeFocused();
  await immediate(preview.getByRole('button', { name: 'Close dialog', exact: true }));
  await expect(preview.locator('img')).toHaveCSS('object-fit', 'contain');
  await immediate(preview.locator('img'));
  await capture(page, info, 'upload-image-preview');
  await page.keyboard.press('Escape');
  await expect(preview).toHaveCount(0);
  await expect(picker.getByRole('button', { name: 'Preview Synthetic asset 1', exact: true })).toBeFocused();
  await expect(picker.getByRole('button', { name: 'Deselect Synthetic asset 1', exact: true })).toHaveAttribute('aria-pressed', 'true');

  const seen = new Set<string>();
  for (let attempts = 0; attempts < 12; attempts++) {
    const labels = await picker.getByRole('button', { name: /^(Select|Deselect) Synthetic asset/ }).evaluateAll(elements => elements.map(element => element.getAttribute('aria-label')!.replace(/^(Select|Deselect) /, '')));
    labels.forEach(label => seen.add(label));
    const next = picker.getByRole('button', { name: 'Next', exact: true });
    if (await next.isDisabled()) break;
    const first = labels[0];
    await next.click();
    await expect.poll(async () => (await picker.getByRole('button', { name: /^(Select|Deselect) Synthetic asset/ }).first().getAttribute('aria-label'))?.replace(/^(Select|Deselect) /, '')).not.toBe(first);
  }
  expect(seen.size).toBe(22);
  await expect(picker.getByRole('button', { name: 'Next', exact: true })).toBeDisabled();
  await picker.getByRole('button', { name: 'Preview Synthetic asset 22.mp4', exact: true }).click();
  const videoPreview = page.getByRole('dialog', { name: 'Synthetic asset 22.mp4', exact: true });
  await immediate(videoPreview.getByRole('button', { name: 'Close dialog', exact: true }));
  await expect(videoPreview.locator('video')).toHaveAttribute('controls', '');
  expect(await videoPreview.locator('video').evaluate((video: HTMLVideoElement) => video.paused && !video.autoplay)).toBe(true);
  await expect(videoPreview.locator('video')).toHaveCSS('object-fit', 'contain');
  await expect.poll(() => videoPreview.locator('video').evaluate((video: HTMLVideoElement) => video.readyState)).toBeGreaterThanOrEqual(1);
  await capture(page, info, 'upload-video-preview');
  await videoPreview.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await picker.getByRole('button', { name: 'Select Synthetic asset 22.mp4', exact: true }).click({ position: { x: 10, y: 10 } });
  for (let attempts = 0; attempts < 12; attempts++) {
    const previous = picker.getByRole('button', { name: 'Previous', exact: true });
    if (await previous.isDisabled()) break;
    const first = await picker.getByRole('button', { name: /^(Select|Deselect) Synthetic asset/ }).first().getAttribute('aria-label');
    await previous.click();
    await expect.poll(() => picker.getByRole('button', { name: /^(Select|Deselect) Synthetic asset/ }).first().getAttribute('aria-label')).not.toBe(first);
  }
  await expect(picker.getByRole('button', { name: 'Deselect Synthetic asset 1', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await picker.getByRole('button', { name: 'Add selected media', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText(/\d+ assets? attached/)).toHaveCount(0);
  await expect(page.locator('video')).not.toHaveCount(0);
  expect(await page.locator('video').evaluateAll(elements => elements.every(video => (video as HTMLVideoElement).paused && !(video as HTMLVideoElement).autoplay))).toBe(true);
  await capture(page, info, 'upload-attached-no-preview');
});

test('Upload picker: short portrait/landscape, error retry and Cancel preserve text draft', async ({ page }, info) => {
  const mode: { value: 'ok' | 'error' } = { value: 'error' };
  await installMedia(page, mode);
  await page.setViewportSize({ width: 390, height: 664 });
  await openApp(page, '/create');
  await page.getByRole('button', { name: 'Write a text post', exact: true }).click();
  const draft = page.getByRole('textbox', { name: 'Post text', exact: true });
  await draft.fill('Synthetic picker cancellation must preserve this text.');
  await page.getByRole('button', { name: 'Media Library', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Media Library', exact: true });
  await immediate(picker.getByRole('button', { name: 'Retry', exact: true }));
  await capture(page, info, 'upload-picker-error');
  mode.value = 'ok';
  await picker.getByRole('button', { name: 'Retry', exact: true }).click();
  await pickerGeometry(page);
  for (const size of [{ width: 320, height: 568 }, { width: 844, height: 390 }, { width: 390, height: 664 }]) {
    await page.setViewportSize(size);
    await pickerGeometry(page);
    await capture(page, info, `upload-picker-${size.width}x${size.height}`);
  }
  await picker.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(picker).toHaveCount(0);
  await expect(draft).toHaveValue('Synthetic picker cancellation must preserve this text.');
  await capture(page, info, 'upload-picker-cancel-preserved-draft');
});
