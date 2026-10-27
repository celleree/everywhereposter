'use strict';
// Offline recovery only; no credential input, provider call or active acceptance fixture.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const net = require('node:net');
const helper = require('./acceptance-sandbox.cjs');
const source = 'OFFLINE_SIMULATED', account = 'acct_expected';
const fixture = helper.fixture(process.env.AI_WALLET_TEST_DATABASE_URL);
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  let o = Array.isArray(args[0]) ? args[0][0] : args[0];
  if (!o || typeof o !== 'object') o = { port: args[0], host: args[1] || '127.0.0.1' };
  assert.ok(!o.path && o.host === '127.0.0.1' && String(o.port) === new URL(fixture).port, 'OFFLINE only');
  return connect.apply(this, args);
};
const cfg = { expected: account, port: 55501, refusal: 'req_SyntheticValidation' };
const head = '4444c49b5a7e52cfa4cf87f3ed957f5368d59215';
function writeClosed(directory, snapshot) {
  const writer = helper.evidenceWriter(directory);
  writer.append({ status: 'ACCOUNT_VERIFIED', accountId: account, head });
  writer.append({ status: 'LISTENING', port: cfg.port });
  writer.append(snapshot); writer.append({ status: 'STOPPED_LOCAL_RESOURCES_CLOSED' });
  return path.join(directory, 'evidence.jsonl');
}

test('closed private evidence binds account, port, ancestry, monotonic attempts and exact empty state', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ep-resume-evidence-'));
  const state = { source, status: 'ACTIVE', organizationId: 'stripe-acceptance-' + crypto.randomUUID(),
    topupId: crypto.randomUUID(), customerId: 'cus_Synthetic', attempts: 1,
    balanceNanos: '0', heldNanos: '0', funding: 0, reversals: 0, refundEvents: 0 };
  try {
    const file = writeClosed(path.join(temp, 'old'), state);
    assert.equal(helper.readResume(file, cfg, source).attempts, 1);
    for (const patch of [{ expected: 'acct_wrong' }, { port: 55502 }, { refusal: '' }])
      assert.throws(() => helper.readResume(file, { ...cfg, ...patch }, source));
    const baseline = fs.readFileSync(file, 'utf8');
    const changes = [rows => rows.pop(), rows => { rows[0].head = 'f'.repeat(40); },
      rows => { rows[2].attempts = 0; }, rows => { rows[2].attempts = 3; },
      rows => { rows[2].heldNanos = '1'; }, rows => { rows[2].funding = 1; },
      rows => { rows[2].paymentId = 'pi_unknown'; }, rows => { rows[2].rawBody = 'unsupported'; },
      rows => { rows[2].source = 'SIGNED_HTTP_ACCOUNT_VERIFIED_TRANSPORT_UNATTESTED'; },
      rows => { rows[2].sequence = 99; }, rows => { rows[2].status = 'REVIEW'; },
      rows => { rows.splice(2, 0, { ...rows[2], attempts: 0, customerId: 'cus_other' });
        rows.forEach((row, i) => { row.sequence = i + 1; }); }];
    for (const change of changes) {
      const rows = baseline.trim().split('\n').map(JSON.parse); change(rows);
      fs.writeFileSync(file, rows.map(row => JSON.stringify(row)).join('\n') + '\n');
      assert.throws(() => helper.readResume(file, cfg, source));
    }
    fs.writeFileSync(file, baseline); fs.chmodSync(file, 0o644);
    assert.throws(() => helper.readResume(file, cfg, source)); fs.chmodSync(file, 0o600);
    fs.writeFileSync(file + '.resume-claimed', '{}');
    assert.throws(() => helper.readResume(file, cfg, source));
  } finally { fs.rmSync(temp, { recursive: true }); }
});

