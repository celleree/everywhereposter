'use strict';
// Entirely synthetic. Socket guard permits only this task's disposable PostgreSQL.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createRequire } = require('node:module');
const helper = require('./acceptance-sandbox.cjs');
const tool = require('./review-funded-test-refund.cjs');
const appRequire = createRequire(path.resolve(__dirname, '../../postiz-app/package.json'));
const Stripe = appRequire('stripe');
const fixture = process.env.AI_WALLET_TEST_DATABASE_URL;
const port = new URL(fixture).port, connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  let o = Array.isArray(args[0]) ? args[0][0] : args[0];
  if (!o || typeof o !== 'object') o = { port: args[0], host: typeof args[1] === 'string' ? args[1] : '127.0.0.1' };
  assert.ok(!o.path && o.host === '127.0.0.1' && String(o.port) === port, 'Non-fixture network blocked');
  return connect.apply(this, args);
};
const cfg = { accountId: 'acct_expected', organizationId: 'stripe-acceptance-' + randomUUID(), topupId: randomUUID(),
  requestId: randomUUID(), chargeId: 'ch_synthetic', refundId: 're_synthetic' };
const charge = () => ({ object: 'charge', id: cfg.chargeId, payment_intent: 'pi_synthetic', customer: 'cus_synthetic',
  amount: 500, amount_refunded: 500, currency: 'usd', livemode: false, paid: true, captured: true, refunded: true, disputed: false,
  billing_details: { email: 'private@example.invalid' } });
const refund = () => ({ object: 'refund', id: cfg.refundId, charge: cfg.chargeId, payment_intent: 'pi_synthetic',
  amount: 500, currency: 'usd', status: 'succeeded', metadata: { private: 'do-not-persist' } });
const list = () => ({ object: 'list', has_more: false, data: [refund()] });

test('strict one-case configuration refuses live keys and inherited provider/loader overrides', () => {
  const env = { STRIPE_SECRET_KEY: 'rk_test_synthetic', EP_REVIEW_ACCOUNT: cfg.accountId,
    EP_REVIEW_FIXTURE: fixture, EP_REVIEW_EVIDENCE: '/tmp/new-private', EP_REVIEW_ORG: cfg.organizationId,
    EP_REVIEW_TOPUP: cfg.topupId, EP_REVIEW_REQUEST: cfg.requestId, EP_REVIEW_CHARGE: cfg.chargeId, EP_REVIEW_REFUND: cfg.refundId };
  assert.equal(tool.config(env).database, fixture);
  for (const patch of [{ STRIPE_SECRET_KEY: 'rk_live_invalid' }, { STRIPE_ACCOUNT: 'acct_other' },
    { NODE_OPTIONS: '--require evil' }, { HTTPS_PROXY: 'invalid' }, { EP_REVIEW_ORG: 'real-org' },
    { EP_REVIEW_FIXTURE: fixture.replace('127.0.0.1', 'remote.invalid') }]) assert.throws(() => tool.config({ ...env, ...patch }));
});

test('real pinned SDK issues exactly current-account GET, charge GET and filtered complete-list GET', async () => {
  const requests = [];
  const sdk = new Stripe('rk_test_synthetic', { maxNetworkRetries: 0,
    httpClient: Stripe.createFetchHttpClient(async (url, options) => {
      requests.push({ url: String(url), method: options.method });
      const u = new URL(url); let body;
      if (u.pathname === '/v1/account') body = { object: 'account', id: cfg.accountId };
      else if (u.pathname === '/v1/charges/' + cfg.chargeId) body = charge();
      else {
        assert.equal(u.pathname, '/v1/refunds'); assert.equal(u.searchParams.get('charge'), cfg.chargeId);
        assert.equal(u.searchParams.get('limit'), '100'); assert.equal([...u.searchParams].length, 2); body = list();
      }
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    }) });
  const gated = await tool.accountGate(sdk, cfg.accountId), receipt = await tool.proof(gated, cfg);
  assert.deepEqual(requests.map(r => r.method), ['GET', 'GET', 'GET']);
  assert.equal(receipt.refunds.hasMore, false); assert.equal(receipt.refunds.data.length, 1);
  assert.ok(!JSON.stringify(receipt).includes('private')); assert.ok(!JSON.stringify(receipt).includes('do-not-persist'));
  assert.equal(gated.checkout, undefined); assert.equal(gated.create, undefined);
});

