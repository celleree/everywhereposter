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
// Compile the callback page before timing interactive recovery. This HTTP-only
// fixture GET runs no client effect and sends no OAuth code or state.
test.beforeAll(async ({ request }) => {
  const response = await request.get(
    `${browserOrigin}/integrations/social/facebook`,
    {
      headers: { cookie: 'auth=synthetic-playwright-session' },
      maxRedirects: 0,
      timeout: 85_000,
    }
  );
  expect(response.status()).toBe(200);
  await response.dispose();
});

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

for (const [scenario, callbackParams, expectedMessage, expectedPosts] of [
  [
    'declined access',
    'error=access_denied&error_reason=user_denied&error_description=The+user+denied+your+request',
    'Instagram access was declined.',
    0,
  ],
  [
    'missing permissions',
    'code=synthetic-code&state=synthetic-state',
    'Instagram did not grant all required permissions.',
    1,
  ],
] as const) {
  test(`Mobile channels: Instagram Standalone recovers from ${scenario}`, async ({
    page,
  }, info) => {
    const provider = 'instagram-standalone';
    let posts = 0;
    await page.route('**/backend-api/integrations', (route) =>
      route.fulfill({
        json: {
          social: [{
            identifier: provider,
            name: 'Instagram\n(Standalone)',
            connectionAvailable: true,
            isExternal: false,
            isWeb3: false,
          }],
          article: [],
        },
      })
    );
    await page.route(
      `**/backend-api/integrations/social/${provider}`,
      (route) => route.fulfill({
        json: {
          url: `${browserOrigin}/integrations/social/${provider}?${callbackParams}`,
        },
      })
    );
    await page.route(
      `**/backend-api/integrations/social-connect/${provider}`,
      (route) => {
        posts++;
        return route.fulfill({
          status: 409,
          json: {
            msg: 'Missing required permissions: instagram_business_manage_insights',
          },
        });
      }
    );

    const returnRoute = '/create?draft=kept#channels';
    await openApp(page, returnRoute);
    const dialog = await picker(page);
    await dialog.getByRole('button', { name: 'Instagram (Standalone)' }).click();
    const instructions = page.getByRole('dialog', {
      name: 'Before connecting Instagram Standalone',
    });
    await expect(instructions.getByText(/Insufficient Developer Role/)).toBeVisible();
    await noHorizontalOverflow(page);
    const continueButton = instructions.getByRole('button', { name: 'Continue to Instagram' });
    await expect(continueButton).toBeInViewport({ ratio: 1 });
    if (!expectedPosts) await capture(page, info, 'standalone-role-guidance');

    await page.clock.install();
    await continueButton.click();
    const error = page.getByRole('alert').filter({ hasText: expectedMessage });
    await expect(error).toBeVisible({ timeout: 60_000 });
    await page.clock.fastForward(3500);
    await expect(error).toBeVisible();
    expect(posts).toBe(expectedPosts);
    await capture(page, info, `standalone-${scenario.replace(' ', '-')}`);
    await page.getByRole('button', { name: 'Back to app' }).click();
    await expect(page).toHaveURL(returnRoute);
  });
}

for (const [provider, signedIn] of [
  ['facebook', true],
  ['instagram-standalone', false],
] as const) {
  test(`Mobile channels: ${provider} keeps existing ${signedIn ? 'signed-in' : 'guest'} callback recovery`, async ({
    page,
  }) => {
    if (!signedIn) await page.context().clearCookies();
    await page.clock.install();
    await page.goto(
      `/integrations/social/${provider}?error=access_denied&error_reason=user_denied&error_description=The+user+denied+your+request`,
      { waitUntil: 'domcontentloaded' }
    );
    const error = page.getByRole('alert').filter({ hasText: 'The user denied your request' });
    await expect(error).toBeVisible({ timeout: 60_000 });
    await page.clock.fastForward(3500);
    await expect(error).toBeVisible();
    await expect(page.getByText(signedIn
      ? 'How to switch Facebook accounts'
      : /ask the person who sent this connection link for a new link/
    )).toBeVisible();
    await expect(page.getByRole('button', { name: 'Back to app' })).toBeVisible();
  });
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
    await page.goBack({ waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL('/create');
    await page.goForward({ waitUntil: 'domcontentloaded' });
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
