import { test, expect, openApp, mobileProject } from './fixtures';
import { readFileSync } from 'node:fs';
import path from 'node:path';

test('Resumable upload: navigation, browser return and safe completion', async ({ page }, info) => {
  const bytes = Buffer.concat([readFileSync(path.resolve('tests/browser/assets/synthetic-picker.mp4')), Buffer.alloc(17 * 1024 * 1024)]);
  let session: any;
  let interrupted = false;
  let released = false;
  const chunks: number[] = [];
  let resolveChunk: () => void;
  const hold = new Promise<void>(resolve => { resolveChunk = resolve; });
  await page.route('**/backend-api/media/uploads**', async route => {
    const request = route.request(); const url = new URL(request.url()); const method = request.method();
    if (url.pathname === '/backend-api/media/uploads' && method === 'GET') return route.fulfill({ json: { sessions: session ? [session] : [] } });
    if (url.pathname === '/backend-api/media/uploads' && method === 'POST') {
      const body = request.postDataJSON();
      expect(body.organizationId).toBe('synthetic-org');
      session = { ...body, id: 'browser-session', status: 'UPLOADING', parts: [] };
      return route.fulfill({ json: session });
    }
    if (url.pathname.includes('/parts/')) {
      const index = Number(url.pathname.split('/').pop());
      const size = request.postDataBuffer()!.length; expect(size).toBeLessThanOrEqual(8 * 1024 * 1024);
      chunks.push(index);
      if (index === 1 && !released) { interrupted = true; await hold; return route.abort('failed'); }
      session.parts.push({ index, byteSize: size, digest: session.manifest[index] });
      return route.fulfill({ json: session });
    }
    if (url.pathname.endsWith('/complete')) {
      session = { ...session, status: 'COMPLETE', media: { id: 'browser-video', originalName: 'resume.mp4', name: 'resume.mp4', type: 'video', path: '/audit-fixtures/resume.mp4' } };
      return route.fulfill({ json: session });
    }
    return route.fulfill({ json: session });
  });
  await openApp(page, '/media');
  await page.locator('input[type=file]').first().setInputFiles({ name: 'resume.mp4', mimeType: 'video/mp4', buffer: bytes });
  const tray = page.getByRole('complementary', { name: 'Video transfers' });
  await expect(tray).toBeVisible(); await expect.poll(() => interrupted).toBe(true);
  await expect(tray.getByText('Safe to leave.', { exact: false })).toHaveCount(0);
  if (mobileProject(info)) {
    await page.getByRole('navigation', { name: 'Mobile navigation' }).getByRole('button', { name: 'More', exact: true }).click();
    await page.getByRole('navigation', { name: 'More navigation' }).getByRole('link', { name: 'Settings', exact: true }).click();
  } else await page.locator('#left-menu').getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(page).toHaveURL(/settings/); await expect(tray).toBeVisible();
  released = true; resolveChunk!();
  await expect(tray.getByRole('status')).toContainText('Resume needed');
  // Reload ends the layout controller, equivalent to returning with no in-memory File handle.
  await page.reload(); await expect(tray.getByRole('status')).toContainText('Resume needed');
  await page.getByLabel('Resume resume.mp4').setInputFiles({ name: 'resume.mp4', mimeType: 'video/mp4', buffer: bytes });
  await expect(tray.getByText('Safe to leave.', { exact: false })).toBeVisible();
  expect(chunks.filter(index => index === 0)).toHaveLength(1);
  expect(session.status).toBe('COMPLETE');
});

test('Resumable upload: persisted Quick Upload choice before completion survives navigation and return', async ({ page }, info) => {
  const bytes = Buffer.concat([readFileSync(path.resolve('tests/browser/assets/synthetic-picker.mp4')), Buffer.alloc(17 * 1024 * 1024)]);
  let session: any, release: () => void, held = false, continueTransfer = false;
  const hold = new Promise<void>(resolve => { release = resolve; });
  let intent: any;
  await page.route('**/backend-api/media/uploads**', async route => {
    const req = route.request(), pathname = new URL(req.url()).pathname;
    if (pathname === '/backend-api/media/uploads' && req.method() === 'GET') return route.fulfill({ json: { durableQuickUploadEnabled: true, sessions: session ? [session] : [] } });
    if (pathname === '/backend-api/media/uploads' && req.method() === 'POST') { session = { ...req.postDataJSON(), id: 'quick-session', status: 'UPLOADING', parts: [] }; return route.fulfill({ json: session }); }
    if (pathname.endsWith('/quick-upload')) {
      expect(session.status).toBe('UPLOADING'); expect(req.postDataJSON().confirmNoIndividualReview).toBe(true);
      intent = { id: 'quick-intent', status: 'WAITING', results: [] }; session.quickIntent = intent;
      return route.fulfill({ json: intent });
    }
    if (pathname.includes('/parts/')) {
      const index = Number(pathname.split('/').pop());
      if (index === 0 && !continueTransfer) { held = true; await hold; }
      session.parts.push({ index, digest: session.manifest[index], byteSize: req.postDataBuffer()!.length });
      return route.fulfill({ json: session });
    }
    if (pathname.endsWith('/complete')) { session.status = 'COMPLETE'; session.media = { id: 'quick-media', name: 'quick.mp4', path: '/audit-fixtures/quick.mp4', type: 'video' }; return route.fulfill({ json: session }); }
    return route.fulfill({ json: session });
  });
  await page.route('**/backend-api/integrations/list', route => route.fulfill({ json: { integrations: [{ id: 'fixture', name: 'Fixture account', identifier: 'x', type: 'social', editor: 'normal', additionalSettings: '[]', time: [] }] } }));
  // Bootstrap the client route before holding a transfer; navigation assertions
  // measure transfer persistence, not a cold development chunk download.
  await openApp(page, '/settings'); await page.waitForLoadState('load');
  await openApp(page, '/media');
  await page.locator('input[type=file]').first().setInputFiles({ name: 'quick.mp4', mimeType: 'video/mp4', buffer: bytes });
  const tray = page.getByRole('complementary', { name: 'Video transfers' }); await expect.poll(() => held).toBe(true);
  await tray.getByRole('button', { name: 'Quick Upload without individual review' }).click();
  await expect(tray.getByRole('status').filter({ hasText: 'Quick Upload:' })).toContainText('Uploading'); expect(intent.id).toBe('quick-intent');
  await expect(tray.getByText('Safe to leave.', { exact: false })).toHaveCount(0);
  if (mobileProject(info)) {
    await page.getByRole('navigation', { name: 'Mobile navigation' }).getByRole('button', { name: 'More', exact: true }).click();
    await page.getByRole('navigation', { name: 'More navigation' }).getByRole('link', { name: 'Settings', exact: true }).click();
  } else await page.locator('#left-menu').getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(page).toHaveURL(/settings/); continueTransfer = true; release!();
  await expect(tray.getByText('Safe to leave.', { exact: false })).toBeVisible();
  intent.status = 'PUBLISHING'; session.quickIntent = intent; await page.reload();
  await expect(tray.getByRole('status').filter({ hasText: 'Quick Upload:' })).toContainText('Publishing');
  intent.status = 'COMPLETE'; intent.results = [{ integrationId: 'fixture', name: 'Fixture account', state: 'Published' }]; session.quickIntent = intent; await page.reload();
  await expect(tray.getByText('Fixture account: Published')).toBeVisible();
});
