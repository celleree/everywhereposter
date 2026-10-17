import { test, expect, capture, noHorizontalOverflow, openApp, reachable, mobileProject } from './fixtures';
import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { buildVideoEditDecisionList } from '../../libraries/nestjs-libraries/src/media-editing/video-edit-decision';

const bytes = readFileSync(path.resolve('tests/browser/assets/synthetic-picker.mp4'));
const videos = [
  { id: 'editor-video', path: '/audit-fixtures/editor.mp4', originalName: 'Synthetic talking head.mp4', type: 'video' },
  { id: 'invalid-video', path: '/audit-fixtures/invalid.mp4', originalName: 'Unavailable video.mp4', type: 'video' },
];
const output = { id: 'editor-output', path: '/audit-fixtures/edited.mp4', originalName: 'Synthetic talking head-edited.mp4', type: 'video' };
type Mode = { renders?: number; render?: 'lost' | 'held' | 'busy'; renderRelease?: Promise<void>; library?: 'empty' | 'error'; source?: 'error' | 'invalid'; release?: Promise<void>; requested?: boolean };
async function fixtures(page: Page, mode: Mode = {}) {
  await page.route('**/backend-api/media**', async (route) => {
    const request = route.request(), url = new URL(request.url());
    if (request.method() === 'POST' && url.pathname.endsWith('/video-edits')) {
      mode.renders = (mode.renders || 0) + 1;
      expect(request.postDataJSON().schemaVersion).toBe(1);
      if (mode.render === 'held') await mode.renderRelease;
      if (mode.render === 'lost' || mode.render === 'held') return route.abort('failed').catch(() => {});
      if (mode.render === 'busy') return route.fulfill({ status: 429, json: { code: 'RENDER_BUSY', message: 'Another render is running. Try again later.' } });
      if (url.pathname.includes('invalid-video')) return route.fulfill({ status: 422, json: { message: 'The source video is unsupported.' } });
      return route.fulfill({ status: 201, json: { schemaVersion: 1, outputMedia: output,
        editDecisionList: buildVideoEditDecisionList({ mediaId: 'editor-video', durationMs: 1000, pacingPreset: request.postDataJSON().pacingPreset, detectedSilence: [] }),
        render: { status: 'completed', durationMs: 1000, container: 'mp4', videoCodec: 'h264', audioCodec: 'aac' } } });
    }
    if (request.method() !== 'GET') return route.fallback();
    if (url.pathname === '/backend-api/media/editor-output') return route.fulfill({ json: output });
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
  const mode: Mode = {};
  await fixtures(page, mode);
  // Next dev can evict this bundle during earlier smoke cases. Compile it as
  // bootstrap before measuring the real link navigation with the usual budget.
  const warmupResponse = await page.request.get('/video-editor');
  expect(warmupResponse.status()).toBe(200);
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
  await expect(page.getByText('160 × 120').first()).toBeVisible();
  await expect(page.getByLabel('Edited video preview')).toBeVisible();
  await preview.evaluate((video: HTMLVideoElement) => video.play());
  await expect.poll(() => preview.evaluate((video: HTMLVideoElement) => video.currentTime)).toBeGreaterThan(0);
  await preview.evaluate((video: HTMLVideoElement) => video.pause());
  await page.getByLabel('Pacing', { exact: true }).selectOption('tight');
  expect(mode.renders).toBe(1);
  await page.getByRole('button', { name: 'Create another edit', exact: true }).click();
  await expect(page.getByText('Applied pacing: Brisk', { exact: false })).toBeVisible();
  expect(mode.renders).toBe(2);
  const saved = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download MP4', exact: true }).click();
  const download = await saved;
  const destination = info.outputPath('edited-video.mp4'); await download.saveAs(destination);
  expect(readFileSync(destination)).toEqual(bytes);
  await capture(page, info, 'video-editor-source');
  for (const size of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(size);
    await noHorizontalOverflow(page);
    for (const name of ['Choose video', 'Remove source']) await reachable(page.getByRole('button', { name, exact: true }));
    await reachable(page.getByLabel('Pacing', { exact: true }));
    await reachable(page.getByRole('button', { name: 'Use in composer', exact: true }));
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
  const workspace = page.getByRole('main', { name: 'Video Editor workspace' });
  await choose(page);
  await expect(workspace.getByRole('status')).toContainText('Loading source details');
  await expect.poll(() => mode.requested).toBe(true);
  release();
  await expect(workspace.getByRole('alert')).toContainText('could not be loaded');
  mode.source = 'invalid';
  await page.getByRole('button', { name: 'Retry source' }).click();
  await expect(workspace.getByRole('alert')).toContainText('not a valid video');
  mode.source = undefined;
  await page.getByRole('button', { name: 'Retry source' }).click();
  await expect(page.getByLabel('Original video preview')).toBeVisible();
  await choose(page, 'Unavailable video.mp4');
  await expect(workspace.getByRole('alert').filter({ hasText: 'could not be played' })).toBeVisible();
  await page.getByRole('button', { name: 'Retry preview' }).click();
  await expect(workspace.getByRole('alert').filter({ hasText: 'could not be played' })).toBeVisible();
  await expect(page.getByLabel('Edited video preview')).toHaveCount(0);
  await capture(page, info, 'video-editor-preview-failure');
});


test('Video Editor: stopped or lost requests stay uncertain after reload without automatic retry', async ({ page }) => {
  let release!: () => void;
  const mode: Mode = { render: 'held', renderRelease: new Promise<void>(resolve => { release = resolve; }) };
  await fixtures(page, mode); await openApp(page, '/video-editor'); await choose(page);
  await expect(page.getByRole('status').filter({ hasText: 'Editing your video' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Choose video' })).toBeDisabled();
  await page.getByRole('button', { name: 'Stop waiting', exact: true }).click(); release();
  await expect(page.getByRole('region', { name: 'Edit settings', exact: true }).getByRole('alert')).toContainText('will not retry automatically');
  expect(mode.renders).toBe(1);
  await page.reload();
  await expect(page.getByRole('region', { name: 'Edit settings', exact: true }).getByRole('alert')).toContainText('may still finish');
  expect(mode.renders).toBe(1);
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button', { name: 'Create another edit', exact: true }).click();
  expect(mode.renders).toBe(1);
});
