import { test, expect, openApp, capture, noHorizontalOverflow, reachable } from './fixtures';

// Match native control painting to the existing theme; WebKit can otherwise
// paint a light control behind white selected text despite a dark CSS background.
async function nativeSelectThemes(page: any, info: any, name: string) {
  const themeRoot = page.locator('.dark, .light').first();
  const original = await themeRoot.evaluate((element: Element) => element.classList.contains('dark') ? 'dark' : 'light');
  try {
    for (const theme of ['dark', 'light']) {
      await themeRoot.evaluate((element: Element, selected: string) => {
        element.classList.remove('dark', 'light');
        element.classList.add(selected);
      }, theme);
      const selects = page.locator(':is(.settings-navigation, .settings-panel, .analytics-navigation, .analytics-panel) select:visible');
      expect(await selects.count()).toBeGreaterThan(0);
      for (const select of await selects.all()) {
        await expect(select).toHaveCSS('color-scheme', theme);
        await expect(select).toHaveCSS('appearance', 'auto');
        expect(await select.evaluate((element: HTMLSelectElement) => element.selectedOptions[0]?.textContent?.trim())).toBeTruthy();
      }
      await noHorizontalOverflow(page);
      await capture(page, info, `${name}-${theme}`);
    }
  } finally {
    await themeRoot.evaluate((element: Element, selected: string) => {
      element.classList.remove('dark', 'light');
      element.classList.add(selected);
    }, original);
  }
}

async function settingsFixture(page: any) {
  const values: Record<string, unknown> = {
    '/user/personal': { name: 'Synthetic creator', bio: '', picture: null },
    '/user/email-notifications': { sendSuccessEmails: true, sendFailureEmails: true, sendStreakEmails: true },
    '/user/approved-apps': [], '/settings/team': { users: [] }, '/webhooks': [], '/autopost': [],
    '/settings/knowledge-base': { documents: [], voiceProfile: null },
  };
  await page.route('**/backend-api/**', async (route: any) => {
    const pathname = new URL(route.request().url()).pathname.replace('/backend-api', '');
    if (route.request().method() !== 'GET') return route.fulfill({ status: 405, json: {} });
    if (pathname === '/user/self') {
      const response = await route.fetch();
      return route.fulfill({ json: { ...await response.json(), tier: 'TEAM', publicApi: 'synthetic-api-key-not-a-credential' } });
    }
    if (Object.hasOwn(values, pathname)) return route.fulfill({ json: values[pathname] });
    return route.fallback();
  });
}

test('Settings: selected navigation retains colors on hover and keyboard focus', async ({ page, isMobile }, info) => {
  test.skip(isMobile, 'Desktop navigation uses buttons; mobile uses a select.');
  await settingsFixture(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page, '/settings');
  const themeRoot = page.locator('.dark, .light').first();
  const original = await themeRoot.evaluate(element => element.classList.contains('dark') ? 'dark' : 'light');
  const navigation = page.getByRole('navigation', { name: 'Settings', exact: true });
  const global = navigation.getByRole('button', { name: 'Global Settings', exact: true });
  const next = navigation.getByRole('button').nth(1);
  const themes = [
    { name: 'dark', selected: 'rgb(244, 244, 245)', text: 'rgb(24, 24, 27)', hover: 'rgb(24, 24, 27)' },
    { name: 'light', selected: 'rgb(228, 228, 231)', text: 'rgb(9, 9, 11)', hover: 'rgb(244, 244, 245)' },
  ];
  try {
    for (const theme of themes) {
      await themeRoot.evaluate((element, selected) => {
        element.classList.remove('dark', 'light');
        element.classList.add(selected);
      }, theme.name);
      await global.click();
      await page.mouse.move(1000, 100);
      await expect(global).toHaveAttribute('aria-pressed', 'true');
      await expect(global).toHaveCSS('background-color', theme.selected);
      await expect(global).toHaveCSS('color', theme.text);
      await next.hover();
      await expect(next).toHaveCSS('background-color', theme.hover);
      await global.hover();
      await capture(page, info, `settings-selected-hover-${theme.name}`);
      await expect(global).toHaveCSS('background-color', theme.selected);
      await expect(global).toHaveCSS('color', theme.text);
      await global.focus();
      await page.keyboard.press('Tab');
      await expect(next).toBeFocused();
      await expect(next).toHaveCSS('outline-style', 'solid');
      await expect(next).toHaveCSS('outline-width', '2px');
      await page.keyboard.press('Enter');
      await expect(next).toHaveAttribute('aria-pressed', 'true');
      await expect(global).toHaveAttribute('aria-pressed', 'false');
      await expect(next).toBeFocused();
      await expect(next).toHaveCSS('background-color', theme.selected);
      await expect(next).toHaveCSS('color', theme.text);
      await next.hover();
      await expect(next).toHaveCSS('background-color', theme.selected);
      await expect(next).toHaveCSS('color', theme.text);
      await noHorizontalOverflow(page);
      await capture(page, info, `settings-keyboard-selected-${theme.name}`);
    }
  } finally {
    await themeRoot.evaluate((element, selected) => {
      element.classList.remove('dark', 'light');
      element.classList.add(selected);
    }, original);
  }
});


