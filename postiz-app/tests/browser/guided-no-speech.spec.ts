import { test, expect, capture, openApp } from './fixtures';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

test('Guided no speech: completed silent source offers an explicit caption path to Review', async ({ page }, info) => {
  const media = { id: 'synthetic-no-speech', originalName: 'Silent fixture video.mp4', type: 'video', path: '/audit-fixtures/no-speech.mp4' };
  const account = { id: 'synthetic-linkedin', name: 'Synthetic LinkedIn', identifier: 'linkedin', type: 'social', editor: 'normal', picture: '', additionalSettings: '[]', time: [], inBetweenSteps: false };
  const caption = 'My own caption for this silent fixture video.';
  const sourceFiles = ['guided.composer.shell.tsx', 'guided.composer.store.ts', 'guided.composer.upload.details.tsx'];
  const sourceHash = createHash('sha256').update(sourceFiles.map(file => file + '\n' + readFileSync('apps/frontend/src/components/new-launch/' + file, 'utf8')).join('\n')).digest('hex');
  await info.attach('no-speech-source', { body: JSON.stringify({ sourceFiles, sourceHash, boundary: 'Synthetic media/transcription/generation responses; no provider or publishing calls' }), contentType: 'application/json' });
  await page.route('**/backend-api/integrations/list', route => route.fulfill({ json: { integrations: [account] } }));
  await page.route('**/backend-api/media**', route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/backend-api/media') return route.fulfill({ json: { pages: 1, results: [media] } });
    if (url.pathname === `/backend-api/media/${media.id}/transcription/ensure`)
      return route.fulfill({ json: { mediaId: media.id, status: 'READY', text: null, error: null } });
    return route.fallback();
  });
  await page.route('**/audit-fixtures/no-speech.mp4', route => route.fulfill({ contentType: 'video/mp4', body: readFileSync('tests/browser/assets/synthetic-picker.mp4') }));
  await page.route('**/backend-api/posts/copy/generate', route => {
    const body = route.request().postDataJSON();
    expect(body).toMatchObject({ captionMode: 'use-everywhere', sourceCaption: caption });
    return route.fulfill({ contentType: 'application/x-ndjson', body: JSON.stringify({ name: 'completed', data: { requestId: 'synthetic-no-speech', status: 'complete', sourceConfidence: 1, warnings: [], imagePlans: [], results: [{ platform: 'linkedin', draft: caption, origin: 'original', warnings: [], charCount: caption.length }] } }) + '\n' });
  });
  await openApp(page, '/create');
  await page.getByRole('button', { name: 'Media Library', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Media Library', exact: true });
  await picker.getByRole('button', { name: 'Select Silent fixture video.mp4', exact: true }).click();
  await picker.getByRole('button', { name: 'Add selected media', exact: true }).click();
  const guidance = page.getByRole('status').filter({ hasText: 'No speech was detected in this media' });
  await expect(guidance).toBeVisible();
  await expect(page.getByText('Transcript ready', { exact: true })).toHaveCount(0);
  await expect(page.getByText(/Transcribing…/)).toHaveCount(0);
  await capture(page, info, 'no-speech-completed');
  await page.getByRole('button', { name: 'Add my own caption', exact: true }).click();
  await page.getByRole('textbox', { name: 'Your caption', exact: true }).fill(caption);
  await page.getByRole('button', { name: 'Continue to Destinations', exact: true }).click();
  const select = page.getByRole('button', { name: 'Select Synthetic LinkedIn on LinkedIn', exact: true });
  if (await select.count()) await select.click();
  await expect(page.getByRole('button', { name: 'Add my own caption', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Continue to Review', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Review Step 3 of 4', exact: true })).toHaveAttribute('aria-current', 'step');
  await expect(page.getByRole('textbox', { name: 'Synthetic LinkedIn caption', exact: true })).toHaveValue(caption);
  await capture(page, info, 'no-speech-own-caption-review');
});
