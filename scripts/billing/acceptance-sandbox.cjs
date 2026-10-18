'use strict';
// Narrow adapter only: no app boot, .env, migration, paid AI, Refund.create or deletion.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const readline = require('node:readline');
const { spawnSync } = require('node:child_process');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '../..');
const app = path.join(root, 'postiz-app');
const appRequire = createRequire(path.join(app, 'package.json'));
const TYPES = new Set(['checkout.session.completed', 'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed', 'refund.created', 'refund.updated', 'refund.failed',
  'charge.refunded', 'charge.dispute.created', 'charge.dispute.updated', 'charge.dispute.closed',
  'charge.dispute.funds_withdrawn', 'charge.dispute.funds_reinstated']);
const BODY_LIMIT = 65536;
function requireSafe(ok) { if (!ok) throw Error('Sandbox guard refused operation.'); }
function fixture(value) {
  const u = new URL(value);
  requireSafe(['postgres:', 'postgresql:'].includes(u.protocol) && u.hostname === '127.0.0.1' &&
    Number(u.port) >= 49152 && Number(u.port) <= 65535 && u.pathname === '/ep_ai_wallet_test' && u.username === 'isolated' &&
    u.password === 'isolated' && !u.search && !u.hash);
  return u.href;
}
function listenPort(value, database) {
  requireSafe(typeof value === 'string' && /^[1-9][0-9]{4}$/.test(value) &&
    Number(value) >= 49152 && Number(value) <= 65535 && value !== new URL(database).port);
  return Number(value);
}
function config(env) {
  requireSafe(/^(sk|rk)_test_[A-Za-z0-9]+$/.test(env.STRIPE_SECRET_KEY || '') &&
    /^whsec_[A-Za-z0-9]+$/.test(env.STRIPE_SIGNING_KEY || '') &&
    /^acct_[A-Za-z0-9]{1,100}$/.test(env.EP_SANDBOX_ACCOUNT || ''));
  for (const key of Object.keys(env)) requireSafe(['PATH', 'HOME', 'LANG', 'TMPDIR',
    'EP_SANDBOX_ACCOUNT', 'EP_SANDBOX_EVIDENCE', 'EP_SANDBOX_FIXTURE', 'EP_SANDBOX_LISTEN_PORT',
    'STRIPE_SECRET_KEY', 'STRIPE_SIGNING_KEY'].includes(key));
  const database = fixture(env.EP_SANDBOX_FIXTURE);
  return { expected: env.EP_SANDBOX_ACCOUNT, database,
    port: listenPort(env.EP_SANDBOX_LISTEN_PORT, database), signing: env.STRIPE_SIGNING_KEY };
}
function loadServices() {
  appRequire('ts-node').register({ transpileOnly: true, project: path.join(app, 'tsconfig.json'),
    compilerOptions: { module: 'commonjs', target: 'es2020' } });
  const ts = appRequire('./tsconfig.base.json').compilerOptions;
  appRequire('tsconfig-paths').register({ baseUrl: app, paths: ts.paths });
  appRequire('reflect-metadata');
  return {
    Wallet: appRequire('./libraries/nestjs-libraries/src/database/prisma/ai-wallet/ai-wallet.service.ts').AiWalletService,
    Checkout: appRequire('./libraries/nestjs-libraries/src/services/ai-wallet-checkout.service.ts').AiWalletCheckoutService,
    Refunds: appRequire('./libraries/nestjs-libraries/src/services/ai-wallet-refund-request.service.ts').AiWalletRefundRequestService,
    PrismaClient: appRequire('@prisma/client').PrismaClient,
  };
}
const id = value => typeof value === 'string' ? value : value?.id;
function noLive(value) {
  if (!value || typeof value !== 'object') return;
  requireSafe(value.livemode !== true);
  for (const v of Object.values(value)) noLive(v);
}
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const fingerprint = event => crypto.createHash('sha256')
  .update(JSON.stringify(canonical([event.id, event.type, event.livemode, event.account || null, event.data.object]))).digest('hex');
