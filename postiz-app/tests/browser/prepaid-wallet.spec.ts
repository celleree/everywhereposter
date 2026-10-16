import { test, expect, openApp, capture, noHorizontalOverflow } from './fixtures';

test.skip(process.env.EP_WALLET_BROWSER !== '1', 'Requires isolated synthetic test-wallet fixture');
test('Prepaid wallet distinguishes pending and settled costs on mobile and desktop', async ({ page }, info) => {
  for (const width of [375, 844, 1440]) {
    await page.setViewportSize({ width, height: width === 844 ? 390 : 900 });
    await openApp(page, '/billing');
    const wallet = page.getByRole('region', { name: 'Prepaid AI balance' });
    await expect(wallet).toBeVisible();
    await expect(wallet.getByText('Pending reconciliation · Reserved maximum $0.005', { exact: true })).toBeVisible();
    await expect(wallet.getByText('Settled · Charged $0.000000001', { exact: true })).toBeVisible();
    await expect(wallet.getByText('$1.225', { exact: true })).toBeVisible();
    await expect(wallet.getByText('All amounts are USD. Pending holds are maximum reserved amounts, not final charges.')).toBeVisible();
    await noHorizontalOverflow(page);
    const refresh = wallet.getByRole('button', { name: 'Refresh balance', exact: true });
    await refresh.focus(); await expect(refresh).toBeFocused();
    await refresh.click(); await expect(refresh).toBeEnabled();
    if (width === 375) await capture(page, info, 'prepaid-wallet-375');
  }
});
test('Prepaid wallet provides loading, error and empty-history recovery using GET only', async ({ page }) => {
  let release!: () => void;
  await page.route('**/backend-api/billing/ai-wallet', async (route) => {
    await new Promise<void>((resolve) => { release = resolve; });
    await route.fulfill({ status: 503, json: { message: 'Synthetic unavailable wallet' } });
  });
  await openApp(page, '/billing');
  await expect(page.getByRole('status').filter({ hasText: 'Loading prepaid AI balance' })).toBeVisible();
  await expect.poll(() => Boolean(release)).toBe(true); release();
  await expect(page.getByRole('alert').filter({ hasText: 'Prepaid AI balance is unavailable.' })).toBeVisible();
  await page.unroute('**/backend-api/billing/ai-wallet');
  await page.route('**/backend-api/billing/ai-wallet', async (route) => {
    expect(route.request().method()).toBe('GET');
    await route.fulfill({ json: { organizationId: 'synthetic-org', currency: 'usd', status: 'ACTIVE',
      balanceNanos: '0', heldNanos: '0', availableNanos: '0', entries: [], operations: [] } });
  });
  await page.getByRole('button', { name: 'Retry balance' }).click();
  await expect(page.getByText('No AI operations yet.', { exact: true })).toBeVisible();
  await expect(page.getByText('No settled transactions yet.', { exact: true })).toBeVisible();
  await noHorizontalOverflow(page);
});
