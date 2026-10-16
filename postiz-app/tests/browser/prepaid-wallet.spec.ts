import { test, expect, openApp, capture, noHorizontalOverflow, browserOrigin } from './fixtures';

test.skip(process.env.EP_WALLET_BROWSER !== '1', 'Requires isolated synthetic test-wallet fixture');
test('Prepaid wallet distinguishes pending and settled costs on mobile and desktop', async ({ page }, info) => {
  for (const width of [375, 844, 1440]) {
    await page.setViewportSize({ width, height: width === 844 ? 390 : 900 });
    await openApp(page, '/billing');
    const wallet = page.getByRole('region', { name: 'Prepaid AI balance' });
    await expect(wallet).toBeVisible();
    await expect(wallet.getByText('Stripe test mode only. Balance changes only after the server verifies payment.')).toBeVisible();
    for (const amount of ['$5.00', '$10.00', '$25.00']) {
      await expect(wallet.getByRole('button', { name: `Add ${amount} test balance`, exact: true })).toBeVisible();
    }
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


test('Prepaid checkout retries one request key and refreshes return balance only from the server', async ({ page }) => {
  const checkoutRequests: { offerId: string; operationKey: string }[] = [];
  const externalRequests: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).origin === 'https://checkout.stripe.com') externalRequests.push(request.url());
  });
  await page.route('**/backend-api/billing/ai-wallet/topups', async (route) => {
    expect(route.request().method()).toBe('POST');
    checkoutRequests.push(route.request().postDataJSON());
    if (checkoutRequests.length === 1) {
      await route.fulfill({ status: 503, json: { message: 'Synthetic ambiguous checkout failure' } });
      return;
    }
    await route.fulfill({ json: { topupId: 'synthetic-topup', status: 'funded', url: null } });
  });
  await openApp(page, '/billing');
  const addFive = page.getByRole('button', { name: 'Add $5.00 test balance', exact: true });
  await addFive.click();
  await expect(page.getByRole('alert').filter({ hasText: 'Retry uses the same purchase request.' })).toBeVisible();
  await addFive.click();
  await expect(page.getByRole('status').filter({ hasText: 'Payment is already recorded.' })).toBeVisible();
  expect(checkoutRequests).toHaveLength(2);
  expect(checkoutRequests[0].offerId).toBe('usd_5');
  expect(checkoutRequests[1].operationKey).toBe(checkoutRequests[0].operationKey);
  expect(await page.evaluate(() => Object.keys(sessionStorage).filter((key) => key.startsWith('ai-wallet-topup:')))).toEqual([]);

  await page.evaluate(() => {
    sessionStorage.setItem('ai-wallet-topup:synthetic-org:usd_10', 'wallet_existing_return');
    sessionStorage.setItem('ai-wallet-topup-active:synthetic-org', 'usd_10');
  });
  let balanceReads = 0;
  await page.route('**/backend-api/billing/ai-wallet', async (route) => {
    expect(route.request().method()).toBe('GET'); balanceReads++;
    await route.fulfill({ json: { organizationId: 'synthetic-org', currency: 'usd', status: 'ACTIVE',
      balanceNanos: balanceReads > 1 ? '6230000000' : '1230000000', heldNanos: '5000000',
      availableNanos: balanceReads > 1 ? '6225000000' : '1225000000', entries: [], operations: [] } });
  });
  await openApp(page, '/billing?wallet=return');
  await expect(page.getByRole('status').filter({ hasText: 'Payment return received.' })).toBeVisible();
  await expect(page.getByText('$6.225', { exact: true })).toBeVisible();
  expect(balanceReads).toBeGreaterThan(1);
  expect(await page.evaluate(() => sessionStorage.getItem('ai-wallet-topup:synthetic-org:usd_10'))).toBe('wallet_existing_return');
  expect(externalRequests).toEqual([]);
  expect(new URL(page.url()).origin).toBe(browserOrigin);
});
