import { test, expect, capture, noHorizontalOverflow, openApp, reachable } from './fixtures';

const platforms = [
  ['x', 'X'], ['linkedin', 'LinkedIn'], ['linkedin-page', 'LinkedIn Page'],
  ['instagram', 'Instagram Business'], ['instagram-standalone', 'Instagram Professional'],
  ['facebook', 'Facebook Page'], ['threads', 'Threads'], ['youtube', 'YouTube'],
  ['tiktok', 'TikTok'], ['pinterest', 'Pinterest'],
];

for (const width of [375, 390, 430, 1440]) {
  for (const theme of ['light', 'dark']) {
    test(`Mobile channels: ${width}px ${theme} navigation and channel picker`, async ({ page, context }, info) => {
      await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
      await context.addCookies([{ name: 'mode', value: theme, url: 'http://127.0.0.1:4217' }]);
      await page.route('**/backend-api/integrations', route => route.fulfill({ json: {
        social: [...platforms.map(([identifier, name]) => ({ identifier, name, isExternal: false, isWeb3: false })),
          { identifier: 'reddit', name: 'Reddit', isExternal: false, isWeb3: false },
          { identifier: 'unrecognized', name: 'Unrecognized provider', isExternal: false, isWeb3: false }],
        article: [],
      } }));
      const connections: string[] = [];
      await page.route('**/backend-api/integrations/social/**', route => {
        connections.push(route.request().url());
        return route.fulfill({ status: 400, json: { err: 'Synthetic connection disabled' } });
      });
      await openApp(page, '/create');
      await expect(page.locator('body')).toHaveClass(new RegExp(theme));
      if (width < 1025) {
        await page.getByRole('button', { name: 'More', exact: true }).click();
        const more = page.getByRole('dialog', { name: 'More menu' });
        await expect(more).toBeVisible();
        const first = more.getByRole('navigation', { name: 'More navigation' });
        const close = more.getByRole('button', { name: 'Close More' });
        const header = await close.boundingBox(), links = await first.boundingBox();
        expect(header).not.toBeNull(); expect(links).not.toBeNull();
        expect(links!.y - header!.y).toBeLessThan(65);
        await expect(close).toBeInViewport();
        await capture(page, info, `more-${width}-${theme}`);
        await reachable(close); await close.click();
        await page.getByRole('button', { name: 'More', exact: true }).click();
        await reachable(more.getByRole('button', { name: 'Add Channel', exact: true }));
        await more.getByRole('button', { name: 'Add Channel', exact: true }).click();
        await expect(more).not.toBeVisible();
      } else {
        await page.getByRole('button', { name: 'Add Channel', exact: true }).last().click();
      }
      const dialog = page.getByRole('dialog', { name: 'Add Channel', exact: true });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole('heading', { name: 'Available platforms' })).toBeVisible();
      await expect(dialog.getByRole('heading', { name: 'Coming soon', exact: true })).toBeVisible();
      for (const [, name] of platforms) {
        const button = dialog.getByRole('button', { name, exact: true });
        await expect(button).toBeEnabled();
        const box = await button.boundingBox();
        expect(box!.height).toBeGreaterThanOrEqual(44);
      }
      await expect(dialog.getByText('Unrecognized provider')).toHaveCount(0);
      await expect(page.getByRole('button', { name: /Send Invite Link/ })).toHaveCount(0);
      const disabled = dialog.locator('button:disabled:visible');
      await expect(disabled).toHaveCount(3);
      for (const name of ['Reddit', 'Discord', 'Twitch']) {
        await expect(dialog.getByRole('button', { name: `${name} Coming soon`, exact: true })).toBeDisabled();
      }
      await expect(dialog.getByRole('button', { name: 'Slack Coming soon', exact: true })).not.toBeVisible();
      await noHorizontalOverflow(page);
      await capture(page, info, `channels-${width}-${theme}-collapsed`);
      const toggle = dialog.getByRole('button', { name: 'View all upcoming platforms' });
      await reachable(toggle); await toggle.focus(); await page.keyboard.press('Enter');
      await expect(dialog.getByRole('button', { name: 'Show less' })).toHaveAttribute('aria-expanded', 'true');
      await expect(disabled).toHaveCount(9);
      const last = dialog.getByRole('button', { name: 'WordPress Coming soon', exact: true });
      await reachable(last); await expect(last).toBeDisabled();
      await dialog.locator('button:disabled').evaluateAll(elements => elements.forEach(element => (element as HTMLButtonElement).click()));
      await expect(dialog.locator('a')).toHaveCount(0);
      expect(connections).toEqual([]);
      await capture(page, info, `channels-${width}-${theme}-expanded`);
      await dialog.getByRole('button', { name: 'Show less' }).click();
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      const close = dialog.getByRole('button', { name: 'Close dialog' });
      await reachable(close); await close.focus(); await page.keyboard.press('Shift+Tab');
      await expect(toggle).toBeFocused();
      await page.keyboard.press('Tab'); await expect(close).toBeFocused();
      await close.click(); await expect(dialog).not.toBeVisible();
      await noHorizontalOverflow(page);
      expect(connections).toEqual([]);
    });
  }
}

test('Mobile channels: missing endpoint providers are never presented as connectable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/backend-api/integrations', route => route.fulfill({ json: {
    social: [{ identifier: 'reddit', name: 'Reddit', isExternal: false }], article: [],
  } }));
  await openApp(page, '/create');
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('dialog', { name: 'More menu' }).getByRole('button', { name: 'Add Channel', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Add Channel', exact: true });
  await expect(dialog.getByText('No connection options are currently available.')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'X', exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Reddit Coming soon', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape'); await expect(dialog).not.toBeVisible();
});
