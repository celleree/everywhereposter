import { test, expect, openApp, mobileProject, capture } from './fixtures';
import { readFileSync } from 'node:fs';
import path from 'node:path';

test('Resumable upload: navigation, browser return and safe completion', async ({ page }, info) => {
  test.skip(info.project.name.includes('webkit'), 'WebKit request interception does not expose Blob chunk bodies; Chromium covers the transfer protocol.');
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
  const tray = page.getByRole('region', { name: 'Video transfers' });
  await expect(tray).toBeVisible();
  const guidance = tray.getByText('Keep this browser open and on screen while uploading.');
  if (mobileProject(info)) await expect(guidance).toBeVisible();
  else await expect(guidance).toBeHidden();
  await expect.poll(() => interrupted).toBe(true);
  await expect(tray.getByText('Safe to leave.', { exact: false })).toHaveCount(0);
  if (mobileProject(info)) {
    await page.getByRole('navigation', { name: 'Mobile navigation' }).getByRole('button', { name: 'More', exact: true }).click();
    await page.getByRole('navigation', { name: 'More navigation' }).getByRole('link', { name: 'Settings', exact: true }).click();
  } else await page.locator('#left-menu').getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(page).toHaveURL(/settings/); await expect(tray).toHaveCount(0);
  released = true; resolveChunk!();
  await page.goBack();
  await expect(tray.getByRole('status')).toContainText('Resume needed');
  // Reload ends the layout controller, equivalent to returning with no in-memory File handle.
  await page.reload();
  await expect(tray.getByRole('status')).toContainText('Resume needed');
  await expect(tray.getByText('Select the original video to resume saved progress.')).toBeVisible();
  const chooser = page.waitForEvent('filechooser');
  await tray.getByRole('button', { name: 'Retry upload', exact: true }).click();
  await chooser;
  await page.getByLabel('Resume resume.mp4').setInputFiles({ name: 'resume.mp4', mimeType: 'video/mp4', buffer: bytes });
  await expect(tray.getByRole('status').first()).toHaveText('Transfer complete');
  expect(chunks.filter(index => index === 0)).toHaveLength(1);
  expect(session.status).toBe('COMPLETE');
});

test('Resumable upload: persisted Quick Upload choice before completion survives navigation and return', async ({ page }, info) => {
  test.skip(info.project.name.includes('webkit'), 'WebKit request interception does not expose Blob chunk bodies; Chromium covers the transfer protocol.');
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
  await openApp(page, '/media');
  await page.locator('input[type=file]').first().setInputFiles({ name: 'quick.mp4', mimeType: 'video/mp4', buffer: bytes });
  const tray = page.getByRole('region', { name: 'Video transfers' }); await expect.poll(() => held).toBe(true);
  await tray.getByRole('button', { name: 'Quick Upload without individual review' }).click();
  await expect(tray.getByRole('status').filter({ hasText: 'Quick Upload:' })).toContainText('Uploading'); expect(intent.id).toBe('quick-intent');
  await expect(tray.getByText('Safe to leave.', { exact: false })).toHaveCount(0);
  if (mobileProject(info)) {
    await page.getByRole('navigation', { name: 'Mobile navigation' }).getByRole('button', { name: 'More', exact: true }).click();
    await page.getByRole('navigation', { name: 'More navigation' }).getByRole('link', { name: 'Settings', exact: true }).click();
  } else await page.locator('#left-menu').getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(page).toHaveURL(/settings/); await expect(tray).toHaveCount(0); continueTransfer = true; release!();
  await page.goBack();
  await expect(tray.getByRole('status').first()).toHaveText('Transfer complete');
  intent.status = 'PUBLISHING'; session.quickIntent = intent; await page.reload();
  await expect(tray.getByRole('status').filter({ hasText: 'Quick Upload:' })).toContainText('Publishing');
  intent.status = 'COMPLETE'; intent.results = [{ integrationId: 'fixture', name: 'Fixture account', state: 'Published' }, { integrationId: 'failed-x', name: 'X account', state: 'Failed', reason: 'Synthetic rejection' }]; session.quickIntent = intent; await page.reload();
  await expect(tray.getByText('Fixture account: Published')).toBeVisible();
  await expect(tray.getByText('X account: Failed — Synthetic rejection')).toBeVisible();
});

