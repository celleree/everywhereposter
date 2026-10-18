#!/usr/bin/env node
// No credential loading, account configuration, migrations or provider calls.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..'), app = path.join(root, 'postiz-app');
function fail(message) { console.error(message); process.exit(1); }
if (process.argv.includes('--help')) {
  console.log('AI_WALLET_TEST_DATABASE_URL=postgresql://isolated:isolated@127.0.0.1:PORT/ep_ai_wallet_test node scripts/billing/acceptance-offline.cjs NEW_EVIDENCE_DIRECTORY');
  process.exit(0);
}
let url;
try { url = new URL(process.env.AI_WALLET_TEST_DATABASE_URL); } catch { fail('Explicit disposable fixture URL required.'); }
if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.hostname !== '127.0.0.1' || !url.port ||
    url.pathname !== '/ep_ai_wallet_test' || url.username !== 'isolated' || url.password !== 'isolated' || url.search) {
  fail('Only the explicit isolated:isolated loopback ep_ai_wallet_test fixture is permitted.');
}
if (process.argv.length !== 3) fail('Provide one NEW evidence directory; use --help.');
const state = spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' });
if (state.status !== 0 || state.stdout.trim()) fail('Commit the bounded candidate first; acceptance requires a clean exact HEAD.');
const source = 'a702c4ce52d3c416b295f754f4bf4b61ef973a88';
if (spawnSync('git', ['merge-base', '--is-ancestor', source, 'HEAD'], { cwd: root }).status !== 0) fail('Reviewed #230 source is not an ancestor.');
const output = path.resolve(process.argv[2]);
fs.mkdirSync(output); // Refuse to overwrite existing evidence.
const env = { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR || '/tmp',
  NODE_PATH: path.join(app, 'node_modules'), EP_OFFLINE_PG_PORT: url.port,
  AI_WALLET_TEST_DATABASE_URL: url.href, LAUNCH_ENTITLEMENT_TEST_DATABASE_URL: url.href,
  BILLING_ENABLED: 'false', STRIPE_SECRET_KEY: 'sk_test_synthetic_not_a_credential',
  STRIPE_SIGNING_KEY: 'whsec_synthetic_fixture', FRONTEND_URL: 'http://localhost:4200' };
const groups = [
  ['subscriptions', 'jest.copy-generation.config.cjs', [
    'stripe.launch-plan', 'stripe.card-required-trial', 'stripe.launch-billing-boundaries',
    'stripe.billing-activation', 'stripe.entitlement-reconciliation', 'stripe.lifetime-claim', 'launch-ai-route-policies',
    'refund-request.authorization', 'stripe.refund-refusal',
  ].map(name => `tests/copy-generation/${name}.spec.ts`)],
  ['wallet', 'jest.ai-wallet.config.cjs', []],
  ['browser-client', 'jest.post-set-review.config.cjs', [
    'tests/frontend/ai-wallet.spec.tsx', 'tests/frontend/copy-generation.client.spec.tsx',
    'tests/frontend/copy-generation.retry-identity.spec.tsx',
  ]],
];
const manifest = { mode: 'offline-fixtures-only', source, head: spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim(),
  startedAt: new Date().toISOString(), externalStripe: 'NOT_RUN', refundDisputeReconciliation: 'BLOCKED_NOT_IMPLEMENTED', groups: [] };
let passed = true;
for (const [name, config, files] of groups) {
  const log = fs.openSync(path.join(output, `${name}.log`), 'wx');
  const json = path.join(output, `${name}.json`);
  const args = ['--require', path.join(__dirname, 'offline-network.cjs'), path.join(app, 'node_modules/jest/bin/jest.js'),
    '--config', config, '--runInBand', '--json', '--outputFile', json, ...(files.length ? ['--runTestsByPath', ...files] : [])];
  const result = spawnSync(process.execPath, args, { cwd: app, env, stdio: ['ignore', log, log] });
  fs.closeSync(log);
  let report;
  try { report = JSON.parse(fs.readFileSync(json, 'utf8')); } catch { /* Missing results fail closed. */ }
  const ok = result.status === 0 && report?.success === true && report.numPassedTests > 0 &&
    report.numPendingTests === 0 && report.numPendingTestSuites === 0 && report.numTodoTests === 0;
  manifest.groups.push({ name, passed: ok, exitCode: result.status, tests: report?.numPassedTests ?? null });
  console.log(`${name}: ${ok ? 'PASS' : 'FAIL'} (${report?.numPassedTests ?? 'unknown'} passed)`);
  if (!ok) passed = false;
}
manifest.passed = passed; manifest.completedAt = new Date().toISOString();
fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
process.exitCode = passed ? 0 : 1;
