const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { build } = require('esbuild');
const { chromium } = require('playwright');
const { gunzipSync } = require('node:zlib');

test('real SDK never sends private URLs through events or flag requests; recording stays off', async () => {
  const root = path.resolve(__dirname, '../..');
  const bundle = await build({
    stdin: {
      resolveDir: root,
      contents: `
        import posthog from 'posthog-js';
        import {initializePostHog, capturePageview} from './libraries/react-shared-libraries/src/helpers/posthog.analytics';
        initializePostHog('fixture-key', 'https://us.i.posthog.com', 'production');
        // Exercise transport in an automated browser; production retains bot filtering.
        posthog.set_config({opt_out_useragent_filter:true, request_batching:false});
        capturePageview('/auth/forgot/SENSITIVE_PATH');
        posthog.identify('fixture-user');
        posthog.reloadFeatureFlags();
        window.fixtureClient = posthog;
      `,
    },
    bundle: true, write: false, platform: 'browser', logLevel: 'error',
  });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.addInitScript(() => Object.defineProperty(navigator, 'webdriver', { get: () => false }));
    const requests = [];
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('https://app.example.test/**', route => route.fulfill({
      contentType: 'text/html', body: '<input type="password" value="SENSITIVE_INPUT">',
    }));
    await page.route(/https:\/\/.*posthog.com\/.*/, route => {
      const request = route.request();
      let body = request.postDataBuffer();
      if (body && request.url().includes('compression=gzip-js')) body = gunzipSync(body);
      requests.push({ url: request.url(), body: body?.toString() || '' });
      const script = request.url().includes('.js');
      return route.fulfill({ contentType: script ? 'application/javascript' : 'application/json',
        body: script ? '' : JSON.stringify({ sessionRecording: { endpoint: '/s/' } }) });
    });
    await page.goto('https://app.example.test/auth/forgot/SENSITIVE_PATH?code=SENSITIVE_QUERY#SENSITIVE_HASH');
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.waitForTimeout(500);
    assert.deepEqual(errors, []);
    assert.ok(requests.some(request => request.url.includes('/e/')), 'actual capture transport exercised');
    assert.ok(!requests.some(request => request.url.includes('/flags')), 'flag transport disabled');
    assert.doesNotMatch(JSON.stringify(requests), /SENSITIVE_PATH|SENSITIVE_QUERY|SENSITIVE_HASH|SENSITIVE_INPUT/);
    assert.equal(await page.evaluate(() => window.fixtureClient.sessionRecordingStarted()), false);
  } finally {
    await browser.close();
  }
});