async function accountGate(sdk, expected) {
  let verified = false;
  const account = await sdk.accounts.retrieve(); // Installed SDK: GET /v1/account, never /accounts/:id.
  requireSafe(account.object === 'account' && account.id === expected && account.deleted !== true);
  noLive(account); verified = true;
  const guarded = async (run) => { requireSafe(verified); const result = await run(); noLive(result); return result; };
  const testObject = async (run) => {
    const result = await guarded(run); requireSafe(result.livemode === false); return result;
  };
  // The only financial SDK capabilities passed into the Checkout production service.
  return {
    checkout: { customers: { create: (...args) => testObject(() => sdk.customers.create(...args)) },
      checkout: { sessions: { create: (...args) => testObject(() => sdk.checkout.sessions.create(...args)),
        retrieve: (...args) => testObject(() => sdk.checkout.sessions.retrieve(...args)) } } },
    event: eventId => guarded(() => sdk.events.retrieve(eventId)),
    refund: refundId => guarded(() => sdk.refunds.retrieve(refundId)),
    session: sessionId => testObject(() => sdk.checkout.sessions.retrieve(sessionId)),
  };
}
function evidenceWriter(directory) {
  const out = path.resolve(directory);
  requireSafe(out !== root && !out.startsWith(root + path.sep));
  fs.mkdirSync(out, { mode: 0o700 }); // New directory only. Never overwrite an old run.
  let count = 0;
  return {
    append(record) {
      // No arbitrary provider strings, raw bodies, signatures, PII or URL enter this interface.
      const safe = {};
      const statuses = new Set(['ACTIVE', 'REVIEW', 'EMPTY', 'DISPATCHED', 'ACCOUNT_VERIFIED', 'LISTENING',
        'BLOCKED_REFUND_RECONCILIATION', 'MONETARILY_RECONCILED',
        'MONETARILY_RECONCILED_WALLET_FROZEN', 'DEBIT_RECORDED_REVIEW_REQUIRED', 'OPERATOR_CONFIRMED_FORWARDER_READY',
        'REJECTED_OR_RETRY_REQUIRED', 'STOPPED_LOCAL_RESOURCES_CLOSED']);
      requireSafe(record.status === undefined || statuses.has(record.status));
      requireSafe(record.refundOutcome === undefined || ['BLOCKED_REFUND_RECONCILIATION',
        'MONETARILY_RECONCILED', 'MONETARILY_RECONCILED_WALLET_FROZEN',
        'DEBIT_RECORDED_REVIEW_REQUIRED'].includes(record.refundOutcome));
      requireSafe(record.requestStatus === undefined || ['REQUESTED', 'WITHDRAWN', 'REJECTED', 'REFUNDED'].includes(record.requestStatus));
      requireSafe(record.reconciliationState === undefined || ['PENDING', 'SUCCEEDED', 'FAILED', 'UNCERTAIN'].includes(record.reconciliationState));
      requireSafe(record.source === undefined || ['OFFLINE_SIMULATED', 'live_operator_run',
        'SIGNED_HTTP_ACCOUNT_VERIFIED_TRANSPORT_UNATTESTED'].includes(record.source));
      for (const key of ['source', 'status', 'eventId', 'type', 'hash', 'head', 'accountId', 'organizationId',
        'topupId', 'sessionId', 'paymentId', 'customerId', 'requestId', 'refundId', 'chargeId',
        'balanceNanos', 'heldNanos', 'funding', 'reversals', 'refundEvents', 'attempts', 'port',
        'requestStatus', 'reconciliationState', 'refundOutcome']) {
        const value = record[key];
        if (value !== undefined) {
          requireSafe((typeof value === 'number' && Number.isSafeInteger(value)) ||
            (typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,200}$/.test(value)));
          safe[key] = value;
        }
      }
      fs.appendFileSync(path.join(out, 'evidence.jsonl'), JSON.stringify({ sequence: ++count, ...safe }) + '\n',
        { mode: 0o600, flag: 'a' });
    },
  };
}
function refundOutcome(record) {
  const debited = record.requestStatus === 'REFUNDED' || record.reversals > 0;
  const reconciled = record.requestStatus === 'REFUNDED' && record.reconciliationState === 'SUCCEEDED' &&
    record.funding === 1 && record.reversals === 1 && record.balanceNanos === '0' && record.heldNanos === '0';
  if (reconciled && ['ACTIVE', 'REVIEW'].includes(record.status)) return record.status === 'REVIEW'
    ? 'MONETARILY_RECONCILED_WALLET_FROZEN' : 'MONETARILY_RECONCILED';
  if (debited) return 'DEBIT_RECORDED_REVIEW_REQUIRED';
  if (record.status === 'REVIEW') return 'BLOCKED_REFUND_RECONCILIATION';
}
async function createCase(db, Services, gated, evidence, source = 'SIGNED_HTTP_ACCOUNT_VERIFIED_TRANSPORT_UNATTESTED') {
  // A new run refuses ALL existing tenants, including its own interrupted prior run.
  const organizationId = 'stripe-acceptance-' + crypto.randomUUID();
  await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(182736451, 1)::text`;
    requireSafe(await tx.organization.count() === 0);
    await tx.organization.create({ data: { id: organizationId, name: 'Synthetic local Stripe acceptance' } });
    await tx.subscription.create({ data: { organizationId, subscriptionTier: 'LAUNCH_V1', totalChannels: 0, period: 'MONTHLY' } });
  });
  const wallet = new Services.Wallet({ model: db });
  const refunds = new Services.Refunds({ model: db });
  const checkout = new Services.Checkout(db, wallet, refunds);
  checkout.client = () => gated.checkout;
  const operation = crypto.randomUUID(), refundOperation = crypto.randomUUID();
  let attempts = 0, busy = false, requestId, forwarderReady = false;
  async function topup() { return db.aiWalletTopup.findFirst({ where: { organizationId } }); }
  async function snapshot() {
    // One database view prevents a concurrent event from mixing pre/post-debit state.
    const record = await db.$transaction(async tx => {
      const row = await tx.aiWallet.findUnique({ where: { organizationId } });
      const t = await tx.aiWalletTopup.findFirst({ where: { organizationId } });
      const request = await tx.aiWalletRefundRequest.findFirst({ where: { organizationId },
        include: { reconciliation: true }, orderBy: { createdAt: 'desc' } });
      return { source, status: row?.status || 'EMPTY', organizationId, topupId: t?.id,
        sessionId: t?.sessionId || undefined, paymentId: t?.paymentId || undefined, customerId: t?.customerId,
        requestId: request?.id, requestStatus: request?.status, reconciliationState: request?.reconciliation?.state,
        balanceNanos: String(row?.balanceNanos || 0n), heldNanos: String(row?.heldNanos || 0n),
        funding: await tx.aiWalletLedger.count({ where: { organizationId, kind: 'FUNDING' } }),
        reversals: await tx.aiWalletLedger.count({ where: { organizationId, kind: 'REVERSAL' } }),
        refundEvents: await tx.aiWalletRefundEvent.count({ where: { organizationId } }), attempts };
    }, { isolationLevel: 'RepeatableRead' });
    record.refundOutcome = refundOutcome(record);
    evidence.append(record); return record;
  }
  return {
    snapshot,
    confirmForwarder() { forwarderReady = true; evidence.append({ status: 'OPERATOR_CONFIRMED_FORWARDER_READY' }); },
    async purchase() {
      requireSafe(forwarderReady && !busy && attempts < 3); busy = true; attempts++;
      try {
        const value = await checkout.createCheckout(organizationId, 'usd_500', operation);
        requireSafe(await db.aiWalletTopup.count({ where: { organizationId } }) === 1);
        await snapshot(); return value; // URL only to operator TTY, never evidence.
      } finally { busy = false; }
    },
    async request() {
      const r = await refunds.request(organizationId, 'synthetic-local-operator', refundOperation);
      requestId = r.id; await snapshot(); return r.id;
    },
    async review(refundId, chargeId) {
      requireSafe(/^re_[A-Za-z0-9]+$/.test(refundId) && /^ch_[A-Za-z0-9]+$/.test(chargeId));
      const t = await topup();
      requireSafe(t?.fundedAt && requestId);
      const actual = await gated.refund(refundId); // Read only; never creates a refund.
      noLive(actual);
      requireSafe(actual.id === refundId && id(actual.payment_intent) === t.paymentId &&
        id(actual.charge) === chargeId && actual.amount === 500 && actual.currency === 'usd');
      await refunds.reviewTestTopup(organizationId, requestId, 'synthetic-local-operator',
        { topupId: t.id, refundId, chargeId });
      await snapshot();
    },
    async deliver(event) {
      requireSafe(TYPES.has(event.type) && /^evt_[A-Za-z0-9_]+$/.test(event.id) &&
        event.object === 'event' && event.livemode === false && !event.account);
      noLive(event);
      const t = await topup(), object = event.data.object;
      requireSafe(t && t.amountCents === 500 && t.currency === 'usd');
      if (event.type.startsWith('checkout.')) {
        requireSafe(object.id === t.sessionId && id(object.customer) === t.customerId &&
          object.client_reference_id === t.id && object.metadata?.topupId === t.id &&
          object.metadata?.service === 'everywhereposter-ai-wallet-test' &&
          (!t.paymentId || id(object.payment_intent) === t.paymentId));
      } else {
        // Early refunds must reach production quarantine even before funding binds its PI.
        let paymentId = t.paymentId;
        if (!paymentId && t.sessionId) {
          const session = await gated.session(t.sessionId);
          requireSafe(session.id === t.sessionId && id(session.customer) === t.customerId &&
            session.client_reference_id === t.id && session.metadata?.topupId === t.id &&
            session.metadata?.service === 'everywhereposter-ai-wallet-test' &&
            session.amount_total === 500 && session.currency === 'usd' && session.mode === 'payment');
          paymentId = id(session.payment_intent);
        }
        requireSafe(paymentId && id(object.payment_intent) === paymentId &&
          (!object.customer || id(object.customer) === t.customerId));
      }
      // Verify this event exists under the expected account. Dispatch the ORIGINAL signed event.
      const actual = await gated.event(event.id);
      requireSafe(actual.livemode === false && !actual.account && fingerprint(actual) === fingerprint(event));
      await checkout.handleVerifiedEvent(event); // Immediate: no queue, holds, re-signing or API-payload substitution.
      evidence.append({ source, status: 'DISPATCHED', eventId: event.id, type: event.type, hash: fingerprint(event) });
      await snapshot();
    },
  };
}
async function listen(signer, signing, acceptance, evidence, port = 0) {
  requireSafe(Number.isInteger(port) && (port === 0 || (port >= 49152 && port <= 65535)));
  let requests = 0, reads = 0;
  const server = http.createServer((req, res) => {
    const reply = code => { if (!res.writableEnded) { res.writeHead(code); res.end(); } };
    if (req.url !== '/stripe') { reply(404); req.resume(); return; }
    if (req.method !== 'POST') { reply(405); req.resume(); return; }
    if (++requests > 100) { reply(429); req.resume(); return; }
    const signature = req.headers['stripe-signature'];
    if (typeof signature !== 'string' || signature.length > 2048 || req.headers['content-encoding']) {
      reply(400); req.resume(); return;
    }
    if (Number(req.headers['content-length']) > BODY_LIMIT) { reply(413); req.resume(); return; }
    let size = 0, chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > BODY_LIMIT) { chunks = []; reply(413); }
      else if (size <= BODY_LIMIT && !res.writableEnded) chunks.push(chunk);
    });
    req.on('error', () => reply(400));
    req.on('end', async () => {
      if (res.writableEnded) return;
      try {
        const raw = Buffer.concat(chunks); chunks = [];
        const event = signer.webhooks.constructEvent(raw, signature, signing, 300);
        requireSafe(++reads <= 100);
        await acceptance.deliver(event);
        reply(200);
      } catch {
        try { evidence.append({ status: 'REJECTED_OR_RETRY_REQUIRED' }); } catch { /* Fail closed even on full disk. */ }
        reply(400); // No raw provider errors, payloads, stack traces or signatures.
      }
    });
  });
  server.requestTimeout = 10000; server.headersTimeout = 5000; server.maxConnections = 8;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  evidence.append({ status: 'LISTENING', port: server.address().port });
  return server;
}
async function main() {
  requireSafe(process.stdin.isTTY && process.stdout.isTTY && process.argv.length === 2);
  const cfg = config(process.env);
  const state = spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' });
  requireSafe(state.status === 0 && !state.stdout.trim());
  const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
  requireSafe(head.status === 0);
  const evidence = evidenceWriter(process.env.EP_SANDBOX_EVIDENCE);
  const Stripe = appRequire('stripe');
  const sdk = new Stripe(process.env.STRIPE_SECRET_KEY, { maxNetworkRetries: 0, timeout: 15000 });
  let db, server, terminal;
  try {
    const gated = await accountGate(sdk, cfg.expected); // No DB/customer/session mutations before this.
    evidence.append({ source: 'live_operator_run', status: 'ACCOUNT_VERIFIED', accountId: cfg.expected, head: head.stdout.trim() });
    Object.assign(process.env, { BILLING_ENABLED: 'true', AI_WALLET_ENABLED: 'true', AI_WALLET_TEST_REFUNDS_ENABLED: 'true',
      AI_WALLET_TEST_OFFERS: '[{"id":"usd_500","amountCents":500}]', FRONTEND_URL: 'http://127.0.0.1:1' });
    const Services = loadServices();
    db = new Services.PrismaClient({ datasources: { db: { url: cfg.database } }, log: [] });
    await db.$connect();
    const acceptance = await createCase(db, Services, gated, evidence);
    server = await listen(sdk, cfg.signing, acceptance, evidence, cfg.port);
    console.log('Loopback signed webhook endpoint: http://127.0.0.1:' + server.address().port + '/stripe');
    console.log('External forwarding/registration is NOT configured. Separate approval/setup is required.');
    console.log('Terminal commands: confirm-forwarder-ready | purchase usd_500 | request-refund | review re_ID ch_ID | status | quit');
    console.log('Signed refund events dispatch immediately. Explicit review may reconcile money while the wallet stays REVIEW.');
    terminal = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true, historySize: 0 });
    for await (const line of terminal) {
      const command = line.trim().split(/\s+/);
      if (command.length === 1 && command[0] === 'quit') break;
      try {
        if (command.join(' ') === 'confirm-forwarder-ready') acceptance.confirmForwarder();
        else if (command.join(' ') === 'purchase usd_500') {
          const result = await acceptance.purchase();
          requireSafe(['open', 'complete', 'expired', 'funded'].includes(result.status));
          console.log('Checkout status: ' + result.status);
          if (result.url) {
            const tty = fs.openSync('/dev/tty', 'w');
            try { fs.writeSync(tty, result.url + '\n'); } finally { fs.closeSync(tty); }
          }
        } else if (command.join(' ') === 'request-refund') await acceptance.request();
        else if (command.length === 3 && command[0] === 'review') await acceptance.review(command[1], command[2]);
        else requireSafe(command.join(' ') === 'status');
        console.log(JSON.stringify(await acceptance.snapshot()));
      } catch { console.log('Operation refused/failed. Inspect redacted status; no automatic retry.'); }
    }
  } finally {
    terminal?.close();
    if (server) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    await db?.$disconnect();
    delete process.env.STRIPE_SECRET_KEY; delete process.env.STRIPE_SIGNING_KEY;
    evidence.append({ status: 'STOPPED_LOCAL_RESOURCES_CLOSED' });
  }
}
module.exports = { fixture, listenPort, refundOutcome, config, loadServices, accountGate, evidenceWriter, createCase, listen, fingerprint, BODY_LIMIT };
if (require.main === module) main().catch(() => { console.error('Sandbox stopped. Details suppressed to protect credentials.'); process.exitCode = 1; });
