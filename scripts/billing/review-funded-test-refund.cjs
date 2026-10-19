'use strict';
// One explicit review of an existing disposable case. No listener, purchase,
// refund creation, audit edits, migration, .env or general application boot.
const path = require('node:path');
const readline = require('node:readline');
const { spawnSync } = require('node:child_process');
const { createRequire } = require('node:module');
const { fixture, loadServices, evidenceWriter } = require('./acceptance-sandbox.cjs');
const root = path.resolve(__dirname, '../..');
const appRequire = createRequire(path.join(root, 'postiz-app/package.json'));
const safe = ok => { if (!ok) throw Error('Test review refused.'); };
const id = value => typeof value === 'string' ? value : value?.id;
function config(env) {
  for (const key of Object.keys(env)) safe(['PATH', 'HOME', 'LANG', 'TMPDIR', 'STRIPE_SECRET_KEY',
    'EP_REVIEW_ACCOUNT', 'EP_REVIEW_FIXTURE', 'EP_REVIEW_EVIDENCE', 'EP_REVIEW_ORG',
    'EP_REVIEW_TOPUP', 'EP_REVIEW_REQUEST', 'EP_REVIEW_CHARGE', 'EP_REVIEW_REFUND'].includes(key));
  safe(/^(sk|rk)_test_[A-Za-z0-9]+$/.test(env.STRIPE_SECRET_KEY || '') &&
    /^acct_[A-Za-z0-9]{1,100}$/.test(env.EP_REVIEW_ACCOUNT || '') &&
    /^stripe-acceptance-[a-f0-9-]{36}$/.test(env.EP_REVIEW_ORG || '') &&
    [env.EP_REVIEW_TOPUP, env.EP_REVIEW_REQUEST].every(x => /^[a-f0-9-]{36}$/.test(x || '')) &&
    /^ch_[A-Za-z0-9]+$/.test(env.EP_REVIEW_CHARGE || '') && /^re_[A-Za-z0-9]+$/.test(env.EP_REVIEW_REFUND || ''));
  return { accountId: env.EP_REVIEW_ACCOUNT, database: fixture(env.EP_REVIEW_FIXTURE),
    evidence: env.EP_REVIEW_EVIDENCE, organizationId: env.EP_REVIEW_ORG,
    topupId: env.EP_REVIEW_TOPUP, requestId: env.EP_REVIEW_REQUEST,
    chargeId: env.EP_REVIEW_CHARGE, refundId: env.EP_REVIEW_REFUND };
}
async function accountGate(sdk, expected) {
  const a = await sdk.accounts.retrieve();
  safe(a.object === 'account' && a.id === expected && a.deleted !== true && a.livemode !== true);
  // GETs only. Capture the filtered list itself, never Charge.refunds expansion.
  return { charge: chargeId => sdk.charges.retrieve(chargeId),
    refunds: chargeId => sdk.refunds.list({ charge: chargeId, limit: 100 }) };
}
async function proof(gated, cfg) {
  const observedAt = Date.now();
  const c = await gated.charge(cfg.chargeId);
  const list = await gated.refunds(cfg.chargeId);
  safe(c.object === 'charge' && c.livemode === false && list.object === 'list' &&
    list.has_more === false && Array.isArray(list.data) && list.data.length === 1 &&
    list.data[0].object === 'refund' && list.data[0].livemode !== true);
  const r = list.data[0];
  // Whitelist only accounting fields: no raw response, card data, PII or URL.
  return { accountId: cfg.accountId, observedAt,
    charge: { id: c.id, paymentId: id(c.payment_intent), customerId: id(c.customer),
      amount: c.amount, amountRefunded: c.amount_refunded, currency: c.currency,
      livemode: c.livemode, paid: c.paid, captured: c.captured, refunded: c.refunded, disputed: c.disputed },
    refunds: { object: list.object, hasMore: list.has_more, data: [{ id: r.id, paymentId: id(r.payment_intent),
      chargeId: id(r.charge), amount: r.amount, currency: r.currency, status: r.status }] } };
}
async function snapshot(db, cfg) {
  return db.$transaction(async tx => {
    const org = await tx.organization.findUnique({ where: { id: cfg.organizationId }, select: { paymentId: true } });
    const topup = await tx.aiWalletTopup.findFirst({ where: { id: cfg.topupId, organizationId: cfg.organizationId } });
    const request = await tx.aiWalletRefundRequest.findFirst({ where: { id: cfg.requestId, organizationId: cfg.organizationId }, include: { reconciliation: true } });
    const wallet = await tx.aiWallet.findUnique({ where: { organizationId: cfg.organizationId } });
    safe(await tx.organization.count() === 1 && await tx.aiWalletTopup.count() === 1 &&
      topup?.fundedAt && topup.paymentId && topup.sessionId && topup.amountCents === 500 &&
      topup.currency === 'usd' && org?.paymentId === topup.customerId && request && wallet?.status === 'REVIEW');
    return { status: wallet.status, organizationId: cfg.organizationId, topupId: cfg.topupId,
      requestId: cfg.requestId, refundId: cfg.refundId, chargeId: cfg.chargeId, paymentId: topup.paymentId,
      customerId: topup.customerId, sessionId: topup.sessionId,
      requestStatus: request.status, reconciliationState: request.reconciliation?.state,
      balanceNanos: String(wallet.balanceNanos), heldNanos: String(wallet.heldNanos),
      funding: await tx.aiWalletLedger.count({ where: { organizationId: cfg.organizationId, kind: 'FUNDING' } }),
      reversals: await tx.aiWalletLedger.count({ where: { organizationId: cfg.organizationId, kind: 'REVERSAL' } }) };
  }, { isolationLevel: 'RepeatableRead' });
}
async function review(db, Refunds, gated, cfg, evidence) {
  const before = await snapshot(db, cfg);
  safe(before.requestStatus === 'REQUESTED' && !before.reconciliationState && before.funding === 1 && before.reversals === 0 &&
    before.balanceNanos === '5000000000' && before.heldNanos === '5000000000');
  const receipt = await proof(gated, cfg); // Fresh reads immediately before locked history validation.
  const result = await new Refunds({ model: db }).reviewTestTopup(cfg.organizationId, cfg.requestId,
    'synthetic-local-operator', { topupId: cfg.topupId, chargeId: cfg.chargeId, refundId: cfg.refundId }, receipt);
  safe(result.state === 'SUCCEEDED');
  const after = await snapshot(db, cfg);
  // A concurrent adverse event may already have downgraded state; retain debit and report it.
  safe(after.requestStatus === 'REFUNDED' && after.reversals === 1 && after.balanceNanos === '0' && after.heldNanos === '0');
  evidence.append(after); return after;
}
async function main() {
  safe(process.stdin.isTTY && process.stdout.isTTY && process.argv.length === 2);
  const cfg = config(process.env);
  const state = spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' });
  const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
  safe(state.status === 0 && !state.stdout.trim() && head.status === 0);
  const evidence = evidenceWriter(cfg.evidence);
  let db, terminal;
  try {
    const Stripe = appRequire('stripe');
    const sdk = new Stripe(process.env.STRIPE_SECRET_KEY, { maxNetworkRetries: 0, timeout: 10000 });
    const gated = await accountGate(sdk, cfg.accountId);
    evidence.append({ source: 'live_operator_run', status: 'ACCOUNT_VERIFIED', accountId: cfg.accountId, head: head.stdout.trim() });
    Object.assign(process.env, { BILLING_ENABLED: 'true', AI_WALLET_ENABLED: 'true', AI_WALLET_TEST_REFUNDS_ENABLED: 'true' });
    const Services = loadServices();
    db = new Services.PrismaClient({ datasources: { db: { url: cfg.database } }, log: [] });
    await db.$connect(); evidence.append(await snapshot(db, cfg));
    console.log('Existing test case verified. Type review to read provider evidence and reconcile once, or quit.');
    console.log('No refund is created. The wallet remains REVIEW. Existing listener stays running.');
    terminal = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true, historySize: 0 });
    for await (const line of terminal) {
      if (line.trim() === 'quit') break;
      safe(line.trim() === 'review');
      console.log(JSON.stringify(await review(db, Services.Refunds, gated, cfg, evidence))); break;
    }
  } finally {
    terminal?.close(); await db?.$disconnect(); delete process.env.STRIPE_SECRET_KEY;
    evidence.append({ status: 'STOPPED_LOCAL_RESOURCES_CLOSED' });
  }
}
module.exports = { config, accountGate, proof, snapshot, review };
if (require.main === module) main().catch(() => { console.error('Test review stopped; details suppressed. No automatic retry.'); process.exitCode = 1; });
