const { chromium, expect } = require('../../postiz-app/node_modules/@playwright/test');
const { randomUUID } = require('node:crypto');
const { writeFileSync, mkdirSync } = require('node:fs');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const origin = 'http://localhost:4317';
const output = path.resolve(__dirname, '../../postiz-app/tmp/new-user-environment');
const report = { head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: __dirname, encoding: 'utf8' }).trim(),
  environment: 'isolated real frontend/backend/database; no providers/workers', steps: [], httpFailures: [], browserErrors: [] };
const email = 'new-user-' + randomUUID() + '@example.test';
const password = 'Local-qa-' + randomUUID() + '-9!';
async function waitReady(url) {
  for (let attempt = 0; attempt < 90; attempt++) {
    try { if ((await fetch(url, { signal: AbortSignal.timeout(3000), redirect: 'error' })).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  throw new Error('Owned local service did not become ready');
}
async function context(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
  await ctx.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort('blockedbyclient'));
  await ctx.routeWebSocket('**/*', socket => {
    const url = new URL(socket.url());
    if (url.protocol === 'ws:' && url.host === 'localhost:4317') socket.connectToServer();
    else socket.close();
  });
  ctx.setDefaultTimeout(60000);
  ctx.on('page', page => {
    page.on('pageerror', error => report.browserErrors.push({ kind: error.name, message: error.message.slice(0, 200).replace(/[A-Za-z0-9_-]{30,}/g, '[redacted]') }));
    page.on('response', response => {
      const url = new URL(response.url());
      if (url.origin === origin && response.status() >= 400) report.httpFailures.push({ path: url.pathname, status: response.status() });
    });
  });
  return ctx;
}
(async () => {
  mkdirSync(output, { recursive: true, mode: 0o700 });
  let browser;
  try {
    await waitReady('http://localhost:4318/auth/can-register');
    await waitReady(origin + '/auth');
    browser = await chromium.launch({ headless: true });
    const first = await context(browser);
    const signup = await first.newPage();
    await signup.goto(origin + '/auth', { waitUntil: 'domcontentloaded', timeout: 120000 });
    await signup.locator('input[name="email"]').fill(email);
    await signup.locator('input[name="password"]').fill(password);
    await signup.locator('input[name="company"]').fill('Disposable local onboarding');
    const registered = signup.waitForResponse(response => new URL(response.url()).pathname === '/backend-api/auth/register' && response.request().method() === 'POST');
    await signup.getByRole('button', { name: 'Create Account', exact: true }).click();
    if ((await registered).status() !== 200) throw new Error('Real registration failed');
    report.steps.push('real registration: HTTP 200; no activation provider configured');
    await first.close();
    const returning = await context(browser);
    const page = await returning.newPage();
    await page.goto(origin + '/auth/login', { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.locator('input[name="email"]').fill(email);
    await page.locator('input[name="password"]').fill(password);
    const loggedIn = page.waitForResponse(response => new URL(response.url()).pathname === '/backend-api/auth/login' && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    if ((await loggedIn).status() !== 200) throw new Error('Real clean-context login failed');
    await page.waitForURL(url => !url.pathname.startsWith('/auth'), { timeout: 120000 });
    report.steps.push('fresh browser context: real login and authenticated navigation');
    const integrations = await returning.request.get(origin + '/backend-api/integrations', { maxRedirects: 0 });
    expect(integrations.status()).toBe(200);
    expect(await integrations.json()).toEqual([]);
    report.steps.push('new organization has zero connected integrations');
    await page.goto(origin + '/media', { waitUntil: 'domcontentloaded', timeout: 120000 });
    await expect(page.locator('.mobile-app-shell')).toBeVisible({ timeout: 60000 });
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 120000 });
    await expect(page.locator('.mobile-app-shell')).toBeVisible({ timeout: 60000 });
    const media = await returning.request.get(origin + '/backend-api/media?page=0', { maxRedirects: 0 });
    expect(media.status()).toBe(200);
    const mediaResult = await media.json();
    expect(mediaResult.results).toEqual([]);
    report.steps.push('empty real Media API, authenticated app survives reload');
    await page.screenshot({ path: path.join(output, 'empty-media.png'), fullPage: true, animations: 'disabled' });
    await returning.close();
    if (report.httpFailures.length || report.browserErrors.length) throw new Error('Onboarding completed with browser/API errors; inspect redacted result');
    report.status = 'PASS_LOCAL_REAL_AUTH';
  } catch (error) {
    report.status = 'FAIL_OR_BLOCKED';
    report.failure = error.message.slice(0, 250).replace(/[A-Za-z0-9_-]{30,}/g, '[redacted]');
    process.exitCode = 1;
  } finally {
    await browser?.close();
    writeFileSync(path.join(output, 'result.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
    console.log(JSON.stringify(report));
  }
})();
