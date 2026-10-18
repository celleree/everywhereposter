import { Page } from '@playwright/test';
import { test, expect, capture, noHorizontalOverflow, openApp, reachable, browserOrigin } from './fixtures';
import { connectionAvailable } from '../../libraries/nestjs-libraries/src/integrations/connection-availability';

const platforms = [
  ['x', 'X'], ['linkedin', 'LinkedIn'], ['linkedin-page', 'LinkedIn Page'],
  ['instagram', 'Instagram (Facebook Business with a long professional account label)'],
  ['instagram-standalone', 'Instagram (Standalone)'], ['facebook', 'Facebook Page'],
  ['threads', 'Threads'], ['youtube', 'YouTube'], ['tiktok', 'TikTok'], ['pinterest', 'Pinterest'],
];
// Synthetic configuration exercises the real server eligibility function, never provider APIs.
const env = Object.fromEntries([
  'X_API_KEY', 'X_API_SECRET', 'LINKEDIN_CLIENT_ID', 'LINKEDIN_CLIENT_SECRET',
  'FACEBOOK_APP_ID', 'FACEBOOK_APP_SECRET', 'INSTAGRAM_APP_ID', 'INSTAGRAM_APP_SECRET',
  'THREADS_APP_ID', 'THREADS_APP_SECRET', 'YOUTUBE_CLIENT_ID', 'YOUTUBE_CLIENT_SECRET',
  'TIKTOK_CLIENT_ID', 'TIKTOK_CLIENT_SECRET', 'PINTEREST_CLIENT_ID', 'PINTEREST_CLIENT_SECRET',
].map(key => [key, 'synthetic']));
const catalog = (configuration = env) => ({
  social: [...platforms, ['reddit', 'Reddit'], ['unknown', 'Unknown provider']].map(([identifier, name]) => ({
    identifier, name, connectionAvailable: connectionAvailable(identifier, configuration),
    isExternal: false, isWeb3: false,
  })), article: [],
});