test('Settings: remaining sections, keyboard, menu removals and repeated navigation', async ({ page }, info) => {
  await settingsFixture(page);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  for (const width of [375, 390, 430, 844, 1440]) {
    await page.setViewportSize({ width, height: width === 844 ? 390 : 900 });
    await openApp(page, '/settings');
    const sections = ['Global Settings', 'Teams', 'Webhooks', 'Auto Post', 'Knowledge Base', 'Developers', 'Approved Apps'];
    if (width <= 1025) {
      const control = page.getByRole('combobox', { name: 'Settings', exact: true });
      await expect(control.locator('option')).toHaveText(sections);
      await page.keyboard.press('Tab');
      await control.focus();
      await expect(control).toBeFocused();
      await expect(control).toHaveCSS('outline-style', 'solid');
      await control.press('ArrowDown');
      await control.press('Enter');
      for (const section of sections) {
        await control.selectOption({ label: section });
        await expect(page.locator('#settings-panel')).toContainText(section === 'Teams' ? 'Team' : section === 'Developers' ? 'API' : section === 'Auto Post' ? 'Autopost' : section);
        if (section === 'Developers') {
          for (const name of ['Reveal', 'Copy', 'Rotate Key', 'Open Wizard']) {
            const action = page.getByRole('button', { name, exact: true }).first();
            await reachable(action);
            const box = await action.boundingBox();
            expect(box!.x).toBeGreaterThanOrEqual(0);
            expect(box!.x + box!.width).toBeLessThanOrEqual(width);
          }
          await capture(page, info, `developers-${width}`);
        }
        await noHorizontalOverflow(page);
      }
      await control.selectOption('global_settings');
      if (width === 375 && info.project.name.includes('chromium')) {
        await page.evaluate(() => window.scrollTo(0, 0));
        const session = await page.context().newCDPSession(page);
        await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 180, y: 650 }] });
        for (const y of [600, 550, 500, 450, 400]) {
          await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 180, y }] });
        }
        await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await session.detach();
        await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
      }
      await reachable(page.getByText('Shortlink Settings', { exact: true }));
      await page.getByRole('button', { name: 'More', exact: true }).click();
      const more = page.getByRole('navigation', { name: 'More navigation' });
      await expect(more.locator('a[href="/plugs"], a[href="/third-party"]')).toHaveCount(0);
      await expect(page.getByRole('button', { name: /Add.*Channel/i }).first()).toBeVisible();
      await page.getByRole('button', { name: 'Close More' }).click();
    } else {
      const navigation = page.getByRole('navigation', { name: 'Settings', exact: true });
      await expect(navigation.getByRole('button')).toHaveText(sections);
      await navigation.getByRole('button', { name: 'Approved Apps', exact: true }).focus();
      await expect(navigation.getByRole('button', { name: 'Approved Apps', exact: true })).toHaveCSS('outline-style', 'solid');
      await page.keyboard.press('Enter');
      await expect(page.locator('#settings-panel')).toContainText('Approved Apps');
      await navigation.getByRole('button', { name: 'Global Settings', exact: true }).click();
    }
    await expect(page.getByRole('button', { name: 'Sets', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Signatures', exact: true })).toHaveCount(0);
    await nativeSelectThemes(page, info, `settings-${width}`);
    await capture(page, info, `settings-${width}`);
    // Finish this document's prefetches before leaving; WebKit reports cancelled
    // same-origin RSC requests as page errors if a full navigation interrupts them.
    await page.waitForLoadState('networkidle');
    await page.goto('/media');
    await expect(page.getByText("You don't have any media yet")).toBeVisible();
    await page.waitForLoadState('networkidle');
    await page.goBack();
    await expect(page.locator('.settings-navigation')).toBeVisible();
    await noHorizontalOverflow(page);
    await page.waitForLoadState('networkidle');
  }
  expect(errors).toEqual([]);
});

test('Analytics: channel selection and range controls fit phone, landscape and desktop', async ({ page }, info) => {
  const channels = ['A very long synthetic channel name for responsive checks', 'Second synthetic channel'];
  await page.route('**/backend-api/integrations/list', route => route.fulfill({ json: { integrations: channels.map((name, i) => ({ id: 'fixture-channel-'+i, name, identifier: 'youtube', picture: '/icons/platforms/youtube.png', internalId: 'synthetic', type: 'social', disabled: false, canListMedia: false })) } }));
  await page.route('**/backend-api/analytics/fixture-channel-*', route => route.fulfill({ json: [{ label: 'Views', data: [{ total: 123, date: '2035-01-01' }, { total: 456, date: '2035-01-02' }] }] }));
  for (const width of [375, 390, 430, 844, 1440]) {
    await page.setViewportSize({ width, height: width === 844 ? 390 : 900 });
    await openApp(page, '/analytics');
    await expect(page.getByText('Views', { exact: true })).toBeVisible();
    if (width <= 1025) {
      const channel = page.getByRole('combobox', { name: 'Channels', exact: true });
      await channel.selectOption('1');
      await expect(channel).toHaveValue('1');
      await page.keyboard.press('Tab');
      await channel.focus();
      await expect(channel).toBeFocused();
      await expect(channel).toHaveCSS('outline-style', 'solid');
    } else {
      await page.getByRole('button', { name: channels[1] }).click();
    }
    await page.getByRole('combobox', { name: 'Date range', exact: true }).selectOption('totals');
    await page.keyboard.press('Tab');
    await page.getByRole('combobox', { name: 'Date range', exact: true }).focus();
    await expect(page.getByRole('combobox', { name: 'Date range', exact: true })).toHaveCSS('outline-style', 'solid');
    await expect(page.getByText('579', { exact: true })).toBeVisible();
    await noHorizontalOverflow(page);
    await nativeSelectThemes(page, info, `analytics-${width}`);
    await capture(page, info, `analytics-${width}`);
  }
});
