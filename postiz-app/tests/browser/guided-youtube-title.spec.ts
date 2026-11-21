import { test, expect, capture, openApp } from './fixtures';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

test('Guided YouTube: editable generated titles preserve account ownership through regeneration', async ({ page }, info) => {
  const media = { id: 'synthetic-youtube', originalName: 'Keyboard shortcuts.mp4', type: 'video', path: '/audit-fixtures/youtube.mp4' };
  const accounts = ['A', 'B'].map(name => ({ id: `synthetic-youtube-${name}`, name: `Synthetic YouTube ${name}`, identifier: 'youtube', type: 'social', editor: 'normal', picture: '', additionalSettings: '[]', time: [], inBetweenSteps: false }));
  const sourceFiles = ['apps/frontend/src/components/new-launch/providers/youtube/youtube.provider.tsx', 'apps/frontend/src/components/new-launch/guided.composer.review.tsx', 'libraries/nestjs-libraries/src/dtos/copy-generation/generate.media.copy.response.ts'];
  await info.attach('youtube-title-source', { body: JSON.stringify({ sourceFiles, sourceHash: createHash('sha256').update(sourceFiles.map(file => file + '\n' + readFileSync(file, 'utf8')).join('\n')).digest('hex'), boundary: 'Synthetic transcription/generation only; no provider or publishing calls' }), contentType: 'application/json' });
  await page.route('**/backend-api/integrations/list', route => route.fulfill({ json: { integrations: accounts } }));
  await page.route('**/backend-api/media**', route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/backend-api/media') return route.fulfill({ json: { pages: 1, results: [media] } });
    if (url.pathname === `/backend-api/media/${media.id}/transcription/ensure`)
      return route.fulfill({ json: { mediaId: media.id, status: 'READY', text: 'This demonstration shows three keyboard shortcuts.', error: null } });
    return route.fallback();
  });
  await page.route('**/audit-fixtures/youtube.mp4', route => route.fulfill({ contentType: 'video/mp4', body: readFileSync('tests/browser/assets/synthetic-picker.mp4') }));
  let requests = 0;
  await page.route('**/backend-api/posts/copy/generate', route => {
    expect(route.request().postDataJSON()).toMatchObject({ platforms: ['youtube'], captionMode: 'generate' });
    requests++;
    return route.fulfill({ contentType: 'application/x-ndjson', body: JSON.stringify({ name: 'completed', data: { requestId: `synthetic-title-${requests}`, status: 'complete', sourceConfidence: 1, warnings: [], imagePlans: [], results: [{ platform: 'youtube', draft: `Three keyboard shortcuts demonstrated. Draft ${requests}.`, title: requests === 1 ? 'Three keyboard shortcuts demonstrated' : 'Regenerated suggestion', origin: 'generated', warnings: [], charCount: 45 }] } }) + '\n' });
  });
  await openApp(page, '/create');
  await page.getByRole('button', { name: 'Media Library', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Media Library', exact: true });
  await picker.getByRole('button', { name: 'Select Keyboard shortcuts.mp4', exact: true }).click();
  await picker.getByRole('button', { name: 'Add selected media', exact: true }).click();
  await page.getByRole('button', { name: 'Continue to Destinations', exact: true }).click();
  for (const account of accounts) {
    const select = page.getByRole('button', { name: `Select ${account.name} on YouTube`, exact: true });
    if (await select.count()) await select.click();
  }
  await page.getByRole('button', { name: 'Continue to Review', exact: true }).click();
  const title = page.getByRole('textbox', { name: 'Title', exact: true });
  await expect(title).toBeVisible();
  await expect(title).toHaveValue('Three keyboard shortcuts demonstrated');
  await title.fill('My first channel title');
  await capture(page, info, 'youtube-title-first-channel');
  await page.getByRole('tab', { name: /Synthetic YouTube B/ }).click();
  await expect(title).toHaveValue('Three keyboard shortcuts demonstrated');
  await title.fill('My second channel title');
  await page.getByRole('tab', { name: /Synthetic YouTube A/ }).click();
  await expect(title).toHaveValue('My first channel title');
  await page.getByRole('button', { name: 'Regenerate Synthetic YouTube A caption', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Synthetic YouTube A caption', exact: true })).toHaveValue('Three keyboard shortcuts demonstrated. Draft 2.');
  await expect(title).toHaveValue('My first channel title');
  await capture(page, info, 'youtube-title-after-regeneration');
  expect(requests).toBe(2);
});
