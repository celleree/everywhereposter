import { test, expect, capture, noHorizontalOverflow, mobileProject, openApp, reachable } from './fixtures';

test('Fixture safety: rejects mutations and unauthenticated identity', async ({ playwright, context }) => {
  const anonymous = await playwright.request.newContext();
  try {
    expect((await anonymous.get('http://127.0.0.1:4218/user/self')).status()).toBe(401);
    expect((await anonymous.post('http://127.0.0.1:4218/posts', { data: { content: 'Must never be published' } })).status()).toBe(405);
    expect((await context.request.get('http://127.0.0.1:4218/user/self')).status()).toBe(200);
  } finally { await anonymous.dispose(); }
});

test('Scheduled: rendered layout, loading/error/retry and last-row reachability', async ({ page }, info) => {
  const isMobile = mobileProject(info);
  let retry = false;
  let releaseError!: () => void;
  const loadingGate = new Promise<void>(resolve => { releaseError = resolve; });
  if (isMobile) await page.route('**/backend-api/posts/list?**', async route => {
    if (!retry) {
      await loadingGate;
      return route.fulfill({ status: 503, contentType: 'application/json', body: '{}' });
    }
    return route.continue();
  });
  await openApp(page, isMobile ? '/launches' : '/launches?display=list');
  await expect(page.getByRole('heading', { name: 'Channels', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add channel', exact: true })).toHaveCount(0);
  if (isMobile) {
    await expect(page.getByRole('navigation', { name: 'Mobile navigation' })).toBeVisible();
    try {
      await expect(page.getByRole('status').filter({ hasText: 'Loading' })).toBeVisible();
      await expect(page.getByRole('status').filter({ hasText: 'Loading' })).toBeInViewport({ ratio: 1 });
      await capture(page, info, 'scheduled-loading');
    } finally { releaseError(); }
    await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeInViewport({ ratio: 1 });
    await capture(page, info, 'scheduled-error');
    retry = true;
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
  } else {
    await expect(page.locator('#left-menu')).toBeVisible();
  }
  const last = page.getByText(/Synthetic scheduled post 18:/).first();
  await expect(last).toBeVisible();
  await reachable(last);
  await capture(page, info, 'scheduled-loaded');
  await noHorizontalOverflow(page);
});

test('More: scrollable dialog, repeated clicks, Escape and real browser Back', async ({ page }, info) => {
  await openApp(page, '/media');
  await expect(page.getByText("You don't have any media yet")).toBeVisible();
  if (!mobileProject(info)) {
    await expect(page.locator('#left-menu')).toBeVisible();
    await capture(page, info, 'desktop-media');
    await noHorizontalOverflow(page);
    return;
  }
  const nav = page.getByRole('navigation', { name: 'Mobile navigation' });
  await expect(nav).toBeVisible();
  const targets = await nav.locator('a, button').evaluateAll(elements => elements.map(element => {
    const rect = element.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  }));
  expect(targets.length).toBeGreaterThan(0);
  for (const target of targets) { expect(target.width).toBeGreaterThanOrEqual(44); expect(target.height).toBeGreaterThanOrEqual(44); }
  const more = page.getByRole('button', { name: 'More', exact: true });
  await expect(more).toBeVisible();
  await more.dblclick();
  const dialog = page.getByRole('dialog', { name: 'More menu' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveCount(1);
  await capture(page, info, 'more-open');
  await page.getByRole('button', { name: 'Close More' }).click();
  await expect(dialog).not.toBeVisible();
  await more.click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(more).toBeFocused();
  await more.click();
  await expect(dialog).toBeVisible();
  const link = page.getByRole('link', { name: 'Settings', exact: true });
  await reachable(link);
  await link.click();
  await expect(page).toHaveURL(/\/settings$/);
  await page.goBack({ waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(/\/media$/);
  await expect(more).toBeVisible();
  await capture(page, info, 'media-after-back');
  await noHorizontalOverflow(page);
});

test('Create: interrupted text survives reload and Back; Cancel closes a real dialog', async ({ page }, info) => {
  await openApp(page, '/create');
  const progress = page.getByRole('navigation', { name: 'Post creation progress' });
  await expect(progress).toBeVisible();
  const isMobile = mobileProject(info);
  const toggle = page.getByRole('button', { name: 'Write a text post', exact: true });
  const input = isMobile ? page.getByRole('textbox', { name: 'Post text', exact: true }) : page.locator('[contenteditable="true"]').first();
  if (isMobile) { await expect(toggle).toBeVisible(); await toggle.click(); }
  const value = 'Synthetic interrupted draft; no publishing requested.';
  await input.fill(value);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(progress).toBeVisible();
  if (isMobile && !(await input.isVisible())) await toggle.click();
  if (isMobile) await expect(input).toHaveValue(value); else await expect(input).toHaveText(value);
  const next = page.getByRole('button', { name: 'Continue to Destinations', exact: true });
  await reachable(next);
  await next.click();
  const back = page.getByRole('button', { name: 'Back', exact: true });
  await expect(back).toBeEnabled();
  await back.click();
  if (isMobile) await expect(input).toHaveValue(value); else await expect(input).toHaveText(value);
  await capture(page, info, 'create-restored');
  await reachable(next);
  await capture(page, info, 'create-footer-reachable');
  await noHorizontalOverflow(page);
  await openApp(page, '/media?precondition=fixture');
  const cancel = page.getByRole('button', { name: 'Cancel', exact: true });
  await expect(cancel).toBeVisible();
  await reachable(cancel);
  await cancel.click();
  await expect(cancel).not.toBeVisible();
  await expect(page).toHaveURL(/\/media\?precondition=fixture$/);
  await capture(page, info, 'dialog-cancelled');
});

test('Breakpoint: 1025 mobile, 1026 desktop without losing navigation', async ({ page }, info) => {
  await page.setViewportSize({ width: 1025, height: 800 });
  await openApp(page, '/media');
  await expect(page.getByRole('navigation', { name: 'Mobile navigation' })).toBeVisible();
  await capture(page, info, 'breakpoint-1025');
  await noHorizontalOverflow(page);
  await page.setViewportSize({ width: 1026, height: 800 });
  await expect(page.getByRole('navigation', { name: 'Mobile navigation' })).not.toBeVisible();
  await expect(page.locator('#left-menu')).toBeVisible();
  await capture(page, info, 'breakpoint-1026');
  await noHorizontalOverflow(page);
});