test('Resumable upload: restored completed transfers stay inline and do not cover the phone picker', async ({ page }, info) => {
  // Account for the viewport consumed by phone browser controls.
  await page.setViewportSize({ width: 390, height: 580 });
  await page.route('**/backend-api/media/uploads**', route => route.fulfill({ json: { sessions: [0, 1].map(index => ({
    id: `completed-${index}`, originalName: `synthetic-${index}.mp4`, byteSize: 128 * 1024 * 1024,
    status: 'COMPLETE', parts: [], manifest: [], media: { id: `media-${index}` },
  })) } }));
  const initialRestoredUploads = page.waitForResponse(response =>
    new URL(response.url()).pathname === '/backend-api/media/uploads' &&
    response.request().method() === 'GET' && response.ok(), { timeout: 60_000 });
  await openApp(page, '/create');
  const choose = page.getByRole('button', { name: 'Choose files', exact: true });
  await Promise.all([initialRestoredUploads, expect(choose).toBeVisible({ timeout: 60_000 })]);
  await expect(page.getByRole('region', { name: 'Video transfers' })).toBeVisible();
  await expect.poll(() => choose.evaluate(element => {
    const r = element.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!hit && (hit === element || element.contains(hit));
  })).toBe(true);
  await capture(page, info, 'compact-transfers-phone-picker');
  // A real click must reach the picker, even with restored transfer history.
  const chooser = page.waitForEvent('filechooser');
  await choose.click({ timeout: 5000 });
  await chooser;
  const tray = page.getByRole('region', { name: 'Video transfers' });
  await expect(tray.getByText('synthetic-0.mp4', { exact: true })).toBeVisible();
  expect(await tray.evaluate(element => getComputedStyle(element).position)).toBe('static');
  await tray.getByRole('button', { name: 'Dismiss transfer' }).first().click();
  await expect(tray.getByText('synthetic-0.mp4', { exact: true })).toHaveCount(0);
  // Reload hydration has the same bounded bootstrap budget as openApp.
  const restoredUploads = page.waitForResponse(response =>
    new URL(response.url()).pathname === '/backend-api/media/uploads' &&
    response.request().method() === 'GET' && response.ok(), { timeout: 60_000 });
  await page.reload();
  await Promise.all([restoredUploads, expect(choose).toBeVisible({ timeout: 60_000 })]);
  await expect(tray.getByText('synthetic-0.mp4', { exact: true })).toHaveCount(0);
  await expect(tray.getByText('synthetic-1.mp4', { exact: true })).toBeVisible();
});

test('Resumable upload: admission errors remain visible inline', async ({ page }) => {
  let creations = 0;
  await page.route('**/backend-api/media/uploads**', route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { sessions: [{
      id: 'older-upload', originalName: 'older.mp4', byteSize: 1000, status: 'UPLOADING',
      parts: [], manifest: [], error: 'Older connection failed.',
    }] } });
    creations++;
    return route.fulfill({ status: 409, json: { message: 'Daily upload session quota reached.' } });
  });
  await openApp(page, '/media');
  await expect(page.getByRole('region', { name: 'Video transfers' }).getByRole('alert')).toHaveText('Older connection failed.');
  await page.locator('input[type=file]').first().setInputFiles({ name: 'quota.mp4', mimeType: 'video/mp4', buffer: readFileSync(path.resolve('tests/browser/assets/synthetic-picker.mp4')) });
  const tray = page.getByRole('region', { name: 'Video transfers' });
  await expect(tray.getByRole('alert').filter({ hasText: 'Daily upload session quota reached.' })).toBeVisible();
  expect(creations).toBe(1);
});

