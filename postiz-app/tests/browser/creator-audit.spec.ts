import { execFileSync } from 'node:child_process';
import { test, expect, openApp, capture, noHorizontalOverflow, browserOrigin } from './fixtures';

const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();

for (const width of [390, 1440]) {
  test(`Creator Audit: connection selector has visible keyboard focus at ${width}px`, async ({ page, context }, info) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await context.addCookies([{ name: 'mode', value: 'dark', url: browserOrigin }]);
    const auditMutations: string[] = [];
    // Only audit/account reads are synthetic. The existing context and runtime
    // guards still block external requests and all unmatched mutations.
    await page.route('**/backend-api/creator-audit/**', route => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (request.method() !== 'GET') {
        auditMutations.push(path);
        return route.fulfill({ status: 405, json: {} });
      }
      if (path.endsWith('/status')) return route.fulfill({ json: { enabled: true } });
      if (path.endsWith('/tasks/current')) return route.fulfill({ json: null });
      if (path.endsWith('/audit')) return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Synthetic receiver</title>' });
      return route.fulfill({ status: 404, json: {} });
    });
    await page.route('**/backend-api/integrations/list', route => route.request().method() === 'GET'
      ? route.fulfill({ json: { integrations: [{ id: 'ig-1', identifier: 'instagram', name: 'Creator account', type: 'social', editor: 'normal', additionalSettings: '[]', time: [] }] } })
      : route.fulfill({ status: 405, json: {} }));

    await openApp(page, '/creator-audit');
    const select = page.getByRole('combobox', { name: 'Instagram connection' });
    await expect(select).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole('button', { name: 'Start audit', exact: true })).toBeDisabled();
    for (const theme of ['dark', 'light']) {
      if (!await page.locator('body').evaluate((body, value) => body.classList.contains(value), theme)) {
        await page.getByRole('button', { name: 'Toggle theme' }).click();
      }
      await expect(page.locator('body')).toHaveClass(new RegExp(`(?:^| )${theme}(?: |$)`));
      // Reach the select with a real keyboard event; programmatic focus alone
      // does not establish that :focus-visible is active.
      await select.focus();
      await page.keyboard.press('Shift+Tab');
      await page.keyboard.press('Tab');
      await expect(select).toBeFocused();
      expect(await select.evaluate(element => element.matches(':focus-visible'))).toBe(true);
      await expect(select).toHaveCSS('outline-style', 'solid');
      await expect(select).toHaveCSS('outline-width', '2px');
      await expect(select).toHaveCSS('outline-offset', '2px');
      const focus = await select.evaluate(element => {
        const style = getComputedStyle(element);
        const luminance = (color: string) => {
          const channels = color.match(/[\d.]+/g)!.map(Number);
          if (channels.length === 4 && channels[3] !== 1) throw new Error('Focus colors must be opaque');
          return channels.slice(0, 3).map(value => value / 255)
            .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
            .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
        };
        const foreground = luminance(style.outlineColor), background = luminance(style.backgroundColor);
        return { outline: style.outline, offset: style.outlineOffset,
          contrast: (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05) };
      });
      expect(focus.contrast).toBeGreaterThanOrEqual(3);
      console.log('CREATOR_AUDIT_FOCUS ' + JSON.stringify({ head, width, theme, ...focus }));
      await noHorizontalOverflow(page);
      await capture(page, info, `creator-audit-focus-${width}-${theme}`);
    }
    expect(auditMutations).toEqual([]);
  });
}
