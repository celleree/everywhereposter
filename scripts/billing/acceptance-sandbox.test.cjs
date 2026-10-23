'use strict';
// Offline only. No real key, provider operation, app boot or existing tenant.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const http = require('node:http');
const { createRequire } = require('node:module');
const testFixture = process.env.AI_WALLET_TEST_DATABASE_URL;
const ownedPorts = new Set([new URL(testFixture).port]);
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  let opts = Array.isArray(args[0]) ? args[0][0] : args[0];
  if (!opts || typeof opts !== 'object') opts = { port: args[0], host: typeof args[1] === 'string' ? args[1] : '127.0.0.1' };
  assert.ok(!opts.path && opts.host === '127.0.0.1' && ownedPorts.has(String(opts.port)), 'OFFLINE: blocked non-owned network');
  return connect.apply(this, args);
};
const helper = require('./acceptance-sandbox.cjs');
const appRequire = createRequire(path.resolve(__dirname, '../../postiz-app/package.json'));
const Stripe = appRequire('stripe');
const signing = 'whsec_offlineSynthetic';
const signer = new Stripe('sk_test_offlineSynthetic');
const env = { STRIPE_SECRET_KEY: 'sk_test_offlineSynthetic', STRIPE_SIGNING_KEY: signing,
  EP_SANDBOX_ACCOUNT: 'acct_expected', EP_SANDBOX_LISTEN_PORT: '55500', EP_SANDBOX_FIXTURE: 'postgresql://isolated:isolated@127.0.0.1:55485/ep_ai_wallet_test' };
const makeEvent = (object, type = 'checkout.session.completed', changes = {}) => ({
  id: 'evt_' + require('node:crypto').randomUUID().replaceAll('-', ''), object: 'event',
  livemode: false, type, data: { object }, ...changes,
});
const sdkBase = () => ({ accounts: { retrieve: async (...args) => {
  assert.equal(args.length, 0); return { id: 'acct_expected', object: 'account' };
} } });

test('strict credentials, clean environment and single explicit disposable fixture', () => {
  assert.equal(helper.config(env).expected, 'acct_expected');
  assert.equal(helper.config(env).port, 55500);
  for (const patch of [{ STRIPE_SECRET_KEY: 'sk_live_never' }, { STRIPE_SECRET_KEY: 'rk_live_never' },
    { STRIPE_SECRET_KEY: 'sk_test_bad\n' },
    ...['', '0', '49151', '65536', '55500.0', '055500', '55500\n', '55485'].map(EP_SANDBOX_LISTEN_PORT => ({ EP_SANDBOX_LISTEN_PORT })), { STRIPE_SIGNING_KEY: 'bad' }, { EP_SANDBOX_ACCOUNT: '' },
    { HTTPS_PROXY: 'http://127.0.0.1' }, { STRIPE_API_HOST: 'evil.invalid' }, { STRIPE_ACCOUNT: 'acct_other' },
    { NODE_OPTIONS: '--require evil' }, { EP_SANDBOX_FIXTURE: env.EP_SANDBOX_FIXTURE + '?schema=public' },
    { EP_SANDBOX_FIXTURE: env.EP_SANDBOX_FIXTURE.replace('55485', '5432') },
    { EP_SANDBOX_FIXTURE: env.EP_SANDBOX_FIXTURE.replace('127.0.0.1', 'remote.invalid') }])
    assert.throws(() => helper.config({ ...env, ...patch }));
  assert.equal(helper.config({ ...env, STRIPE_SECRET_KEY: 'rk_test_offlineSynthetic' }).expected, 'acct_expected');
  for (const port of ['49152', '65535']) assert.equal(helper.config({ ...env, EP_SANDBOX_LISTEN_PORT: port }).port, Number(port));
});

test('current-account verification fails before any financial capability is returned', async () => {
  let writes = 0;
  const sdk = { ...sdkBase(), customers: { create: async () => { writes++; } } };
  for (const account of [{ id: 'acct_other', object: 'account' }, { id: 'acct_expected', object: 'account', livemode: true },
    { id: 'acct_expected', object: 'account', deleted: true }]) {
    sdk.accounts.retrieve = async () => account;
    await assert.rejects(helper.accountGate(sdk, 'acct_expected'));
  }
  assert.equal(writes, 0);
  sdk.accounts.retrieve = sdkBase().accounts.retrieve;
  const gate = await helper.accountGate(sdk, 'acct_expected');
  assert.equal(gate.checkout.refunds, undefined);
  sdk.customers.create = async () => ({ id: 'cus_live', livemode: true });
  await assert.rejects(gate.checkout.customers.create({}));
});


