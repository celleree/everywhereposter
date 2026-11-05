import { defineConfig, devices } from '@playwright/test';

const discoveryMode = process.env.EP_DISCOVERY_BROWSER === '1';
const suite = process.env.BROWSER_SUITE;
if (suite !== undefined && !['smoke', 'wallet', 'discovery'].includes(suite)) {
  throw new Error('BROWSER_SUITE must be smoke, wallet or discovery when set');
}
if (suite !== undefined && (suite === 'discovery') !== discoveryMode) {
  throw new Error('BROWSER_SUITE must match the EP_DISCOVERY_BROWSER fixture mode');
}
// Keep legacy local paths; CI uses sibling directories so later suites cannot
// clear earlier reports, traces or JSON results. This never enables a fixture.
const suffix = suite ? `/${suite}` : discoveryMode ? '/discovery' : '';
const results = `browser-results${suffix}`;
const report = `browser-report${suffix}`;
const frontendPort = process.env.BROWSER_FRONTEND_PORT || '4217';
const apiPort = process.env.BROWSER_API_PORT || '4218';

export default defineConfig({
  testDir: './tests/browser',
  testMatch: '*.spec.ts',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  workers: 1,
  retries: 0,
  outputDir: results,
  reporter: [['list'], ['html', { outputFolder: report, open: 'never' }], ['json', { outputFile: `${results}/results.json` }]],
  use: {
    baseURL: `http://127.0.0.1:${frontendPort}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    serviceWorkers: 'block',
  },
  projects: [
    { name: 'desktop-chromium', use: { browserName: 'chromium', viewport: { width: 1440, height: 900 } } },
    { name: 'phone-chromium', use: { ...devices['Pixel 7'] } },
    { name: 'phone-webkit', use: { ...devices['iPhone 13'] } },
  ],
  webServer: {
    command: 'node tests/browser/runtime.cjs',
    url: `http://127.0.0.1:${apiPort}/__ready`,
    reuseExistingServer: false,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
    timeout: 360_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
