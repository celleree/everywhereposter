import {
  test,
  expect,
  capture,
  noHorizontalOverflow,
  openApp,
} from './fixtures';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const video = {
  id: 'quick-video',
  name: 'quick-video.mp4',
  originalName: 'Quick test video.mp4',
  path: '/audit-fixtures/quick-video.mp4',
  type: 'video',
};
const accounts = [
  { id: 'quick-x', name: 'Quick X', identifier: 'x' },
  { id: 'quick-youtube', name: 'Quick YouTube', identifier: 'youtube' },
  {
    id: 'quick-reconnect',
    name: 'Reconnect Facebook',
    identifier: 'facebook',
    refreshNeeded: true,
  },
  {
    id: 'quick-disabled',
    name: 'Disabled LinkedIn',
    identifier: 'linkedin',
    disabled: true,
  },
  { id: 'quick-tiktok', name: 'Quick TikTok', identifier: 'tiktok' },
].map((account) => ({
  type: 'social',
  editor: 'normal',
  display: account.name,
  picture: '',
  additionalSettings: '[]',
  time: [],
  inBetweenSteps: false,
  ...account,
}));

for (const ambiguous of [false, true]) {
  test(`Quick Upload: ${
    ambiguous
      ? 'lost response and reload lock'
      : 'automatic publish, required settings and Customize'
  }`, async ({ page }, info) => {
    let submissions: any[] = [];
    let polls = 0;
    await page.route('**/audit-fixtures/quick-video.mp4', (route) =>
      route.fulfill({
        contentType: 'video/mp4',
        body: readFileSync(
          path.resolve('tests/browser/assets/synthetic-picker.mp4')
        ),
      })
    );
    // All mutations are fulfilled in the disposable browser; none reach any backend.
    await page.route('**/backend-api/**', async (route) => {
      const request = route.request(),
        url = new URL(request.url());
      if (url.pathname === '/backend-api/integrations/list')
        return route.fulfill({ json: { integrations: accounts } });
      if (url.pathname === '/backend-api/media')
        return route.fulfill({ json: { pages: 1, results: [video] } });
      if (url.pathname === '/backend-api/media/quick-video')
        return route.fulfill({ json: video });
      if (url.pathname.includes('/transcription'))
        return route.fulfill({ json: { status: 'READY', text: '' } });
      if (url.pathname === '/backend-api/posts/copy/generate') {
        const body = request.postDataJSON();
        expect(body.mediaId).toBe(video.id);
        expect(body.captionMode).toBe('generate');
        const result = {
          requestId: 'browser-quick-copy',
          status: 'complete',
          sourceConfidence: 0.9,
          warnings: [
            {
              code: 'NO_TRANSCRIPT',
              message: 'Grounded visual frames, no spoken dialogue.',
            },
          ],
          imagePlans: [],
          results: body.platforms.map((platform: string) => ({
            platform,
            draft: `${platform} caption grounded in the test video.`,
            origin: 'generated',
            warnings: [],
            charCount: 45,
          })),
        };
        return route.fulfill({
          contentType: 'application/x-ndjson',
          body: JSON.stringify({ name: 'completed', data: result }) + '\n',
        });
      }
      if (
        url.pathname === '/backend-api/posts' &&
        request.method() === 'POST'
      ) {
        submissions.push(request.postDataJSON());
        if (ambiguous) return route.abort('failed');
        return route.fulfill({
          json: [{ postId: 'quick-created-x', integration: 'quick-x' }],
        });
      }
      if (url.pathname === '/backend-api/posts/quick-created-x') {
        polls++;
        return route.fulfill({
          json: {
            posts: [
              {
                id: 'quick-created-x',
                state: polls < 2 ? 'QUEUE' : 'PUBLISHED',
              },
            ],
          },
        });
      }
      return route.fallback();
    });
    await openApp(page, '/create');
    await page
      .getByRole('button', { name: 'Media Library', exact: true })
      .click();
    const picker = page.getByRole('dialog', { name: /^(Upload|Media Library)$/ });
    await picker
      .getByRole('button', { name: 'Select Quick test video.mp4', exact: true })
      .click({ position: { x: 10, y: 10 } });
    await picker
      .getByRole('button', { name: 'Add selected media', exact: true })
      .click();
    const quick = page.getByRole('button', {
      name: 'Quick Upload',
      exact: true,
    });
    await expect(quick).toBeEnabled();
    await expect(page.getByText(/without individual review/)).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Continue to Destinations' })
    ).toContainText('Customize');
    await noHorizontalOverflow(page);
    await capture(page, info, 'quick-upload-actions');
    await quick.dblclick();
    await expect.poll(() => submissions.length).toBe(1);
    expect(submissions[0].type).toBe('now');
    expect(submissions[0].posts).toHaveLength(1);
    expect(submissions[0].posts[0].integration.id).toBe('quick-x');
    expect(submissions[0].posts[0].value[0].content).toContain(
      'x caption grounded'
    );
    expect(submissions[0].posts[0].value[0].image[0].id).toBe(video.id);
    await expect(page.getByTestId('quick-skip-quick-reconnect')).toContainText(
      'Reconnect required'
    );
    await expect(page.getByTestId('quick-skip-quick-tiktok')).toContainText(
      'privacy'
    );
    const destination = page.getByTestId('guided-publish-destination-quick-x');
    if (ambiguous) {
      await expect(destination).toContainText('Status unknown');
      await expect(
        page.getByRole('button', { name: 'Prepare retry' })
      ).toHaveCount(0);
    } else {
      await expect(destination).toContainText('Published');
      expect(polls).toBeGreaterThanOrEqual(2);
      await expect(
        page.getByTestId('guided-publish-destination-quick-youtube')
      ).toContainText('Skipped');
      await expect(
        page.getByTestId('guided-publish-destination-quick-youtube')
      ).toContainText('Required platform settings');
    }
    await noHorizontalOverflow(page);
    await capture(page, info, 'quick-upload-results');
    await page.reload();
    // Recovery automatically hydrates the draft; it never restores auto-publish intent.
    await expect(page.getByText(/Check Schedule/).first()).toBeVisible();
    await page.waitForTimeout(500);
    expect(submissions).toHaveLength(1);
    await capture(page, info, 'quick-upload-recovery-lock');
  });
}
