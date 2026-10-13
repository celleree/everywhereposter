import { test, expect, openApp, capture, noHorizontalOverflow, reachable, browserOrigin } from './fixtures';
import type { Page, TestInfo } from '@playwright/test';

test.skip(process.env.EP_DISCOVERY_BROWSER !== '1', 'Requires the isolated real-controller Discovery runtime');
const region = (page: Page) => page.getByRole('region', { name: 'Business Discovery', exact: true });
const input = (page: Page) => page.getByRole('textbox', { name: 'Public account username', exact: true });
const evidence = async (page: Page) => (await page.request.get(`${browserOrigin}/backend-api/__discovery/evidence`)).json();
async function search(page: Page, username: string) {
  await input(page).fill(username);
  await page.getByRole('button', { name: 'Search public account', exact: true }).click();
}
async function switchAccount(page: Page, info: TestInfo, index: number) {
  if ((page.viewportSize()?.width || 1440) <= 1025) await page.getByRole('combobox', { name: 'Channels', exact: true }).selectOption(String(index));
  else await page.getByRole('button', { name: index ? 'Discovery actor two' : 'Discovery actor one', exact: true }).click();
}
test.beforeEach(async ({ page }) => {
  expect((await page.request.post(`${browserOrigin}/backend-api/__discovery/reset`)).ok()).toBe(true);
});

test('Discovery remains usable during owner-insights failure and displays public null/zero data', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const ownerFailure = page.waitForResponse(response => /\/analytics\/discovery-0\?/.test(response.url()) && response.status() === 502);
  await openApp(page, '/analytics');
  await ownerFailure;
  await expect(region(page)).toBeVisible();
  await input(page).fill('@publictarget');
  await page.waitForTimeout(250);
  expect((await evidence(page)).calls).toEqual([]);
  await input(page).focus();
  await expect(input(page)).toBeFocused();
  await input(page).press('Enter');
  await expect(region(page).getByText('publictarget public caption', { exact: true })).toBeVisible();
  await expect(region(page).getByText('Followers: 0 · Media: 2', { exact: true })).toBeVisible();
  await expect(region(page).getByText('Likes: 0 · Comments: Unavailable', { exact: true })).toBeVisible();
  await expect(region(page).getByText('Preview unavailable', { exact: true })).toBeVisible();
  await expect(region(page).getByText('<script>Public biography is text</script>', { exact: true })).toBeVisible();
  await expect(region(page).getByText(/Acting account: @actorone · Target account: @publictarget/)).toBeVisible();
  await noHorizontalOverflow(page);
  await capture(page, info, 'discovery-public-results');
  const more = page.getByRole('button', { name: 'Load more public media', exact: true });
  await reachable(more); await more.click();
  await expect(region(page).getByText('Second page public caption', { exact: true })).toBeVisible();
  await expect(more).toHaveCount(0);
  expect((await evidence(page)).calls.filter((call: any) => call.fields.includes('business_discovery'))).toHaveLength(2);
  expect(errors).toEqual([]);
});

test('Discovery shows empty, invalid, unavailable, permission, expiry, rate and upstream states', async ({ page }, info) => {
  await openApp(page, '/analytics');
  await search(page, 'emptytarget');
  await expect(region(page).getByText('This account has no public media available.', { exact: true })).toBeVisible();
  await search(page, 'invalid){insights}');
  await expect(region(page).getByRole('alert')).toContainText('valid Instagram username');
  for (const [target, message] of [['unknownuser', 'No eligible public professional account'], ['missingpermissions', 'Meta denied permission'], ['expiredtarget', 'Reconnect this Instagram channel'], ['ratelimited', 'Search rate limit reached'], ['upstreamfail', 'Meta could not complete this search']]) {
    await search(page, target);
    await expect(region(page).getByRole('alert')).toContainText(message);
    await expect(region(page).getByRole('list')).toHaveCount(0);
  }
  await page.setViewportSize({ width: 320, height: 740 });
  await noHorizontalOverflow(page);
  await capture(page, info, 'discovery-errors-narrow');
});

test('Discovery isolates late responses across account switches and starts fresh after reload', async ({ page }, info) => {
  await openApp(page, '/analytics');
  await search(page, 'slowtarget');
  await expect(region(page).getByRole('status')).toContainText('Loading public');
  await expect(page.getByRole('button', { name: 'Search public account', exact: true })).toBeDisabled();
  await switchAccount(page, info, 1);
  await expect(input(page)).toHaveValue('');
  await search(page, 'secondtarget');
  await expect(region(page).getByText('secondtarget public caption', { exact: true })).toBeVisible();
  await page.waitForTimeout(2000);
  await expect(region(page).getByText('slowtarget public caption', { exact: true })).toHaveCount(0);
  await expect(region(page).getByText(/Acting account: @actortwo · Target account: @secondtarget/)).toBeVisible();
  await page.reload();
  await expect(input(page)).toHaveValue('');
  await expect(region(page).getByRole('list')).toHaveCount(0);
  await noHorizontalOverflow(page);
});

test('Discovery HTTP endpoint rejects unauthenticated/cross-tenant/input abuse and enforces its throttle', async ({ page }) => {
  const endpoint = `${browserOrigin}/backend-api/analytics/discovery-0/business-discovery`;
  const anonymous = await page.request.get(endpoint + '?username=publictarget', { headers: { auth: 'wrong-session' } });
  expect(anonymous.status()).toBe(401);
  expect((await page.request.get(endpoint + '?username=publictarget', { headers: { showorg: 'other-org' } })).status()).toBe(404);
  expect((await page.request.get(endpoint + '?username=publictarget&fields=access_token')).status()).toBe(400);
  expect((await evidence(page)).calls).toHaveLength(0);
  await page.request.post(`${browserOrigin}/backend-api/__discovery/reset`);
  for (let i = 0; i < 10; i++) expect((await page.request.get(endpoint + '?username=invalid)')).status()).toBe(400);
  const blocked = await page.request.get(endpoint + '?username=publictarget');
  expect(blocked.status()).toBe(429);
  expect((await evidence(page)).calls).toHaveLength(0);
});
