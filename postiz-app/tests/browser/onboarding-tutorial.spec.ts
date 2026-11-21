import { test, expect, openApp, capture, noHorizontalOverflow, reachable } from './fixtures';

const title = 'Learn How to Use EverywherePoster';
const billing = process.env.EP_TUTORIAL_BILLING_BROWSER === '1';

async function playTutorial(page: import('@playwright/test').Page) {
  const video = page.getByLabel(title, { exact: true });
  await expect(video).toBeVisible();
  await expect(video).toHaveAttribute('controls', '');
  await expect(video).toHaveAttribute('playsinline', '');
  await video.evaluate(async (element: HTMLVideoElement) => {
    element.muted = true;
    await element.play();
  });
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThan(0.2);
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.textTracks[0]?.cues?.length || 0)).toBeGreaterThan(0);
  expect(await video.evaluate((element: HTMLVideoElement) => ({
    width: element.videoWidth,
    captionLanguage: element.textTracks[0].language,
    captions: element.textTracks[0].mode,
    firstCue: (element.textTracks[0].cues?.[0] as VTTCue)?.text,
  }))).toMatchObject({ width: 1440, captionLanguage: 'en', captions: 'showing', firstCue: expect.stringContaining('EverywherePoster') });
  const bounds = await video.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual((await page.evaluate(() => innerWidth)) + 1);
  await noHorizontalOverflow(page);
  return video;
}

if (!billing) {
  test('Onboarding tutorial: captioned playback, Back and Finish on the actual frontend', async ({ page }, info) => {
    await openApp(page, '/launches?onboarding=true');
    await page.getByRole('button', { name: 'Continue without channels', exact: true }).click();
    await playTutorial(page);
    if (await page.evaluate(() => innerWidth <= 1025)) {
      const close = await page.getByRole('button', { name: 'Close', exact: true }).boundingBox();
      const step = await page.getByText('Watch Tutorial', { exact: true }).boundingBox();
      expect(close!.y + close!.height).toBeLessThanOrEqual(step!.y);
    }
    await capture(page, info, 'onboarding-tutorial-playing');
    const playing = await page.getByLabel(title, { exact: true }).elementHandle();
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    expect(await playing!.evaluate((element: HTMLVideoElement) => element.paused)).toBe(true);
    await expect(page.getByLabel(title, { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Continue without channels', exact: true }).click();
    await page.getByRole('button', { name: 'Get Started', exact: true }).click();
    await expect(page).toHaveURL(/\/launches$/);
    await expect(page.getByLabel(title, { exact: true })).toHaveCount(0);
  });
} else {
  test('Billing tutorial: reachable FREE-account entry plays and closes without a checkout', async ({ page }, info) => {
    let releaseCheckout!: () => void;
    const checkoutGate = new Promise<void>(resolve => { releaseCheckout = resolve; });
    // Hold checkout in this disposable browser. No payment API or Stripe network is used.
    await page.route('**/backend-api/billing/embedded', async route => {
      await checkoutGate;
      return route.fulfill({ status: 503, json: { message: 'Checkout outside tutorial fixture' } });
    });
    await page.route('https://js.stripe.com/**', route => route.fulfill({
      contentType: 'application/javascript',
      body: 'window.Stripe = function () { return { _registerWrapper: function () {}, registerAppInfo: function () {} }; };',
    }));
    try {
      await openApp(page, '/launches');
      await page.getByRole('button', { name: 'Watch Tutorial', exact: true }).click();
      await playTutorial(page);
      const dialog = page.getByRole('dialog', { name: title, exact: true });
      const bounds = await dialog.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(await page.evaluate(() => innerWidth));
      const close = dialog.getByRole('button', { name: 'Close dialog', exact: true });
      await reachable(close);
      await expect(close).toBeInViewport({ ratio: 1 });
      await capture(page, info, 'billing-tutorial-playing');
      await close.click();
      await expect(page.getByLabel(title, { exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Watch Tutorial', exact: true })).toBeVisible();
    } finally { releaseCheckout(); }
  });
}
