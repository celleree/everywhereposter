const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { test } = require('node:test');

const app = path.resolve(__dirname, '../..');
// Load the real TypeScript export in a fresh process for every environment.
// No runtime/test modules, Next server or browser are started.
const probe = `
  require('ts-node').register({ transpileOnly: true, project: './tsconfig.browser.json' });
  process.stdout.write(JSON.stringify(require('./playwright.config.ts').default));
`;

function load(overrides = {}) {
  const env = { ...process.env };
  for (const key of ['BROWSER_SUITE', 'EP_DISCOVERY_BROWSER', 'EP_FACEBOOK_BROWSER',
    'EP_WALLET_BROWSER', 'BROWSER_FRONTEND_PORT', 'BROWSER_API_PORT']) delete env[key];
  return spawnSync(process.execPath, ['-e', probe], {
    cwd: app, env: { ...env, ...overrides }, encoding: 'utf8', timeout: 15_000,
  });
}

const cases = [
  ['legacy', {}, ''],
  ['legacy discovery', { EP_DISCOVERY_BROWSER: '1' }, '/discovery'],
  ['smoke', { BROWSER_SUITE: 'smoke', EP_FACEBOOK_BROWSER: '1' }, '/smoke'],
  ['wallet', { BROWSER_SUITE: 'wallet', EP_WALLET_BROWSER: '1' }, '/wallet'],
  ['discovery', { BROWSER_SUITE: 'discovery', EP_DISCOVERY_BROWSER: '1' }, '/discovery'],
];

for (const [name, env, suffix] of cases) test(`${name}: actual config paths and safeguards`, () => {
  const result = load(env);
  assert.equal(result.status, 0, result.stderr || String(result.error || ''));
  const config = JSON.parse(result.stdout);
  assert.equal(config.outputDir, `browser-results${suffix}`);
  assert.deepEqual(config.reporter, [['list'],
    ['html', { outputFolder: `browser-report${suffix}`, open: 'never' }],
    ['json', { outputFile: `browser-results${suffix}/results.json` }]]);
  assert.equal(config.testDir, './tests/browser');
  assert.equal(config.testMatch, '*.spec.ts');
  assert.equal(config.timeout, 90_000);
  assert.deepEqual(config.expect, { timeout: 15_000 });
  assert.equal(config.workers, 1);
  assert.equal(config.retries, 0);
  assert.equal(config.use.baseURL, 'http://127.0.0.1:4217');
  assert.equal(config.use.trace, 'retain-on-failure');
  assert.equal(config.use.screenshot, 'only-on-failure');
  assert.equal(config.use.serviceWorkers, 'block');
  assert.deepEqual(config.projects.map(p => [p.name, p.use.browserName || p.use.defaultBrowserType]), [
    ['desktop-chromium', 'chromium'], ['phone-chromium', 'chromium'], ['phone-webkit', 'webkit'],
  ]);
  assert.deepEqual(config.projects[0].use.viewport, { width: 1440, height: 900 });
  assert.deepEqual(config.webServer, {
    command: 'node tests/browser/runtime.cjs', url: 'http://127.0.0.1:4218/__ready',
    reuseExistingServer: false, gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
    timeout: 360_000, stdout: 'pipe', stderr: 'pipe',
  });
});

test('suite selection alone never enables a fixture', () => {
  for (const suite of ['smoke', 'wallet']) {
    const result = load({ BROWSER_SUITE: suite });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).outputDir, `browser-results/${suite}`);
  }
});

test('Discovery retains its configured ports', () => {
  const result = load({ BROWSER_SUITE: 'discovery', EP_DISCOVERY_BROWSER: '1',
    BROWSER_FRONTEND_PORT: '4417', BROWSER_API_PORT: '4418' });
  assert.equal(result.status, 0, result.stderr);
  const config = JSON.parse(result.stdout);
  assert.equal(config.use.baseURL, 'http://127.0.0.1:4417');
  assert.equal(config.webServer.url, 'http://127.0.0.1:4418/__ready');
});

for (const suite of ['', 'unknown', '../smoke', 'Smoke']) test(`reject invalid suite ${JSON.stringify(suite)}`, () => {
  const result = load({ BROWSER_SUITE: suite });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /BROWSER_SUITE must be smoke, wallet or discovery when set/);
});

for (const env of [
  { BROWSER_SUITE: 'discovery' },
  { BROWSER_SUITE: 'discovery', EP_DISCOVERY_BROWSER: '0' },
  { BROWSER_SUITE: 'smoke', EP_DISCOVERY_BROWSER: '1' },
  { BROWSER_SUITE: 'wallet', EP_DISCOVERY_BROWSER: '1' },
]) test(`reject mismatched fixture ${JSON.stringify(env)}`, () => {
  const result = load(env);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /BROWSER_SUITE must match the EP_DISCOVERY_BROWSER fixture mode/);
});

test('CI suites use distinct sibling artifact paths', () => {
  const paths = cases.slice(2).map(([, env]) => {
    const result = load(env);
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout).outputDir;
  });
  assert.equal(new Set(paths).size, 3);
  for (const dir of paths) assert.equal(path.dirname(dir), 'browser-results');
});