test('real services resume one validation-refused case without a new customer/topup or automatic purchase', async () => {
  Object.assign(process.env, { BILLING_ENABLED: 'true', AI_WALLET_ENABLED: 'true',
    STRIPE_SECRET_KEY: 'rk_test_offlineSynthetic', AI_WALLET_TEST_OFFERS: '[{"id":"usd_500","amountCents":500}]',
    FRONTEND_URL: 'http://127.0.0.1:1' });
  const Services = helper.loadServices(), db = new Services.PrismaClient({ datasources: { db: { url: fixture } } });
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ep-resume-pg-'));
  let customers = 0, purchases = 0, conflict = true;
  const keys = new Set(), records = [];
  const gated = { checkout: { accounts: { retrieve: async () => ({ id: account, object: 'account' }) },
    customers: { retrieve: async id => { assert.equal(id, 'cus_Recovery'); return { id, livemode: false }; },
      create: async () => { customers++; return { id: 'cus_Recovery', livemode: false }; } },
    checkout: { sessions: { create: async (params, options) => {
      purchases++; keys.add(options.idempotencyKey); assert.equal(params.managed_payments.enabled, false);
      if (conflict) throw Error('Synthetic pre-execution refusal');
      return { id: 'cs_test_Recovered', livemode: false, mode: 'payment', customer: params.customer,
        client_reference_id: params.client_reference_id, metadata: params.metadata, amount_total: 500,
        currency: 'usd', status: 'open', url: 'https://checkout.stripe.com/c/pay/synthetic' };
    } } } } };
  try {
    await db.$connect(); assert.equal(await db.organization.count(), 0);
    const original = await helper.createCase(db, Services, gated, { append() {} }, source);
    original.confirmForwarder(); await assert.rejects(original.purchase(), /pre-execution/);
    const state = await original.snapshot(); assert.equal(state.attempts, 1);
    const file = writeClosed(path.join(temp, 'original'), state), resume = helper.readResume(file, cfg, source);
    const operation = (await helper.verifyResume(db, resume)).operationKey;
    const invalid = [tx => tx.aiWallet.update({ where: { organizationId: state.organizationId }, data: { balanceNanos: 1n } }),
      tx => tx.aiWallet.update({ where: { organizationId: state.organizationId }, data: { status: 'REVIEW' } }),
      tx => tx.subscription.update({ where: { organizationId: state.organizationId }, data: { deletedAt: new Date() } }),
      tx => tx.organization.update({ where: { id: state.organizationId }, data: { paymentId: 'cus_other' } }),
      tx => tx.organization.create({ data: { id: crypto.randomUUID(), name: 'Synthetic ambiguity' } }),
      tx => tx.aiWalletReservation.create({ data: { organizationId: state.organizationId, operationKey: crypto.randomUUID(),
        provider: 'synthetic', model: 'synthetic', ceilingNanos: 1n } }),
      tx => tx.aiWalletRefundEvent.create({ data: { eventId: 'evt_unknown', fingerprint: 'synthetic', evidence: {}, outcome: 'UNKNOWN' } })];
    for (const mutate of invalid) await assert.rejects(db.$transaction(async tx => {
      await mutate(tx); await assert.rejects(helper.verifyResume({ $transaction: fn => fn(tx) }, resume));
      throw Error('Synthetic rollback');
    }), /rollback/);
    const originalTopup = await db.aiWalletTopup.findUnique({ where: { id: state.topupId } });
    for (const data of [{ sessionId: 'cs_test_unknown' }, { createdAt: new Date(Date.now() - 86400001) }]) {
      await assert.rejects(db.aiWalletTopup.update({ where: { id: state.topupId }, data }));
      assert.deepEqual(await db.aiWalletTopup.findUnique({ where: { id: state.topupId } }), originalTopup,
        'Database must reject immutable-history mutation, not rely on an outer fixture rollback');
    }
    assert.equal((await helper.verifyResume(db, resume)).operationKey, operation);
    const recovered = await helper.createCase(db, Services, gated, { append: value => records.push(value) }, source, resume);
    assert.equal((await recovered.snapshot()).attempts, 1); assert.equal(purchases, 1);
    await assert.rejects(recovered.purchase()); assert.equal(purchases, 1, 'Forwarder confirmation still required');
    assert.throws(() => helper.readResume(file, cfg, source), 'Original evidence cannot reset counter');
    recovered.confirmForwarder();
    conflict = false;
    await recovered.purchase();
    assert.equal((await recovered.snapshot()).attempts, 2); assert.equal(purchases, 2);
    await assert.rejects(recovered.purchase()); assert.equal(purchases, 2);
    assert.ok(records.some(row => row.status === 'RESUMED_VALIDATION_REFUSAL'));
    assert.equal(keys.size, 1); assert.equal(customers, 1);
    assert.equal(await db.aiWalletTopup.count(), 1); assert.equal(await db.aiWalletLedger.count(), 0);
    assert.equal(await db.aiWalletRefundRequest.count(), 0);
    assert.equal((await db.aiWalletTopup.findUnique({ where: { id: state.topupId } })).operationKey, operation);
    assert.equal((await recovered.snapshot()).balanceNanos, '0');
  } finally { await db.$disconnect(); fs.rmSync(temp, { recursive: true }); }
});