test('Resumable upload: one-tap retry reconciles a lost chunk acknowledgement', async ({ page }, info) => {
  test.skip(info.project.name.includes('webkit'), 'WebKit request interception does not expose Blob chunk bodies; Chromium covers the transfer protocol.');
  const bytes = Buffer.concat([readFileSync(path.resolve('tests/browser/assets/synthetic-picker.mp4')), Buffer.alloc(9 * 1024 * 1024)]);
  let session: any, lost = false, resumeReads = 0, completions = 0, creations = 0;
  let release!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  const chunks: number[] = [];
  await page.route('**/backend-api/media/uploads**', async route => {
    const req = route.request(), pathname = new URL(req.url()).pathname;
    if (pathname === '/backend-api/media/uploads' && req.method() === 'GET') return route.fulfill({ json: { sessions: session ? [session] : [] } });
    if (pathname === '/backend-api/media/uploads' && req.method() === 'POST') {
      creations++; session = { ...req.postDataJSON(), id: 'retry-session', status: 'UPLOADING', parts: [] };
    } else if (pathname.includes('/parts/')) {
      const index = Number(pathname.split('/').pop()); chunks.push(index);
      session.parts.push({ index, digest: session.manifest[index], byteSize: Math.min(8 * 1024 * 1024, bytes.length - index * 8 * 1024 * 1024) });
      if (!lost) { lost = true; return route.abort('failed'); }
    } else if (pathname.endsWith('/complete')) {
      completions++; session = { ...session, status: 'COMPLETE', media: { id: 'retry-media', type: 'video', name: 'retry.mp4', path: '/audit-fixtures/retry.mp4' } };
    } else if (req.method() === 'GET') { resumeReads++; await hold; }
    return route.fulfill({ json: session });
  });
  await openApp(page, '/media');
  await page.locator('input[type=file]').first().setInputFiles({ name: 'retry.mp4', mimeType: 'video/mp4', buffer: bytes });
  const tray = page.getByRole('region', { name: 'Video transfers' });
  await expect(tray.getByRole('status')).toContainText('Resume needed');
  await expect(tray.getByText('Select the original video to resume saved progress.')).toHaveCount(0);
  await capture(page, info, 'retry-upload');
  let pickers = 0; page.on('filechooser', () => { pickers++; });
  // Dispatch two clicks in one turn, before React can hide the retry control.
  await tray.getByRole('button', { name: 'Retry upload', exact: true }).evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
  await expect.poll(() => resumeReads).toBe(1);
  await expect(tray.getByRole('button', { name: 'Retry upload', exact: true })).toHaveCount(0);
  await expect(tray.getByRole('button', { name: 'Cancel upload', exact: true })).toBeVisible();
  release();
  await expect(tray.getByRole('status').first()).toHaveText('Transfer complete');
  expect(pickers).toBe(0); expect(creations).toBe(1); expect(completions).toBe(1);
  expect(chunks).toEqual([0, 1]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});


test('Resumable upload: recovered publishing acknowledgement and discard keep Create usable', async ({ page }, info) => {
  let posts = 0;
  await page.route('**/backend-api/posts**', route => {
    if (route.request().method() !== 'GET') posts++;
    return route.fallback();
  });
  await openApp(page, '/create');
  const mobile = mobileProject(info);
  if (mobile) await page.getByRole('button', { name: 'Write a text post', exact: true }).click();
  const text = mobile ? page.getByRole('textbox', { name: 'Post text', exact: true }) : page.locator('[contenteditable="true"]').first();
  await text.fill('Synthetic previous draft');
  await page.evaluate(() => {
    const key = 'everywhereposter:create-draft:v1:synthetic-user:synthetic-org';
    const draft = JSON.parse(localStorage.getItem(key)!);
    draft.journal = { attemptId: 'synthetic-previous-attempt', destinationIds: ['youtube', 'x'], startedAt: Date.now() };
    localStorage.setItem(key, JSON.stringify(draft));
  });
  await page.reload();
  const recovery = page.getByRole('region', { name: 'Publishing recovery' });
  await expect(recovery).toBeVisible();
  await expect(recovery.getByRole('link', { name: 'Open Schedule' })).toBeVisible();
  await recovery.getByRole('button', { name: 'Acknowledge notice' }).click();
  await expect(recovery.getByText('Publishing remains locked until you start a new draft.')).toBeVisible();
  page.once('dialog', dialog => dialog.accept());
  await recovery.getByRole('button', { name: 'Start a new draft' }).click();
  await expect(recovery).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Choose files', exact: true })).toBeVisible();
  if (mobile) await page.getByRole('button', { name: 'Write a text post', exact: true }).click();
  await text.fill('Synthetic fresh draft');
  await page.reload();
  if (mobile && !(await text.isVisible())) await page.getByRole('button', { name: 'Write a text post', exact: true }).click();
  if (mobile) await expect(text).toHaveValue('Synthetic fresh draft');
  else await expect(text).toHaveText('Synthetic fresh draft');
  expect(posts).toBe(0);
  await capture(page, info, 'composer-after-recovery-discard');
});


test('Resumable upload: cancel settles before a fresh upload and leaves no stale warning', async ({ page }, info) => {
  test.skip(info.project.name.includes('webkit'), 'Chromium covers Blob request interception.');
  let session: any, creations = 0, deletes = 0, held = false, release!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/backend-api/media/uploads**', async route => {
    const req = route.request(), pathname = new URL(req.url()).pathname;
    if (pathname === '/backend-api/media/uploads' && req.method() === 'GET') return route.fulfill({ json: { sessions: session && session.status !== 'CANCELLED' ? [session] : [] } });
    if (pathname === '/backend-api/media/uploads' && req.method() === 'POST') {
      creations++; session = { ...req.postDataJSON(), id: 'session-' + creations, status: 'UPLOADING', parts: [] };
    } else if (pathname.includes('/parts/')) {
      if (creations === 1) { held = true; await hold; return route.abort('failed').catch(() => {}); }
      session.parts.push({ index: 0, byteSize: req.postDataBuffer()!.length, digest: session.manifest[0] });
    } else if (req.method() === 'DELETE') {
      deletes++; session.status = 'CANCELLED'; return route.fulfill({ json: { cancelled: true } });
    } else if (pathname.endsWith('/complete')) session = { ...session, status: 'COMPLETE', media: { id: 'second-media', name: 'fresh.mp4', path: '/audit-fixtures/fresh.mp4', type: 'video' } };
    return route.fulfill({ json: session });
  });
  await openApp(page, '/media');
  const picker = page.locator('input[type=file]').first();
  const upload = { name: 'cancel.mp4', mimeType: 'video/mp4', buffer: readFileSync(path.resolve('tests/browser/assets/synthetic-picker.mp4')) };
  await picker.setInputFiles(upload);
  await expect.poll(() => held).toBe(true);
  const tray = page.getByRole('region', { name: 'Video transfers' });
  await tray.getByRole('button', { name: 'Cancel upload', exact: true }).click();
  release();
  await expect(tray).toHaveCount(0);
  await picker.setInputFiles({ ...upload, name: 'fresh.mp4' });
  await expect(tray.getByRole('status').first()).toHaveText('Transfer complete');
  await expect(tray.getByRole('alert')).toHaveCount(0);
  await expect(tray.getByText('Keep this browser open and on screen while uploading.')).toHaveCount(0);
  expect(creations).toBe(2); expect(deletes).toBe(1);
});