test('early own-case refund uses a read-only bound-session PI and dispatches immediately', async () => {
  let dispatched = 0, lookedUp = 0;
  const topup = { id: 'topup_synthetic', organizationId: 'synthetic', sessionId: 'cs_test_early',
    customerId: 'cus_early', paymentId: null, amountCents: 500, currency: 'usd' };
  const db = { organization: { count: async () => 0 },
    $transaction: async fn => fn({ ...db, $queryRaw: async () => {}, organization: { count: async () => 0, create: async () => {} }, subscription: { create: async () => {} } }),
    aiWalletTopup: { findFirst: async () => topup },
    aiWallet: { findUnique: async () => null }, aiWalletLedger: { count: async () => 0 }, aiWalletRefundEvent: { count: async () => 0 }, aiWalletRefundRequest: { findFirst: async () => null } };
  const Services = { Wallet: class {}, Refunds: class {}, Checkout: class {
    async handleVerifiedEvent() { dispatched++; }
  } };
  const event = makeEvent({ id: 're_early', object: 'refund', payment_intent: 'pi_early', charge: 'ch_early',
    amount: 500, currency: 'usd', status: 'succeeded' }, 'refund.created');
  const gated = { checkout: {}, event: async () => event, session: async sessionId => {
    lookedUp++; assert.equal(sessionId, topup.sessionId);
    return { id: sessionId, customer: topup.customerId, mode: 'payment', client_reference_id: topup.id,
      metadata: { topupId: topup.id, service: 'everywhereposter-ai-wallet-test' },
      amount_total: 500, currency: 'usd', payment_intent: 'pi_early' };
  } };
  const acceptance = await helper.createCase(db, Services, gated, { append() {} }, 'OFFLINE_SIMULATED');
  await acceptance.deliver(event); assert.equal(dispatched, 1); assert.equal(lookedUp, 1);
  await assert.rejects(acceptance.deliver(makeEvent({ ...event.data.object, payment_intent: 'pi_other' }, 'refund.created')));
  assert.equal(dispatched, 1);
});

for (const type of ['charge.dispute.funds_withdrawn', 'charge.dispute.funds_reinstated']) {
  test(type + ' verifies its own-case account event before immediate production dispatch', async () => {
    const trace = [], topup = { id: 'topup_dispute', organizationId: 'synthetic',
      sessionId: 'cs_test_dispute', customerId: 'cus_dispute', paymentId: 'pi_dispute',
      amountCents: 500, currency: 'usd' };
    const event = makeEvent({ id: 'dp_synthetic', object: 'dispute', payment_intent: topup.paymentId,
      charge: 'ch_dispute', amount: 500, currency: 'usd', status: 'lost' }, type);
    let accountEvent = event;
    const sdk = { accounts: { retrieve: async (...args) => {
      assert.equal(args.length, 0); trace.push('current-account');
      return { id: 'acct_expected', object: 'account' };
    } }, events: { retrieve: async eventId => {
      assert.equal(eventId, event.id); trace.push('account-event'); return accountEvent;
    } } };
    const gated = await helper.accountGate(sdk, 'acct_expected');
    const db = { $transaction: async fn => fn({ ...db, $queryRaw: async () => {},
      organization: { count: async () => 0, create: async () => {} }, subscription: { create: async () => {} } }),
      aiWalletTopup: { findFirst: async () => topup }, aiWallet: { findUnique: async () => null },
      aiWalletLedger: { count: async () => 0 }, aiWalletRefundEvent: { count: async () => 0 }, aiWalletRefundRequest: { findFirst: async () => null } };
    const Services = { Wallet: class {}, Refunds: class {}, Checkout: class {
      async handleVerifiedEvent(received) { assert.equal(received, event); trace.push('production-dispatch'); }
    } };
    const acceptance = await helper.createCase(db, Services, gated, { append() {} }, 'OFFLINE_SIMULATED');
    await assert.rejects(acceptance.deliver(makeEvent({ ...event.data.object, payment_intent: 'pi_other' }, type)));
    assert.deepEqual(trace, ['current-account'], 'Unrelated PI rejected before account lookup/dispatch');
    accountEvent = { ...event, account: 'acct_other' };
    await assert.rejects(acceptance.deliver(event));
    assert.deepEqual(trace, ['current-account', 'account-event'], 'Other-account event never dispatches');
    accountEvent = event;
    await acceptance.deliver(event);
    assert.deepEqual(trace, ['current-account', 'account-event', 'account-event', 'production-dispatch']);
  });
}