test('account mismatch fails before any charge or refund lookup', async () => {
  let reads = 0;
  for (const a of [{ object: 'account', id: 'acct_other' }, { object: 'account', id: cfg.accountId, deleted: true },
    { object: 'account', id: cfg.accountId, livemode: true }]) {
    await assert.rejects(tool.accountGate({ accounts: { retrieve: async () => a }, charges: { retrieve: async () => reads++ } }, cfg.accountId));
  }
  assert.equal(reads, 0);
});

test('provider adapter refuses incomplete, multiple, live and malformed read responses', async () => {
  for (const bad of [{ ...list(), has_more: true }, { ...list(), has_more: undefined }, { ...list(), data: [] },
    { ...list(), data: [refund(), refund()] }, { ...list(), object: 'charge' },
    { ...list(), data: [{ ...refund(), livemode: true }] }, { ...list(), data: [{ ...refund(), object: 'charge' }] }])
    await assert.rejects(tool.proof({ charge: async () => charge(), refunds: async () => bad }, cfg));
  await assert.rejects(tool.proof({ charge: async () => ({ ...charge(), livemode: true }), refunds: async () => list() }, cfg));
});

test('one-shot operator tool reconciles an existing signed case while old service instances stay running', async () => {
  Object.assign(process.env, { BILLING_ENABLED: 'true', AI_WALLET_ENABLED: 'true', AI_WALLET_TEST_REFUNDS_ENABLED: 'true',
    STRIPE_SECRET_KEY: 'rk_test_synthetic' });
  const Services = helper.loadServices(), db = new Services.PrismaClient({ datasources: { db: { url: fixture } }, log: [] });
  await db.$connect();
  try {
    assert.equal(await db.organization.count(), 0, 'New disposable fixture required');
    await db.organization.create({ data: { id: cfg.organizationId, name: 'Synthetic read-proof case', paymentId: 'cus_synthetic' } });
    const wallet = new Services.Wallet({ model: db }), old = new Services.Refunds({ model: db });
    const topup = await wallet.createTopup(cfg.organizationId, randomUUID(), 'cus_synthetic', 500); cfg.topupId = topup.id;
    await wallet.bindTopupSession(cfg.organizationId, topup.id, 'cs_test_synthetic');
    await wallet.applyVerifiedTopupEvent({ eventId: 'evt_fundingSynthetic', organizationId: cfg.organizationId, topupId: topup.id,
      sessionId: 'cs_test_synthetic', paymentId: 'pi_synthetic', customerId: 'cus_synthetic', amountCents: 500,
      currency: 'usd', mode: 'payment', paymentStatus: 'paid' });
    const request = await old.request(cfg.organizationId, 'synthetic-local-operator', randomUUID()); cfg.requestId = request.id;
    const signer = new Stripe('sk_test_synthetic'), signing = 'whsec_syntheticFixture';
    const events = [
      { id: 'evt_chargeSynthetic', object: 'event', livemode: false, type: 'charge.refunded', data: { object: charge() } },
      { id: 'evt_refundSynthetic', object: 'event', livemode: false, type: 'refund.updated', data: { object: refund() } },
    ];
    const deliver = async e => {
      const raw = JSON.stringify(e), sig = signer.webhooks.generateTestHeaderString({ payload: raw, secret: signing });
      await old.handleVerifiedRefundEvent(signer.webhooks.constructEvent(raw, sig, signing));
    };
    for (const e of events) await deliver(e);
    const original = await db.aiWalletRefundEvent.findMany({ orderBy: { eventId: 'asc' } });
    const records = [], gated = { charge: async () => charge(), refunds: async () => list() };
    const result = await tool.review(db, Services.Refunds, gated, cfg, { append: r => records.push(r) });
    assert.equal(result.requestStatus, 'REFUNDED'); assert.equal(result.reconciliationState, 'SUCCEEDED');
    assert.equal(result.status, 'REVIEW'); assert.equal(result.balanceNanos, '0'); assert.equal(result.heldNanos, '0');
    for (const e of events) await deliver(e);
    await assert.rejects(tool.review(db, Services.Refunds, gated, cfg, { append() {} }));
    const after = await db.aiWalletRefundEvent.findMany({ orderBy: { eventId: 'asc' } });
    assert.deepEqual(after.filter(r => r.outcome !== 'VERIFIED_PROVIDER_READ'), original);
    assert.equal(after.filter(r => r.outcome === 'VERIFIED_PROVIDER_READ').length, 1);
    assert.equal(await db.aiWalletLedger.count({ where: { kind: 'REVERSAL' } }), 1);
    assert.ok(!JSON.stringify(after).includes('private@example.invalid'));
    assert.ok(!JSON.stringify(records).includes('private'));
  } finally { await db.$disconnect(); }
});
