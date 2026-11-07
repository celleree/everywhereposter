import { Page } from '@playwright/test';
import {
  test,
  expect,
  capture,
  noHorizontalOverflow,
  openApp,
  browserOrigin,
} from './fixtures';

const providers = [
  ['facebook', 'Facebook Page'],
  ['instagram', 'Instagram (Facebook Business)'],
] as const;
const pages = [
  {
    id: 'synthetic-page-one',
    pageId: 'linked-one',
    name: 'Synthetic Page One',
    picture: { data: { url: '/icons/platforms/facebook.png' } },
  },
  {
    id: 'synthetic-page-two',
    pageId: 'linked-two',
    name: 'Synthetic Page Two',
    picture: { data: { url: '/icons/platforms/facebook.png' } },
  },
];
async function callback(
  page: Page,
  provider: string,
  returnRoute = '/create?draft=kept#channels'
) {
  await openApp(page, '/create');
  await page.evaluate(
    (route) => sessionStorage.setItem('integration-return-route', route),
    returnRoute
  );
  await page.goto(
    `/integrations/social/${provider}?code=consumed-code&state=consumed-state`,
    { waitUntil: 'domcontentloaded' }
  );
  await expect(
    page.getByRole('heading', { name: 'Configure Your Channel' })
  ).toBeVisible({ timeout: 60_000 });
  await page.addStyleTag({
    content: 'nextjs-portal { display: none !important; }',
  });
}
async function picker(page: Page) {
  if (page.viewportSize()!.width <= 1025) {
    await page.getByRole('button', { name: 'More', exact: true }).click();
    await page
      .getByRole('dialog', { name: 'More menu' })
      .getByRole('button', { name: 'Add Channel', exact: true })
      .click();
  } else {
    await page
      .getByRole('button', { name: 'Add Channel', exact: true })
      .last()
      .click();
  }
  return page.getByRole('dialog', { name: 'Add Channel', exact: true });
}
for (const [provider, name] of providers) {
  test(`Mobile channels: ${provider} empty callback exits and initiates a fresh connection`, async ({
    page,
  }, info) => {
    const callbacks: Record<string, string>[] = [];
    let starts = 0;
    await page.route('**/backend-api/integrations', (route) =>
      route.fulfill({
        json: {
          social: [
            {
              identifier: provider,
              name,
              connectionAvailable: true,
              isExternal: false,
              isWeb3: false,
            },
          ],
          article: [],
        },
      })
    );
    await page.route(
      `**/backend-api/integrations/social-connect/${provider}`,
      (route) => {
        const body = route.request().postDataJSON();
        callbacks.push(body);
        return route.fulfill({
          json: {
            id: 'synthetic-pending-channel',
            inBetweenSteps: true,
            pages: body.state === 'fresh-state' ? pages : [],
          },
        });
      }
    );
    await page.route(
      `**/backend-api/integrations/social/${provider}`,
      (route) => {
        starts++;
        // Only the provider redirect leaf is synthetic; this executes the real Add Channel dispatch.
        return route.fulfill({
          json: {
            url: `${browserOrigin}/integrations/social/${provider}?code=fresh-code&state=fresh-state`,
          },
        });
      }
    );
    await callback(page, provider);
    await expect(page.getByText(/No eligible/)).toBeVisible();
    const back = page.getByRole('button', { name: 'Back to app', exact: true });
    await expect(back).toBeInViewport({ ratio: 1 });
    await expect(
      page.getByRole('link', { name: 'How to switch Facebook accounts' })
    ).toHaveAttribute('href', 'https://www.facebook.com/help/804757836392387');
    await noHorizontalOverflow(page);
    await capture(page, info, `${provider}-empty-recovery`);
    await back.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL('/create?draft=kept#channels');
    await expect
      .poll(() =>
        page.evaluate(() => sessionStorage.getItem('integration-return-route'))
      )
      .toBeNull();
    await page.goBack();
    await expect(page).toHaveURL('/create');
    await page.goForward();
    await expect(page).toHaveURL('/create?draft=kept#channels');
    expect(callbacks).toHaveLength(1);
    const dialog = await picker(page);
    await dialog.getByRole('button', { name, exact: true }).click();
    await expect(
      page.getByText(
        provider === 'instagram' ? '@Synthetic Page One' : 'Synthetic Page One',
        { exact: true }
      )
    ).toBeVisible({ timeout: 60_000 });
    expect(starts).toBe(1);
    expect(callbacks.map((item) => item.state)).toEqual([
      'consumed-state',
      'fresh-state',
    ]);
    expect(callbacks.map((item) => item.code)).toEqual([
      'consumed-code',
      'fresh-code',
    ]);
  });

  test(`Mobile channels: ${provider} failed configuration can choose another page and retry`, async ({
    page,
  }, info) => {
    const saves: Record<string, string>[] = [];
    await page.route(
      `**/backend-api/integrations/social-connect/${provider}`,
      (route) =>
        route.fulfill({
          json: {
            id: 'synthetic-pending-channel',
            inBetweenSteps: true,
            pages,
          },
        })
    );
    await page.route(
      '**/backend-api/integrations/provider/synthetic-pending-channel/connect',
      (route) => {
        saves.push(route.request().postDataJSON());
        return route.fulfill({
          status: saves.length === 1 ? 400 : 200,
          json:
            saves.length === 1
              ? { message: 'Synthetic Page access unavailable' }
              : {},
        });
      }
    );
    await callback(page, provider);
    await page
      .getByText(
        provider === 'instagram' ? '@Synthetic Page One' : 'Synthetic Page One',
        { exact: true }
      )
      .click();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(
      page
        .getByRole('alert')
        .filter({ hasText: 'Synthetic Page access unavailable' })
    ).toHaveText('Synthetic Page access unavailable');
    await expect(
      page.getByRole('button', { name: 'Back to app' })
    ).toBeVisible();
    await noHorizontalOverflow(page);
    await capture(page, info, `${provider}-configuration-failure`);
    await page
      .getByText(
        provider === 'instagram' ? '@Synthetic Page Two' : 'Synthetic Page Two',
        { exact: true }
      )
      .click();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(() => new URL(page.url()).pathname).toBe('/launches');
    await expect
      .poll(() => new URL(page.url()).searchParams.get('added'))
      .toBe(provider);
    expect(saves).toHaveLength(2);
    expect(saves[1]).toMatchObject(
      provider === 'instagram'
        ? { id: 'synthetic-page-two', pageId: 'linked-two' }
        : { page: 'synthetic-page-two' }
    );
  });
}

test('Mobile channels: Meta recovery remains reachable on short landscape and narrow phone', async ({
  page,
}, info) => {
  await page.route(
    '**/backend-api/integrations/social-connect/instagram',
    (route) =>
      route.fulfill({
        json: {
          id: 'synthetic-pending-channel',
          inBetweenSteps: true,
          pages: [],
        },
      })
  );
  for (const viewport of [
    { width: 844, height: 390 },
    { width: 320, height: 568 },
  ]) {
    await page.setViewportSize(viewport);
    await callback(page, 'instagram');
    const back = page.getByRole('button', { name: 'Back to app' });
    await expect(back).toBeInViewport({ ratio: 1 });
    expect((await back.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await noHorizontalOverflow(page);
    await capture(
      page,
      info,
      `meta-recovery-${viewport.width}-${viewport.height}`
    );
    await back.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL('/create?draft=kept#channels');
  }
});