for (const scenario of ['idempotency conflict', 'operation identity drift']) test(scenario + ' stops every further resumed purchase', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ep-resume-conflict-'));
  const state = { source, status: 'ACTIVE', organizationId: 'stripe-acceptance-' + crypto.randomUUID(),
    topupId: crypto.randomUUID(), customerId: 'cus_Conflict', attempts: 1,
    balanceNanos: '0', heldNanos: '0', funding: 0, reversals: 0, refundEvents: 0 };
  const t = { id: state.topupId, organizationId: state.organizationId, customerId: state.customerId,
    amountCents: 500, currency: 'usd', sessionId: null, paymentId: null, fundedAt: null,
    createdAt: new Date(), operationKey: crypto.randomUUID() };
  const db = { organization: { findUnique: async () => ({ paymentId: state.customerId }), count: async () => 1 },
    subscription: { findUnique: async () => ({ subscriptionTier: 'LAUNCH_V1', deletedAt: null }) },
    aiWalletTopup: { count: async () => 1, findFirst: async () => t },
    aiWallet: { findUnique: async () => ({ status: 'ACTIVE', balanceNanos: 0n, heldNanos: 0n }) } };
  for (const model of ['aiWalletReservation', 'aiWalletLedger', 'aiWalletPaymentEvent',
    'aiWalletRefundRequest', 'aiWalletRefundReconciliation', 'aiWalletRefundEvent'])
    db[model] = { count: async () => 0, findFirst: async () => null };
  db.$transaction = async fn => fn(db);
  let calls = 0; const records = [];
  const Services = { Wallet: class {}, Refunds: class {}, Checkout: class {
    async createCheckout(org, offer, operation) {
      calls++; assert.equal(org, state.organizationId); assert.equal(operation, t.operationKey);
      throw Error('Synthetic idempotency conflict');
    }
  } };
  try {
    const file = writeClosed(path.join(temp, 'old'), state), resume = helper.readResume(file, cfg, source);
    const acceptance = await helper.createCase(db, Services, { checkout: {} }, { append: row => records.push(row) }, source, resume);
    assert.equal(calls, 0); acceptance.confirmForwarder();
    if (scenario === 'operation identity drift') t.operationKey = crypto.randomUUID();
    await assert.rejects(acceptance.purchase()); await assert.rejects(acceptance.purchase());
    assert.equal(calls, scenario === 'operation identity drift' ? 0 : 1);
    assert.equal((await acceptance.snapshot()).attempts, 2);
    assert.ok(records.some(row => row.status === 'RESUME_RETRY_STOPPED'));
    assert.throws(() => helper.readResume(file, cfg, source));
  } finally { fs.rmSync(temp, { recursive: true }); }
});