test('Resumable upload: server completion clears a prior cancellation warning without deleting media', async ({ page }) => {
  let deletes = 0;
  const session: any = { id: 'busy-restored', originalName: 'busy.mp4', byteSize: 100, status: 'UPLOADING', parts: [], manifest: [] };
  await page.route('**/backend-api/media/uploads**', route => {
    if (route.request().method() === 'DELETE') {
      deletes++;
      return route.fulfill({ status: 409, json: { message: 'Wait for the current request to finish before cancellation.' } });
    }
    const list = new URL(route.request().url()).pathname === '/backend-api/media/uploads';
    return route.fulfill({ json: list ? { sessions: [session] } : session });
  });
  await openApp(page, '/media');
  const tray = page.getByRole('region', { name: 'Video transfers' });
  await tray.getByRole('button', { name: 'Cancel upload', exact: true }).click();
  await expect(tray.getByRole('alert')).toContainText('Wait for the current request');
  session.status = 'COMPLETE'; session.media = { id: 'saved-busy-media' };
  await expect(tray.getByRole('status').first()).toHaveText('Transfer complete');
  await expect(tray.getByRole('alert')).toHaveCount(0);
  await tray.getByRole('button', { name: 'Dismiss transfer' }).click();
  await expect(tray).toHaveCount(0);
  expect(deletes).toBe(1);
});
