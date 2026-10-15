import { test, expect, capture, noHorizontalOverflow, openApp, reachable, mobileProject } from './fixtures';
import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const bytes = readFileSync(path.resolve('tests/browser/assets/synthetic-picker.mp4'));
const videos = [
  { id: 'editor-video', path: '/audit-fixtures/editor.mp4', originalName: 'Synthetic talking head.mp4', type: 'video' },
  { id: 'invalid-video', path: '/audit-fixtures/invalid.mp4', originalName: 'Unavailable video.mp4', type: 'video' },
];
type Mode = { library?: 'empty' | 'error'; source?: 'error' | 'invalid'; release?: Promise<void>; requested?: boolean };
async function fixtures(page: Page, mode: Mode = {}) {
  await page.route('**/backend-api/media**', async (route) => {
    const request = route.request(), url = new URL(request.url());
    if (request.method() !== 'GET') return route.fallback();
    if (url.pathname === '/backend-api/media') {
      if (mode.library === 'error') return route.fulfill({ status: 503, json: {} });
      return route.fulfill({ json: { pages: mode.library === 'empty' ? 0 : 1, results: mode.library === 'empty' ? [] : [...videos, { id: 'editor-image', path: '/audit-fixtures/image.jpg', originalName: 'Synthetic image.jpg', type: 'image' }] } });
    }
    const source = videos.find((item) => url.pathname === `/backend-api/media/${item.id}`);
    if (source) {
      mode.requested = true;
      await mode.release;
      if (mode.source === 'error') return route.fulfill({ status: 503, json: {} });
      return route.fulfill({ json: mode.source === 'invalid' ? { ...source, type: 'image' } : source });
    }
    return route.fallback();
  });
  await page.route('**/audit-fixtures/**', (route) => route.fulfill({
    contentType: 'video/mp4', body: route.request().url().endsWith('invalid.mp4') ? Buffer.from('invalid video') : bytes,
  }));
}
async function choose(page: Page, name = 'Synthetic talking head.mp4') {
  await page.getByRole('button', { name: 'Choose video', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Media Library', exact: true });
  await expect(picker.getByRole('button', { name: 'Upload', exact: true })).toBeVisible();
  await expect(picker.getByRole('button', { name: 'Select Synthetic image.jpg', exact: true })).toHaveCount(0);
  await picker.getByRole('button', { name: `Select ${name}`, exact: true }).click({ position: { x: 10, y: 10 } });
  await picker.getByRole('button', { name: 'Add selected media', exact: true }).click();
  await expect(picker).toHaveCount(0);
}

test('Video Editor: navigation, manual playback and responsive workspace', async ({ page }, info) => {
  await fixtures(page);
  await openApp(page, '/media');
  if (mobileProject(info)) {
    const nav = page.getByRole('navigation', { name: 'Mobile navigation' });
    await expect(nav.locator('a,button')).toHaveCount(4);
    await nav.getByRole('button', { name: 'More' }).click();
    await page.getByRole('navigation', { name: 'More navigation' }).getByRole('link', { name: 'Video Editor' }).click();
  } else await page.getByRole('link', { name: 'Video Editor', exact: true }).click();
  await expect(page).toHaveURL(/\/video-editor$/);
  await expect(page.getByRole('heading', { name: 'Video Editor', exact: true })).toBeVisible();
  await expect(page.getByText('Start with one video')).toBeVisible();
  await choose(page);
  const preview = page.getByLabel('Original video preview');
  await expect.poll(() => preview.evaluate((video: HTMLVideoElement) => video.readyState)).toBeGreaterThanOrEqual(1);
  expect(await preview.evaluate((video: HTMLVideoElement) => video.paused && !video.autoplay && video.controls && video.playsInline)).toBe(true);
  await expect(page.getByText('160 × 120')).toBeVisible();
  await preview.evaluate((video: HTMLVideoElement) => video.play());
  await expect.poll(() => preview.evaluate((video: HTMLVideoElement) => video.currentTime)).toBeGreaterThan(0);
  await preview.evaluate((video: HTMLVideoElement) => video.pause());
  await page.getByLabel('Pacing', { exact: true }).selectOption('tight');
  await page.getByLabel('Style notes').fill('Keep original footage and restrained motion.');
  for (const name of ['Create edit', 'Export MP4', 'Clip timeline', 'Transcript cuts', 'Caption styles', 'B-roll / image overlays', 'Inspect edit']) {
    await expect(page.getByRole('button', { name, exact: true })).toBeDisabled();
  }
  await capture(page, info, 'video-editor-source');
  for (const size of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(size);
    await noHorizontalOverflow(page);
    for (const name of ['Choose video', 'Remove source']) await reachable(page.getByRole('button', { name, exact: true }));
    await reachable(page.getByLabel('Pacing', { exact: true }));
    await reachable(page.getByLabel('Style notes'));
    await page.getByRole('button', { name: 'Choose video', exact: true }).click();
    const picker = page.getByRole('dialog', { name: 'Media Library', exact: true });
    for (const name of ['Upload', 'Cancel', 'Add selected media']) await reachable(picker.getByRole('button', { name, exact: true }));
    await picker.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(preview).toHaveCount(1);
    await noHorizontalOverflow(page);
    await capture(page, info, `video-editor-${size.width}x${size.height}`);
  }
  await page.getByRole('button', { name: 'Remove source' }).click();
  await expect(page.getByText('Start with one video')).toBeVisible();
});

test('Video Editor: empty library, failed request and retry', async ({ page }, info) => {
  const mode: Mode = { library: 'error' };
  await fixtures(page, mode);
  await openApp(page, '/video-editor');
  await page.getByRole('button', { name: 'Choose video' }).click();
  const picker = page.getByRole('dialog', { name: 'Media Library', exact: true });
  await expect(picker.getByRole('alert')).toContainText('Media could not be loaded');
  mode.library = 'empty';
  await picker.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(picker.getByText("You don't have any media yet")).toBeVisible();
  await capture(page, info, 'video-editor-empty-library');
  await picker.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByText('Start with one video')).toBeVisible();
});

test('Video Editor: loading, source failure, invalid selection and unavailable playback', async ({ page }, info) => {
  let release!: () => void;
  const mode: Mode = { source: 'error', release: new Promise((resolve) => { release = resolve; }) };
  await fixtures(page, mode);
  await openApp(page, '/video-editor');
  await choose(page);
  await expect(page.getByRole('status')).toContainText('Loading source details');
  await expect.poll(() => mode.requested).toBe(true);
  release();
  await expect(page.getByRole('alert')).toContainText('could not be loaded');
  mode.source = 'invalid';
  await page.getByRole('button', { name: 'Retry source' }).click();
  await expect(page.getByRole('alert')).toContainText('not a valid video');
  mode.source = undefined;
  await page.getByRole('button', { name: 'Retry source' }).click();
  await expect(page.getByLabel('Original video preview')).toBeVisible();
  await choose(page, 'Unavailable video.mp4');
  await expect(page.getByRole('alert')).toContainText('could not be played');
  await page.getByRole('button', { name: 'Retry preview' }).click();
  await expect(page.getByRole('alert')).toContainText('could not be played');
  await expect(page.getByRole('button', { name: 'Create edit', exact: true })).toBeDisabled();
  await capture(page, info, 'video-editor-preview-failure');
});
