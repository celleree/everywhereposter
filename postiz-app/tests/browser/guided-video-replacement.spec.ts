import { test, expect, openApp, capture } from './fixtures';
import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

const clips = ['composer-320x180.mp4', 'composer-240x240.mp4'].map(name =>
  readFileSync(path.resolve('tests/browser/assets', name))
);
const media = ['A', 'B'].map(letter => ({
  id: `issue-80-video-${letter}`, name: `Disposable video ${letter}.mp4`,
  originalName: `Disposable video ${letter}.mp4`,
  path: `/audit-fixtures/issue-80-${letter}.mp4`, type: 'video',
}));

async function draftState(page: Page) {
  return page.evaluate(() => {
    const key = Object.keys(localStorage).find(key =>
      key.startsWith('everywhereposter:create-draft:v1:') && !key.includes('immediate-receipt')
    );
    if (!key) return null;
    const draft = JSON.parse(localStorage.getItem(key)!);
    return {
      sourceMediaId: draft.guided.sourceMediaId,
      transcriptionStatus: draft.guided.transcriptionStatus,
      transcriptionError: draft.guided.transcriptionError,
      composerStep: draft.guided.composerStep,
      mediaIds: draft.global[0].media.map((item: { id: string }) => item.id),
    };
  });
}

for (const lateStatus of ['READY', 'FAILED']) {
  test(`Upload picker: viewport video replacement ignores late A ${lateStatus} (issue #80)`, async ({ page }, info) => {
    const [a, b] = media;
    const ensures: string[] = [], reads: string[] = [], mutations: string[] = [];
    let aRequests = 0, aHeld = false, bReady = false;
    let releaseA!: () => void;
    const aGate = new Promise<void>(resolve => { releaseA = resolve; });
    await page.route('**/audit-fixtures/issue-80-*.mp4', route =>
      route.fulfill({ contentType: 'video/mp4', body: clips[route.request().url().includes('-A.mp4') ? 0 : 1] })
    );
    await page.route('**/backend-api/**', async route => {
      const request = route.request(), url = new URL(request.url());
      if (request.method() !== 'GET') mutations.push(`${request.method()} ${url.pathname}`);
      if (request.method() === 'GET' && url.pathname === '/backend-api/media') {
        return route.fulfill({ json: { pages: 1, results: media } });
      }
      const record = media.find(item => url.pathname.startsWith(`/backend-api/media/${item.id}/transcription`));
      if (!record) return route.fallback();
      const ensure = url.pathname.endsWith('/ensure') && request.method() === 'POST';
      if (!ensure && (request.method() !== 'GET' || url.pathname !== `/backend-api/media/${record.id}/transcription`)) {
        return route.fallback();
      }
      (ensure ? ensures : reads).push(record.id);
      // The picker must finish its audio/ensure check before attaching A. Hold
      // the shell's subsequent request so it completes only after B is active.
      if (record.id === a.id && ensure && ++aRequests > 1) {
        aHeld = true;
        await aGate;
        return route.fulfill({ json: { mediaId: a.id, status: lateStatus,
          error: lateStatus === 'FAILED' ? { message: 'Late failure from video A' } : null,
          text: lateStatus === 'READY' ? 'Late transcript from video A' : null } });
      }
      return route.fulfill({ json: { mediaId: record.id,
        status: record.id === b.id && bReady ? 'READY' : 'PROCESSING',
        error: null, text: record.id === b.id && bReady ? 'Disposable video B transcript' : null } });
    });
    try {
      await openApp(page, '/create');
      const card = page.locator('.composer-upload-card');
      const attach = async (record: typeof a) => {
        await card.getByRole('button', { name: 'Media Library', exact: true }).click();
        const picker = page.getByRole('dialog', { name: 'Media Library', exact: true });
        await picker.getByRole('button', { name: `Select ${record.originalName}`, exact: true }).click({ position: { x: 10, y: 10 } });
        await picker.getByRole('button', { name: 'Add selected media', exact: true }).click();
        await expect(picker).toHaveCount(0);
      };
      await attach(a);
      await expect.poll(() => aHeld).toBe(true);
      await expect.poll(() => draftState(page)).toMatchObject({ sourceMediaId: a.id, mediaIds: [a.id] });
      await expect(card.locator('video')).toHaveAttribute('src', a.path);

      await attach(b);
      await expect.poll(() => ensures.filter(id => id === b.id).length).toBeGreaterThanOrEqual(2);
      await expect(card.locator('video')).toHaveAttribute('src', b.path);
      await expect.poll(() => card.locator('video').evaluate(v => (v as HTMLVideoElement).videoWidth)).toBe(240);
      const processing = page.getByText('Transcribing… You can continue choosing destinations.', { exact: true });
      await expect(processing).toBeVisible();
      const activeB = { sourceMediaId: b.id, mediaIds: [b.id], transcriptionStatus: 'PROCESSING', transcriptionError: null };
      await expect.poll(() => draftState(page)).toMatchObject(activeB);

      const lateResponse = page.waitForResponse(response =>
        response.url().endsWith(`/media/${a.id}/transcription/ensure`) && response.request().method() === 'POST'
      );
      releaseA();
      expect(await (await lateResponse).json()).toMatchObject({ mediaId: a.id, status: lateStatus });
      // Allow the real fetch/json continuation and React render to consume A.
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      await expect(processing).toBeVisible();
      await expect(page.getByText('Transcript ready', { exact: true })).toHaveCount(0);
      await expect(page.getByText('Late failure from video A')).toHaveCount(0);
      await expect.poll(() => draftState(page)).toMatchObject(activeB);
      const continueButton = page.getByRole('button', { name: 'Continue to Destinations', exact: true });
      await expect(continueButton).toBeEnabled();
      await expect(page.getByText('Upload an MP4 or MOV video to continue.', { exact: true })).toHaveCount(0);
      await capture(page, info, `issue-80-B-after-late-A-${lateStatus}`);
      await continueButton.click();
      await expect(page.getByRole('heading', { name: 'Choose accounts', exact: true })).toBeVisible();
      await expect.poll(() => draftState(page)).toMatchObject({ ...activeB, composerStep: 'destinations' });

      bReady = true;
      await expect.poll(() => draftState(page)).toMatchObject({ ...activeB, composerStep: 'destinations', transcriptionStatus: 'READY' });
      expect(reads).toContain(b.id);
      // Background assistant traffic is unrelated; composer writes must be
      // exactly the transcription ensures, with no media deletion or publishing.
      expect(mutations.filter(value => /\/backend-api\/(?:media|posts)(?:\/|$)/.test(value)))
        .toEqual(ensures.map(id => `POST /backend-api/media/${id}/transcription/ensure`));
      await info.attach('issue-80-replacement-evidence', { contentType: 'application/json', body: JSON.stringify({
        fixture: 'isolated real frontend; synthetic transcription responses; no real backend or provider',
        lateStatus, ensures, reads, mutations, finalDraft: await draftState(page),
        clipHashes: clips.map(bytes => createHash('sha256').update(bytes).digest('hex')),
        testHash: createHash('sha256').update(readFileSync(__filename)).digest('hex'),
      }, null, 2) });
      await capture(page, info, `issue-80-destinations-${lateStatus}`);
    } finally {
      releaseA();
    }
  });
}
