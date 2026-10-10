import { test, expect, openApp, capture, noHorizontalOverflow } from './fixtures';
import type { Page } from '@playwright/test';

const channels = ['Synthetic channel with a long name for responsive checks', 'Second synthetic channel'];
const metrics = (label: string) => [{ label, data: [{ total: 123, date: '2035-01-01' }] }];
const loading = (page: Page) => page.getByRole('status', { name: 'Loading analytics', exact: true });

async function syntheticChannels(page: Page) {
  await page.route('**/backend-api/integrations/list', route => route.fulfill({
    json: { integrations: channels.map((name, index) => ({
      id: 'fixture-loading-' + index, name, identifier: 'youtube',
      picture: '/icons/platforms/youtube.png', internalId: 'synthetic',
      type: 'social', disabled: false, canListMedia: false,
    })) },
  }));
}

test('Analytics keeps pending feedback and selected-range data through responsive navigation', async ({ page }, info) => {
  await syntheticChannels(page);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const requests = new Map<string, (data: unknown) => void>();
  await page.route('**/backend-api/analytics/fixture-loading-*', async route => {
    const url = new URL(route.request().url());
    const key = url.pathname + '?' + url.searchParams.get('date');
    const data = await new Promise(resolve => requests.set(key, resolve));
    await route.fulfill({ json: data });
  });
  const release = async (channel: number, date: number, data: unknown) => {
    const key = '/backend-api/analytics/fixture-loading-' + channel + '?' + date;
    await expect.poll(() => requests.has(key)).toBe(true);
    const resolve = requests.get(key)!;
    requests.delete(key);
    resolve(data);
  };

  for (const width of [375, 390, 430, 844, 1440]) {
    await page.setViewportSize({ width, height: width === 844 ? 390 : 900 });
    await openApp(page, '/analytics');
    await expect(loading(page)).toBeVisible();
    // The response is deliberately held; feedback must persist beyond first paint.
    await page.waitForTimeout(250);
    await expect(loading(page)).toBeVisible();
    await noHorizontalOverflow(page);
    if (width === 390) await capture(page, info, 'analytics-pending-390');

    const range = page.getByRole('combobox', { name: 'Date range', exact: true });
    await range.focus();
    await expect(range).toBeFocused();
    await expect(range).toHaveCSS('outline-style', 'solid');
    await range.selectOption('30');
    await release(0, 7, metrics('Old range'));
    await page.waitForTimeout(100);
    await expect(loading(page)).toBeVisible();
    await expect(page.getByText('Old range', { exact: true })).toHaveCount(0);
    await release(0, 30, metrics('Current range'));
    await expect(page.getByText('Current range', { exact: true })).toBeVisible();
    await expect(loading(page)).toHaveCount(0);
    await noHorizontalOverflow(page);
    if (width === 390) await capture(page, info, 'analytics-resolved-390');

    await range.selectOption('90');
    await expect(loading(page)).toBeVisible();
    await release(0, 90, []);
    await expect(page.getByRole('button', { name: 'Refresh Channel', exact: true })).toBeVisible();
    await expect(loading(page)).toHaveCount(0);
    // Returning to an already resolved range retains existing SWR cache behavior.
    await range.selectOption('30');
    await expect(page.getByText('Current range', { exact: true })).toBeVisible();

    if (width <= 1025) {
      const channel = page.getByRole('combobox', { name: 'Channels', exact: true });
      await channel.focus();
      await expect(channel).toBeFocused();
      await channel.selectOption('1');
    } else {
      await page.getByRole('button', { name: channels[1] }).click();
    }
    await expect(loading(page)).toBeVisible();
    await release(1, 30, metrics('Second channel range'));
    await expect(page.getByText('Second channel range', { exact: true })).toBeVisible();
    await noHorizontalOverflow(page);
    await page.waitForLoadState('networkidle');
    await page.goto('/media');
    await expect(page.getByText("You don't have any media yet")).toBeVisible();
    await page.waitForLoadState('networkidle');
  }
  expect(errors).toEqual([]);
});

test('Analytics cold document and warm client navigation timing is local synthetic evidence', async ({ page }, info) => {
  await syntheticChannels(page);
  await page.route('**/backend-api/analytics/fixture-loading-*', route => route.fulfill({ json: metrics('Fixture views') }));
  const start = performance.now();
  await openApp(page, '/analytics');
  await expect(page.getByText('Fixture views', { exact: true })).toBeVisible();
  const coldDocumentMs = performance.now() - start;
  const viewport = page.viewportSize()!;
  await page.goto('/media');
  await expect(page.getByText("You don't have any media yet")).toBeVisible();
  await page.waitForLoadState('networkidle');
  if (viewport.width <= 1025) await page.getByRole('button', { name: 'More', exact: true }).click();
  const link = page.locator('a[href="/analytics"]:visible').first();
  await expect(link).toBeVisible();
  const warmStart = performance.now();
  await link.click();
  await expect(page.getByText('Fixture views', { exact: true })).toBeVisible();
  const warmClientNavigationMs = performance.now() - warmStart;
  await info.attach('local-route-timing', {
    body: JSON.stringify({
      browser: info.project.name, viewport, coldDocumentMs, warmClientNavigationMs,
      method: 'One fresh Playwright context, initial document vs subsequent client navigation; optimized webpack build, immediate synthetic GET metrics, runner wall time includes automation overhead.',
      limits: 'No baseline speed comparison, production API/provider/media latency, actual mobile device or production speedup inference.',
    }, null, 2), contentType: 'application/json',
  });
});
