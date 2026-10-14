import { test, expect, openApp, capture, noHorizontalOverflow, reachable } from './fixtures';

test('Creator Audit: connected account selection and readable native controls', async ({ page }, info) => {
  let starts = 0;
  await page.route('**/backend-api/**', async route => {
    const path = new URL(route.request().url()).pathname.replace('/backend-api', '');
    if (path === '/creator-audit/connected') { starts++; return route.fulfill({ status: 405, json: {} }); }
    if (path === '/creator-audit/status') return route.fulfill({ json: { enabled: true } });
    if (path === '/creator-audit/api/audit/tasks/current') return route.fulfill({ json: null });
    if (path === '/integrations/list') return route.fulfill({ json: { integrations: [
      { id: 'fixture-instagram', identifier: 'instagram-standalone', name: '@fixture_creator' },
    ] } });
    if (path === '/creator-audit/audit') return route.fulfill({ contentType: 'text/html', body:
      '<!doctype html><html><body><h1>Saved Creator Audit fixture</h1></body></html>' });
    return route.fallback();
  });
  await openApp(page, '/creator-audit');
  const select = page.getByRole('combobox', { name: 'Instagram connection' });
  await expect(select).toBeVisible();
  await expect(page.getByText('Accounts must be connected to this workspace before they appear here.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start audit', exact: true })).toBeDisabled();
  await expect(page.frameLocator('iframe[title="Creator Audit"]').getByRole('heading')).toHaveText('Saved Creator Audit fixture');
  const root = page.locator('.dark, .light').first();
  for (const theme of ['dark', 'light']) {
    await root.evaluate((element, theme) => { element.classList.remove('dark', 'light'); element.classList.add(theme); }, theme);
    await expect(select).toHaveCSS('color-scheme', theme);
    await expect(select).toHaveCSS('appearance', 'auto');
    const colors = await select.evaluate(element => {
      const style = getComputedStyle(element);
      const rgb = (value: string) => value.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(v => {
        v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;
      });
      const luminance = (value: string) => rgb(value).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
      const a = luminance(style.color), b = luminance(style.backgroundColor);
      return { contrast: (Math.max(a, b) + .05) / (Math.min(a, b) + .05), background: style.backgroundColor };
    });
    expect(colors.background).not.toBe('rgba(0, 0, 0, 0)');
    expect(colors.contrast).toBeGreaterThanOrEqual(4.5);
    await select.selectOption('fixture-instagram');
    await expect(select).toHaveValue('fixture-instagram');
    await expect(page.getByRole('button', { name: 'Start audit', exact: true })).toBeEnabled();
    await noHorizontalOverflow(page);
    await capture(page, info, 'creator-audit-' + theme);
  }
  const connect = page.getByRole('link', { name: 'Connect another Instagram account', exact: true });
  await reachable(connect);
  await expect(connect).toHaveAttribute('href', '/launches');
  expect(starts).toBe(0); // Selecting a source and loading a report must not initiate provider work.
});
