import { test, expect, openApp, capture } from './fixtures';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

test('Completed transfers clear old receipts and fresh success while saved media and recovery stay usable', async ({ page }, info) => {
  const media = Array.from({ length: 8 }, (_, i) => ({ id: `saved-${i}`, name: `old-${i}.mp4`, originalName: `old-${i}.mp4`,
    type: 'video', path: '/audit-fixtures/saved.mp4', transcriptionStatus: 'READY' }));
  const complete = { originalName: 'receipt.mp4', byteSize: 10, parts: [], manifest: [], status: 'COMPLETE', completedAt: new Date(0).toISOString() };
  let freshCompletedAt: string | undefined;
  const sessions = [
    ...media.map((item, i) => ({ ...complete, id: `old-${i}`, originalName: item.originalName, media: item })),
    ...['UPLOADING', 'FINALIZING', 'FAILED'].map(status => ({ ...complete, id: status, status, originalName: `${status}.mp4`, error: status === 'FAILED' ? 'Select the original video to retry.' : undefined })),
    { ...complete, id: 'quick', originalName: 'publishing-result.mp4', media: { id: 'quick-media' }, quickIntent: { id: 'intent', status: 'COMPLETE', results: [{ integrationId: 'x', name: 'X', state: 'Failed', reason: 'Provider rejected upload' }] } },
  ];
  let mutations = 0;
  page.on('request', request => { const pathname = new URL(request.url()).pathname; if (pathname.startsWith('/backend-api/') && (request.method() === 'DELETE' || (request.method() !== 'GET' && (pathname.startsWith('/backend-api/media/uploads') || pathname.startsWith('/backend-api/posts'))))) mutations++; });
  await page.route('**/backend-api/media/uploads**', route => {
    freshCompletedAt ||= new Date().toISOString();
    return route.fulfill({ json: { sessions: [...sessions, { ...complete, id: 'fresh', originalName: 'fresh.mp4',
      completedAt: freshCompletedAt, media: { id: 'fresh-media' } }] } });
  });
  await page.route('**/backend-api/media?*', route => route.fulfill({ json: { pages: 1, results: media } }));
  await page.route('**/backend-api/media/saved-0**', route => route.fulfill({ json: route.request().url().includes('/transcription')
    ? { mediaId: media[0].id, status: 'READY', transcription: 'Synthetic saved media remains available.' } : media[0] }));
  const bytes = readFileSync(path.resolve('tests/browser/assets/synthetic-picker.mp4'));
  await page.route('**/audit-fixtures/saved.mp4', route => route.fulfill({ contentType: 'video/mp4', body: bytes }));
  await openApp(page, '/create');
  const tray = page.getByRole('region', { name: 'Video transfers' });
  await expect(tray.getByText('fresh.mp4', { exact: true })).toBeVisible();
  for (const item of media) await expect(tray.getByText(item.originalName, { exact: true })).toHaveCount(0);
  await page.clock.install();
  const dismiss = tray.locator('[data-transfer-id="fresh"]').getByRole('button', { name: 'Dismiss transfer' });
  await dismiss.focus();
  await page.clock.fastForward(11_000);
  await expect(dismiss).toBeFocused();
  await expect(tray.getByText('fresh.mp4', { exact: true })).toBeVisible();
  const library = page.getByRole('button', { name: 'Media Library', exact: true });
  await library.focus();
  await page.clock.fastForward(1_000);
  await expect(tray.getByText('fresh.mp4', { exact: true })).toHaveCount(0);
  await page.clock.resume();
  for (const status of ['UPLOADING', 'FINALIZING', 'FAILED']) await expect(tray.getByText(`${status}.mp4`, { exact: true })).toBeVisible();
  await expect(tray.getByText('X: Failed', { exact: false })).toBeVisible();
  await library.click();
  const picker = page.getByRole('dialog', { name: 'Media Library', exact: true });
  await picker.getByRole('button', { name: 'Select old-0.mp4', exact: true }).click({ position: { x: 10, y: 10 } });
  await picker.getByRole('button', { name: 'Add selected media', exact: true }).click();
  await expect(picker).toHaveCount(0);
  const card = page.locator('.composer-upload-card');
  await expect(card.getByText('old-0.mp4', { exact: true })).toBeVisible();
  await expect(card.locator('video').first()).toHaveAttribute('src', /saved.mp4/);
  await capture(page, info, 'completed-transfers-saved-media');
  const sources = ['apps/frontend/src/components/media/resumable-transfer.ts', 'apps/frontend/src/components/media/resumable-upload.provider.tsx',
    'libraries/nestjs-libraries/src/upload/resumable-upload.service.ts', 'tests/browser/completed-transfers.spec.ts'];
  await info.attach('transfer-sources', { body: JSON.stringify(sources.map(file => ({ file, sha256: createHash('sha256').update(readFileSync(path.resolve(file))).digest('hex') }))), contentType: 'application/json' });
  await openApp(page, '/create');
  await expect(tray.getByText('FAILED.mp4', { exact: true })).toBeVisible();
  await expect(tray.getByText('fresh.mp4', { exact: true })).toHaveCount(0);
  for (const item of media) await expect(tray.getByText(item.originalName, { exact: true })).toHaveCount(0);
  expect(mutations).toBe(0);
});
