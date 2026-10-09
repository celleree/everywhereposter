import { test as base, expect, Page, TestInfo, Locator } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const sourceHash = createHash('sha256').update(['playwright.config.ts', 'tests/browser/runtime.cjs', 'tests/browser/network-guard.cjs', 'tests/browser/fonts.cjs', 'tests/browser/fixtures.ts', 'tests/browser/ui.spec.ts', 'tests/browser/picker-regressions.spec.ts', 'tests/browser/assets/synthetic-picker.mp4', 'apps/frontend/src/components/launches/launches.component.tsx', 'apps/frontend/src/components/layout/new-modal.tsx', 'apps/frontend/src/components/media/media.component.tsx', 'apps/frontend/src/components/new-launch/manage.modal.tsx', 'apps/frontend/src/app/mobile-ui.scss', 'libraries/react-shared-libraries/src/helpers/video.or.image.tsx'].map(file => file + '\n' + createHash('sha256').update(readFileSync(path.resolve(file))).digest('hex')).join('\n')).digest('hex');

export const test = base.extend<{ authenticated: void; diagnostics: void }>({
  authenticated: [async ({ context }, use) => {
    await context.addCookies([{ name: 'auth', value: 'synthetic-playwright-session', url: 'http://127.0.0.1:4217' }]);
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== 'http://127.0.0.1:4217') return route.abort('blockedbyclient');
      if (url.pathname.startsWith('/backend-api/') && route.request().method() !== 'GET') {
        return route.fulfill({ status: 405, contentType: 'application/json', body: '{"message":"Fixture mutations disabled"}' });
      }
      await route.continue();
    });
    await use();
  }, { auto: true }],
  diagnostics: [async ({ page }, use, info) => {
    const events: object[] = [];
    page.on('pageerror', error => events.push({ type: 'pageerror', message: error.message }));
    page.on('console', message => { if (message.type() === 'error') events.push({ type: 'console', message: message.text() }); });
    page.on('requestfailed', request => events.push({ type: 'requestfailed', url: request.url(), error: request.failure()?.errorText }));
    page.on('response', response => { if (response.status() >= 400) events.push({ type: 'http', url: response.url(), status: response.status() }); });
    await use();
    await info.attach('browser-diagnostics', { body: JSON.stringify(events, null, 2), contentType: 'application/json' });
  }, { auto: true }],
});
export { expect };

export function mobileProject(info: TestInfo) { return (info.project.use.viewport?.width || 1440) <= 1025; }

export async function openApp(page: Page, url: string) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  // Cold development hydration is bootstrap; product assertions keep the 15s budget.
  await expect(page.locator('.mobile-app-shell')).toBeVisible({ timeout: 60_000 });
  // Development instrumentation is outside the product UI; prevent it covering controls.
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
}

export async function reachable(locator: Locator) {
  await locator.scrollIntoViewIfNeeded();
  // Fixed navigation can cover a geometrically visible control; try a real scroll alignment.
  await locator.evaluate(element => element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }));
  await expect(locator).toBeInViewport({ ratio: 0.5 });
  await expect.poll(async () => locator.evaluate(element => {
    const doc = element.ownerDocument;
    const rect = element.getBoundingClientRect();
    const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
    const hit = doc.elementFromPoint(x, y);
    const frame = doc.defaultView?.frameElement;
    const outer = frame?.getBoundingClientRect();
    const outerHit = outer && frame?.ownerDocument.elementFromPoint(outer.left + x, outer.top + y);
    const probe = {
      unoccluded: Boolean(hit && (element === hit || element.contains(hit)) && (!frame || outerHit === frame)),
      target: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      documentScroll: { top: doc.scrollingElement?.scrollTop, max: (doc.scrollingElement?.scrollHeight || 0) - (doc.scrollingElement?.clientHeight || 0) },
      ancestorScroll: (() => { const items = []; let parent = element.parentElement; while (parent) { if (parent.scrollHeight > parent.clientHeight) items.push({ tag: parent.tagName, top: parent.scrollTop, max: parent.scrollHeight - parent.clientHeight }); parent = parent.parentElement; } return items; })(),
      hit: hit && { tag: hit.tagName, label: hit.getAttribute('aria-label'), text: hit.textContent?.slice(0, 80), className: hit.getAttribute('class') },
    };
    return probe.unoccluded ? 'visible and unobscured' : JSON.stringify(probe);
  }), { message: 'Control center must be visible and unobscured after centered scrolling and layout settling', timeout: 5000 }).toBe('visible and unobscured');
}

export async function capture(page: Page, info: TestInfo, name: string) {
  await page.evaluate(async () => { await document.fonts.ready; });
  const measurements = await page.evaluate(() => ({
    viewport: { width: innerWidth, height: innerHeight },
    document: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
    dialogs: [...document.querySelectorAll('[role="dialog"]')].map(dialog => {
      const rect = dialog.getBoundingClientRect();
      const grid = dialog.querySelector('.upload-picker-grid');
      return { label: dialog.getAttribute('aria-label'), x: rect.x, y: rect.y, width: rect.width, height: rect.height,
        grid: grid && { columns: getComputedStyle(grid).gridTemplateColumns, height: grid.clientHeight, scrollHeight: grid.scrollHeight },
        controls: [...dialog.querySelectorAll('button')].filter(button => button.getBoundingClientRect().width > 0).map(button => {
          const r = button.getBoundingClientRect();
          return { label: button.getAttribute('aria-label') || button.textContent?.trim(), x: r.x, y: r.y, width: r.width, height: r.height };
        }) };
    }),
    touchTargets: [...document.querySelectorAll('nav[aria-label="Mobile navigation"] a, nav[aria-label="Mobile navigation"] button')].map(el => {
      const rect = el.getBoundingClientRect();
      return { label: el.textContent?.trim(), width: rect.width, height: rect.height };
    }),
    overflowing: [...document.querySelectorAll('body *')].filter(el => {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && (rect.left < -1 || rect.right > innerWidth + 1);
    }).slice(0, 15).map(el => ({ tag: el.tagName, className: el.getAttribute('class'), text: el.textContent?.slice(0, 80) })),
  }));
  await info.attach(name + '-measurements', { body: JSON.stringify({ revision, sourceHash, url: page.url(), browser: info.project.name, fixture: 'synthetic, offline DejaVu font fixture', ...measurements }, null, 2), contentType: 'application/json' });
  for (const fullPage of [false, true]) {
    const file = info.outputPath(name + (fullPage ? '-full.png' : '-viewport.png'));
    await page.screenshot({ path: file, fullPage, animations: 'disabled', style: 'nextjs-portal { visibility: hidden; }' });
    await info.attach(name + (fullPage ? '-full' : '-viewport'), { path: file, contentType: 'image/png' });
  }
  return measurements;
}

export async function noHorizontalOverflow(page: Page) {
  const sizes = await page.evaluate(() => ({ viewport: innerWidth, content: document.documentElement.scrollWidth }));
  expect(sizes.content).toBeLessThanOrEqual(sizes.viewport + 1);
}