test('listener binds the explicit high loopback port and rejects invalid ports', async () => {
  for (const port of [-1, 49151, 65536, '55501'])
    await assert.rejects(helper.listen(signer, signing, {}, { append() {} }, port));
  const server = await helper.listen(signer, signing, {}, { append() {} }, 55501);
  try {
    assert.equal(server.address().address, '127.0.0.1'); assert.equal(server.address().port, 55501);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('refund classifier requires complete monetary proof and exposes contradictions after debit', () => {
  const clean = { status: 'REVIEW', requestStatus: 'REFUNDED', reconciliationState: 'SUCCEEDED',
    funding: 1, reversals: 1, balanceNanos: '0', heldNanos: '0' };
  assert.equal(helper.refundOutcome(clean), 'MONETARILY_RECONCILED_WALLET_FROZEN');
  assert.equal(helper.refundOutcome({ ...clean, status: 'ACTIVE' }), 'MONETARILY_RECONCILED');
  for (const patch of [{ requestStatus: undefined }, { requestStatus: 'REQUESTED' },
    { reconciliationState: undefined }, { reconciliationState: 'PENDING' }, { reconciliationState: 'FAILED' },
    { reconciliationState: 'UNCERTAIN' }, { reversals: 0 }, { reversals: 2 }, { funding: 0 },
    { balanceNanos: '1' }, { heldNanos: '1' }, { status: 'EMPTY' }])
    assert.equal(helper.refundOutcome({ ...clean, ...patch }), 'DEBIT_RECORDED_REVIEW_REQUIRED');
  for (const reconciliationState of [undefined, 'PENDING', 'FAILED', 'UNCERTAIN'])
    assert.equal(helper.refundOutcome({ ...clean, requestStatus: 'REQUESTED', reconciliationState,
      reversals: 0, balanceNanos: '5000000000', heldNanos: '5000000000' }), 'BLOCKED_REFUND_RECONCILIATION');
});

test('real services: raw signed refund before explicit late review reconciles money with frozen wallet', async () => {
  const url = helper.fixture(testFixture);
  Object.assign(process.env, { BILLING_ENABLED: 'true', AI_WALLET_ENABLED: 'true',
    AI_WALLET_TEST_REFUNDS_ENABLED: 'true', STRIPE_SECRET_KEY: env.STRIPE_SECRET_KEY,
    AI_WALLET_TEST_OFFERS: '[{"id":"usd_500","amountCents":500}]', FRONTEND_URL: 'http://127.0.0.1:1' });
  const Services = helper.loadServices(), db = new Services.PrismaClient({ datasources: { db: { url } }, log: [] });
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ep-stripe-helper-test-'));
  const out = path.join(temp, 'evidence'), evidence = helper.evidenceWriter(out);
  let server, session, providerRefund;
  const events = new Map(), operationKeys = new Set();
  let customerCalls = 0, sessionCalls = 0, eventReads = 0, lostAcknowledgment = true;
  try {
    await db.$connect();
    assert.equal(await db.organization.count(), 0, 'Fresh empty fixture required');
    const broken = { organization: db.organization, $transaction: fn => db.$transaction(tx =>
      fn({ ...tx, $queryRaw: tx.$queryRaw.bind(tx), organization: tx.organization, subscription: { create: async () => { throw Error('synthetic rollback'); } } })) };
    await assert.rejects(helper.createCase(broken, Services, {}, evidence, 'OFFLINE_SIMULATED'), /rollback/);
    assert.equal(await db.organization.count(), 0);
    const sdk = { ...sdkBase(), customers: { create: async (_body, options) => {
      customerCalls++; assert.match(options.idempotencyKey, /^ai-wallet-test-customer:/);
      return { id: 'cus_synthetic', livemode: false };
    } }, checkout: { sessions: {
      create: async (params, options) => {
        sessionCalls++; operationKeys.add(options.idempotencyKey);
        assert.equal(params.line_items[0].price_data.unit_amount, 500);
        assert.equal(params.line_items[0].quantity, 1); assert.equal(params.mode, 'payment');
        session ||= { id: 'cs_test_synthetic', object: 'checkout.session', livemode: false, mode: params.mode,
          customer: params.customer, metadata: params.metadata, client_reference_id: params.client_reference_id,
          amount_total: 500, currency: 'usd', payment_status: 'unpaid', payment_intent: null,
          status: 'open', url: 'https://checkout.stripe.com/c/pay/synthetic' };
        if (lostAcknowledgment) { lostAcknowledgment = false; throw Error('synthetic lost ack'); }
        return session;
      },
      retrieve: async value => { assert.equal(value, session.id); return session; },
    } }, events: { retrieve: async eventId => {
      eventReads++; const e = events.get(eventId); if (!e) throw Error('not in this account');
      return { ...e, data: { object: Object.fromEntries(Object.entries(e.data.object).reverse()) }, pending_webhooks: 99 };
    } }, refunds: { retrieve: async () => providerRefund } };
    const gated = await helper.accountGate(sdk, 'acct_expected');
    const acceptance = await helper.createCase(db, Services, gated, evidence, 'OFFLINE_SIMULATED');
    await assert.rejects(acceptance.purchase()); assert.equal(customerCalls, 0);
    acceptance.confirmForwarder();
    await assert.rejects(acceptance.purchase(), /lost ack/);
    const result = await acceptance.purchase(); assert.equal(result.topupId, session.client_reference_id);
    await acceptance.purchase(); await assert.rejects(acceptance.purchase());
    assert.equal(operationKeys.size, 1); assert.equal(sessionCalls, 2); assert.equal(customerCalls, 1);
    assert.equal((await acceptance.snapshot()).attempts, 3);
    server = await helper.listen(signer, signing, acceptance, evidence);
    const port = server.address().port; ownedPorts.add(String(port));
    const send = (body, headers = {}, method = 'POST', urlPath = '/stripe') => new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, path: urlPath, method, headers }, res => {
        res.resume(); res.on('end', () => resolve(res.statusCode));
      });
      req.on('error', reject); req.end(body);
    });
    const deliver = async (e, changes = {}) => {
      const raw = JSON.stringify(e); events.set(e.id, e);
      const signature = signer.webhooks.generateTestHeaderString({ payload: raw, secret: signing });
      return send(raw, { 'stripe-signature': signature, ...changes });
    };
    assert.equal(await send('', {}, 'GET'), 405);
    assert.equal(await send('', {}, 'POST', '/purchase'), 404);
    assert.equal(await send('', {}, 'POST', '/stripe?token=anything'), 404);
    assert.equal(await send('private raw payload'), 400);
    assert.equal(await send('x'.repeat(helper.BODY_LIMIT + 1), { 'stripe-signature': 'synthetic' }), 413);
    const e = makeEvent({ ...session, payment_status: 'paid', payment_intent: 'pi_synthetic', status: 'complete' });
    const raw = JSON.stringify(e), signature = signer.webhooks.generateTestHeaderString({ payload: raw, secret: signing });
    assert.equal(await send(raw + ' ', { 'stripe-signature': signature }), 400, 'Verify exact raw bytes');
    assert.equal(await send(raw, { 'stripe-signature': signer.webhooks.generateTestHeaderString({
      payload: raw, secret: signing, timestamp: Math.floor(Date.now() / 1000) - 600 }) }), 400);
    assert.equal(await deliver(makeEvent(e.data.object, e.type, { livemode: true })), 400);
    assert.equal(await deliver(makeEvent(e.data.object, e.type, { account: 'acct_expected' })), 400);
    assert.equal(await deliver(makeEvent(e.data.object, e.type, { account: 'acct_other' })), 400);
    assert.equal(await deliver(makeEvent({ ...e.data.object, customer: 'cus_other' })), 400);
    assert.equal(await deliver(makeEvent({ ...e.data.object, id: 'cs_test_other' })), 400);
    assert.equal(await deliver(makeEvent({ ...e.data.object, payment_intent: { id: 'pi_synthetic', livemode: true } })), 400);
    assert.equal(await deliver(makeEvent(e.data.object, 'invoice.paid')), 400);
    assert.equal(eventReads, 0, 'Reject scope/live/account before event API lookup or funding');
    const absent = makeEvent(e.data.object);
    assert.equal(await send(JSON.stringify(absent), { 'stripe-signature': signer.webhooks.generateTestHeaderString({
      payload: JSON.stringify(absent), secret: signing }) }), 400);
    const mutated = makeEvent(e.data.object); events.set(mutated.id, { ...mutated, type: 'refund.created' });
    assert.equal(await send(JSON.stringify(mutated), { 'stripe-signature': signer.webhooks.generateTestHeaderString({
      payload: JSON.stringify(mutated), secret: signing }) }), 400);
    assert.equal((await acceptance.snapshot()).funding, 0);
    assert.equal(await deliver(e), 200);
    assert.equal(await deliver(e), 200);
    assert.equal(await deliver(makeEvent(e.data.object)), 200);
    let state = await acceptance.snapshot();
    assert.equal(state.balanceNanos, '5000000000'); assert.equal(state.funding, 1);
    assert.equal(await deliver(makeEvent({ ...e.data.object, customer: 'cus_other' })), 400);
    await acceptance.request();
    providerRefund = { id: 're_synthetic', object: 'refund', payment_intent: 'pi_synthetic', charge: 'ch_synthetic',
      amount: 500, currency: 'usd', status: 'succeeded' };
    const refund = makeEvent(providerRefund, 'refund.created');
    assert.equal(await deliver(refund), 200, 'Never hold genuine own-case events waiting for review');
    state = await acceptance.snapshot();
    assert.equal(state.status, 'REVIEW'); assert.equal(state.heldNanos, '5000000000');
    assert.equal(state.refundEvents, 1); assert.equal(state.reversals, 0);
    assert.equal(state.requestStatus, 'REQUESTED'); assert.equal(state.reconciliationState, undefined);
    assert.equal(state.refundOutcome, 'BLOCKED_REFUND_RECONCILIATION');
    const audit = await db.aiWalletRefundEvent.findUnique({ where: { eventId: refund.id } });
    await acceptance.review('re_synthetic', 'ch_synthetic');
    state = await acceptance.snapshot();
    assert.equal(state.status, 'REVIEW'); assert.equal(state.balanceNanos, '0'); assert.equal(state.heldNanos, '0');
    assert.equal(state.requestStatus, 'REFUNDED'); assert.equal(state.reconciliationState, 'SUCCEEDED');
    assert.equal(state.reversals, 1); assert.equal(state.refundOutcome, 'MONETARILY_RECONCILED_WALLET_FROZEN');
    await acceptance.review('re_synthetic', 'ch_synthetic');
    const restarted = new Services.Refunds({ model: db });
    assert.equal((await restarted.reviewTestTopup(state.organizationId, state.requestId, 'synthetic-restarted-reviewer',
      { topupId: state.topupId, refundId: 're_synthetic', chargeId: 'ch_synthetic' })).state, 'SUCCEEDED');
    assert.equal(await deliver(refund), 200); assert.equal((await acceptance.snapshot()).refundEvents, 1);
    assert.equal((await acceptance.snapshot()).reversals, 1);
    assert.deepEqual(await db.aiWalletRefundEvent.findUnique({ where: { eventId: refund.id } }), audit);
    await assert.rejects(db.aiWalletRefundEvent.update({ where: { eventId: refund.id }, data: { outcome: 'SUCCEEDED' } }), /immutable/);
    assert.equal(await deliver(makeEvent({ ...providerRefund, status: 'failed' }, 'refund.failed')), 200);
    state = await acceptance.snapshot();
    assert.equal(state.requestStatus, 'REFUNDED'); assert.equal(state.reconciliationState, 'UNCERTAIN');
    assert.equal(state.status, 'REVIEW'); assert.equal(state.reversals, 1);
    assert.equal(state.balanceNanos, '0'); assert.equal(state.heldNanos, '0');
    assert.equal(state.refundOutcome, 'DEBIT_RECORDED_REVIEW_REQUIRED');
    await acceptance.review('re_synthetic', 'ch_synthetic');
    assert.equal((await acceptance.snapshot()).refundOutcome, 'DEBIT_RECORDED_REVIEW_REQUIRED');
    assert.throws(() => evidence.append({ status: signing }));
    for (const field of ['requestStatus', 'reconciliationState', 'refundOutcome'])
      assert.throws(() => evidence.append({ [field]: signing }));
    evidence.append({ status: 'STOPPED_LOCAL_RESOURCES_CLOSED', rawBody: 'PII secret',
      signature: signing, url: 'https://checkout.stripe.com/client_secret' });
    const saved = fs.readFileSync(path.join(out, 'evidence.jsonl'), 'utf8');
    assert.match(saved, /OFFLINE_SIMULATED/); assert.match(saved, /BLOCKED_REFUND_RECONCILIATION/);
    assert.match(saved, /MONETARILY_RECONCILED_WALLET_FROZEN/); assert.match(saved, /DEBIT_RECORDED_REVIEW_REQUIRED/);
    assert.doesNotMatch(saved, /whsec_|sk_test_|PII|client_secret|stripe-signature|rawBody|https:/);
    await assert.rejects(helper.createCase(db, Services, gated, evidence), 'Never reuse existing tenants');
  } finally {
    if (server) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    await db.$disconnect();
    for (const file of fs.readdirSync(out)) fs.unlinkSync(path.join(out, file));
    fs.rmdirSync(out); fs.rmdirSync(temp);
  }
});