async function openPicker(page: Page, width: number) {
  if (width <= 1025) {
    await page.getByRole('button', { name: 'More', exact: true }).click();
    const more = page.getByRole('dialog', { name: 'More menu' });
    await expect(more).toBeVisible();
    const add = more.getByRole('button', { name: 'Add Channel', exact: true });
    await reachable(add); await add.click();
    await expect(more).not.toBeVisible();
  } else {
    await page.getByRole('button', { name: 'Add Channel', exact: true }).last().click();
  }
  const dialog = page.getByRole('dialog', { name: 'Add Channel', exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

for (const [width, height] of [[375, 844], [390, 844], [430, 932], [844, 390], [1440, 900]]) {
  for (const theme of ['light', 'dark']) {
    test(`Mobile channels: ${width}x${height} ${theme} eligible picker and navigation`, async ({ page, context }, info) => {
      await page.setViewportSize({ width, height });
      await context.addCookies([{ name: 'mode', value: theme, url: browserOrigin }]);
      await page.route('**/backend-api/integrations', route => route.fulfill({ json: catalog() }));
      const connections: string[] = [];
      await page.route('**/backend-api/integrations/social/**', route => {
        connections.push(route.request().url());
        return route.fulfill({ status: 400, json: { err: 'Synthetic connection disabled' } });
      });
      await openApp(page, '/create');
      await expect(page.locator('body')).toHaveClass(new RegExp(theme));
      const dialog = await openPicker(page, width);
      await expect(dialog.getByRole('heading', { name: 'Available platforms' })).toBeVisible();
      await expect(dialog.locator('.channel-choice')).toHaveCount(10);
      for (const [, name] of platforms) {
        const button = dialog.getByRole('button', { name, exact: true });
        await expect(button).toBeEnabled();
        const box = await button.boundingBox();
        expect(box!.height).toBeGreaterThanOrEqual(44);
        expect(box!.width).toBeGreaterThanOrEqual(44);
      }
      await expect(dialog.getByText(/Coming soon|Unknown provider|Reddit/)).toHaveCount(0);
      const geometry = await dialog.evaluate(element => {
        const rect = element.getBoundingClientRect();
        const grid = element.querySelector('.channel-picker-grid')!;
        const body = element.querySelector('.modal-body')!;
        return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
          columns: getComputedStyle(grid).gridTemplateColumns.split(' ').length,
          overflow: [...element.querySelectorAll('.channel-picker-grid, .channel-choice, .modal-body')]
            .some(item => item.scrollWidth > item.clientWidth + 1),
          bodyScrollable: body.scrollHeight > body.clientHeight,
          scrollStyle: getComputedStyle(body).overflowY };
      });
      expect(geometry.left).toBeGreaterThanOrEqual(0);
      expect(geometry.right).toBeLessThanOrEqual(width);
      expect(geometry.top).toBeGreaterThanOrEqual(0);
      expect(geometry.bottom).toBeLessThanOrEqual(height);
      expect(geometry.columns).toBe(2);
      expect(geometry.overflow).toBe(false);
      expect(geometry.scrollStyle).toBe('auto');
      if (height === 390) expect(geometry.bodyScrollable).toBe(true);
      const last = dialog.getByRole('button', { name: 'Pinterest', exact: true });
      await reachable(last);
      const close = dialog.getByRole('button', { name: 'Close dialog' });
      await expect(close).toBeInViewport({ ratio: 1 });
      await noHorizontalOverflow(page);
      await capture(page, info, `channels-${width}-${height}-${theme}`);
      await close.focus(); await page.keyboard.press('Shift+Tab');
      await expect(last).toBeFocused();
      await page.keyboard.press('Tab'); await expect(close).toBeFocused();
      await close.click(); await expect(dialog).not.toBeVisible();
      if (width <= 1025) {
        const moreButton = page.getByRole('button', { name: 'More', exact: true });
        await expect(moreButton).toBeFocused(); await moreButton.click();
        const more = page.getByRole('dialog', { name: 'More menu' });
        await expect(more).toBeVisible();
        await reachable(more.getByRole('button', { name: 'Close More' }));
        await capture(page, info, `more-${width}-${height}-${theme}`);
        await page.keyboard.press('Escape'); await expect(more).not.toBeVisible();
      }
      await noHorizontalOverflow(page);
      expect(connections).toEqual([]);
    });
  }
}

test('Mobile channels: missing or false eligibility stays hidden and Escape preserves a draft', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/backend-api/integrations', route => route.fulfill({ json: {
    ...catalog({}), social: [...catalog({}).social, { identifier: 'x', name: 'Legacy X without eligibility' }],
  } }));
  await openApp(page, '/create');
  await page.getByRole('button', { name: 'Write a text post', exact: true }).click();
  const input = page.getByRole('textbox', { name: 'Post text', exact: true });
  const draft = 'Synthetic draft retained while managing channels.';
  await input.fill(draft);
  const dialog = await openPicker(page, 390);
  await expect(dialog.getByText('No connection options are currently available.')).toBeVisible();
  await expect(dialog.locator('.channel-choice')).toHaveCount(0);
  await expect(dialog.getByText(/Coming soon|Legacy X/)).toHaveCount(0);
  await page.keyboard.press('Escape'); await expect(dialog).not.toBeVisible();
  await expect(input).toHaveValue(draft);
});

test('Mobile channels: each configured provider retains its original keyboard connection dispatch', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/backend-api/integrations', route => route.fulfill({ json: catalog() }));
  const connections: string[] = [];
  await page.route('**/backend-api/integrations/social/*', route => {
    connections.push(new URL(route.request().url()).pathname);
    return route.fulfill({ status: 400, json: { err: 'Synthetic connection disabled' } });
  });
  await openApp(page, '/create');
  const dialog = await openPicker(page, 390);
  for (const [identifier, name] of platforms) {
    await dialog.getByRole('button', { name, exact: true }).focus();
    await page.keyboard.press('Enter');
    if (identifier === 'instagram-standalone') {
      const instructions = page.getByRole('dialog', { name: 'Before connecting Instagram Standalone' });
      await expect(instructions).toBeVisible();
      await instructions.getByRole('button', { name: 'Continue to Instagram', exact: true }).click();
    }
    await expect.poll(() => connections.at(-1)).toBe(`/backend-api/integrations/social/${identifier}`);
    await expect(page).toHaveURL(/\/create$/);
    await expect(dialog).toBeVisible();
  }
  expect(connections).toHaveLength(platforms.length);
});
