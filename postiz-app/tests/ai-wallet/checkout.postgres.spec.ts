import { readFileSync } from 'fs';
import { resolve } from 'path';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { validateSync } from 'class-validator';
import { AiWalletTopupDto } from '@gitroom/nestjs-libraries/dtos/billing/ai-wallet-topup.dto';
import Stripe from 'stripe';
import { AiWalletTextService } from '@gitroom/nestjs-libraries/services/ai-wallet-text.service';
import { AiWalletService } from '@gitroom/nestjs-libraries/database/prisma/ai-wallet/ai-wallet.service';
import { AiWalletCheckoutService, AI_WALLET_TEST_SERVICE } from '@gitroom/nestjs-libraries/services/ai-wallet-checkout.service';
import { StripeController } from '../../apps/backend/src/api/routes/stripe.controller';
import { BillingController } from '../../apps/backend/src/api/routes/billing.controller';

jest.mock('@gitroom/nestjs-libraries/services/stripe.service', () => ({ StripeService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service', () => ({ SubscriptionService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/notifications/notification.service', () => ({ NotificationService: class {} }));
jest.mock('@gitroom/nestjs-libraries/crypto/nowpayments', () => ({ Nowpayments: class {} }));
jest.mock('@gitroom/helpers/auth/auth.service', () => ({ AuthService: class {} }));

const fixtureUrl = process.env.AI_WALLET_TEST_DATABASE_URL;
const suite = fixtureUrl ? describe : describe.skip;
const fixtureEnv = { BILLING_ENABLED: 'true', AI_WALLET_ENABLED: 'true',
  STRIPE_SECRET_KEY: 'sk_test_synthetic_not_a_credential', STRIPE_SIGNING_KEY: 'whsec_synthetic_fixture',
  FRONTEND_URL: 'http://localhost:4200', AI_WALLET_TEST_OFFERS: '[{"id":"synthetic","amountCents":123}]' };
const originalEnv = Object.fromEntries(Object.keys(fixtureEnv).map((key) => [key, process.env[key]]));

suite('test-only Checkout -> signed webhook -> prepaid usage', () => {
  let db: PrismaClient, wallet: AiWalletService, checkout: AiWalletCheckoutService;
  let hook: StripeController, billing: BillingController, org: string;
  let sessions: Map<string, any>, sdk: any;
  const signer = new Stripe('sk_test_synthetic_not_a_credential');

  beforeAll(async () => {
    const url = new URL(fixtureUrl!);
    if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/ep_ai_wallet_test') throw Error('Isolated wallet fixture required');
    db = new PrismaClient({ datasources: { db: { url: fixtureUrl } } }); await db.$connect();
  });
  beforeEach(async () => {
    Object.assign(process.env, fixtureEnv);
    org = `checkout-test-${randomUUID()}`;
    await db.organization.create({ data: { id: org, name: 'Synthetic Checkout fixture', paymentId: 'cus_synthetic' } });
    wallet = new AiWalletService({ model: db } as any);
    checkout = new AiWalletCheckoutService(db as any, wallet);
    jest.spyOn(checkout, 'assertPrepaidPlan').mockResolvedValue(undefined);
    sessions = new Map();
    sdk = { accounts: { retrieve: jest.fn(async () => ({ id: 'acct_synthetic' })) },
      customers: { retrieve: jest.fn(async (id: string) => ({ id, livemode: false })),
      create: jest.fn(async (_body: any, options: any) => ({ id: `cus_test_${options.idempotencyKey}`, livemode: false })) }, checkout: { sessions: {
      create: jest.fn(async (params: any, options: any) => {
        if (!sessions.has(options.idempotencyKey)) sessions.set(options.idempotencyKey, {
          id: `cs_test_${params.client_reference_id}`, livemode: false, mode: params.mode, customer: params.customer,
          client_reference_id: params.client_reference_id, metadata: params.metadata, currency: 'usd',
          amount_total: params.line_items[0].price_data.unit_amount, payment_status: 'unpaid', payment_intent: null,
          status: 'open', url: 'https://checkout.stripe.com/c/pay/synthetic',
        });
        return sessions.get(options.idempotencyKey);
      }),
      retrieve: jest.fn(async (id: string) => [...sessions.values()].find((value) => value.id === id)),
    } } };
    jest.spyOn(checkout as any, 'client').mockReturnValue(sdk);
    hook = new StripeController({ validateRequest: (raw: Buffer, signature: string, secret: string) =>
      signer.webhooks.constructEvent(raw, signature, secret) } as any, checkout);
    billing = new BillingController({} as any, {} as any, {} as any, {} as any, checkout);
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await db?.$disconnect();
  });

  const create = (key = randomUUID()) => checkout.createCheckout(org, 'synthetic', key);
  const session = () => [...sessions.values()][0];
  const event = (value: any, overrides: any = {}) => ({ id: `evt_${randomUUID()}`, object: 'event',
    livemode: false, type: 'checkout.session.completed', data: { object: value }, ...overrides });
  const request = (value: any) => {
    const payload = JSON.stringify(value);
    return { rawBody: Buffer.from(payload), headers: { 'stripe-signature': signer.webhooks.generateTestHeaderString({
      payload, secret: fixtureEnv.STRIPE_SIGNING_KEY }) } } as any;
  };
  const deliver = (value: any, overrides: any = {}) => hook.stripe(request(event(value, overrides)));
  const paid = () => ({ ...session(), payment_status: 'paid', payment_intent: `pi_${session().id}`, status: 'complete' });

  it('validates bounded offer and operation identities at the HTTP DTO boundary', () => {
    expect(validateSync(Object.assign(new AiWalletTopupDto(), { offerId: 'synthetic', operationKey: 'request_1' }))).toHaveLength(0);
    expect(validateSync(Object.assign(new AiWalletTopupDto(), { offerId: 123, operationKey: 'x'.repeat(101) }))).toHaveLength(2);
  });

  it('fails closed with disabled flags, live credentials and an empty catalogue before SDK calls', async () => {
    process.env.BILLING_ENABLED = 'false'; await expect(create()).rejects.toThrow('disabled');
    process.env.BILLING_ENABLED = 'true'; process.env.AI_WALLET_ENABLED = 'false'; await expect(create()).rejects.toThrow('disabled');
    process.env.AI_WALLET_ENABLED = 'true'; process.env.STRIPE_SECRET_KEY = 'sk_live_not_a_credential';
    await expect(create()).rejects.toThrow('test account');
    process.env.STRIPE_SECRET_KEY = fixtureEnv.STRIPE_SECRET_KEY; process.env.AI_WALLET_TEST_OFFERS = '[]';
    await expect(create()).rejects.toThrow('configured test');
    expect(sdk.checkout.sessions.create).not.toHaveBeenCalled();
    expect(await db.aiWalletTopup.count({ where: { organizationId: org } })).toBe(0);
  });

  it('keeps both Compose paths as optional host pass-through rather than injecting a disabling override', () => {
    for (const path of ['../docker-compose.yaml', 'docker-compose.yaml']) {
      const source = readFileSync(resolve(process.cwd(), path), 'utf8');
      expect(source).toMatch(/AI_WALLET_TEST_OFFERS: # Host pass-through;/);
      expect(source).not.toContain('${AI_WALLET_TEST_OFFERS:-');
    }
  });

  it('offers only approved manual packs by default without granting trial or return-page credit', async () => {
    delete process.env.AI_WALLET_TEST_OFFERS;
    await expect(checkout.offers(org)).resolves.toEqual([500, 1000, 2500].map(amountCents => ({ id: `usd_${amountCents}`, amountCents })));
    for (const amountCents of [500, 1000, 2500]) {
      await billing.createWalletTopup({ id: org, users: [{ role: 'ADMIN' }] } as any,
        { offerId: `usd_${amountCents}`, operationKey: `approved_${amountCents}` });
      const payload = sdk.checkout.sessions.create.mock.calls.at(-1)[0];
      expect(payload).toMatchObject({ mode: 'payment', line_items: [{ price_data: { currency: 'usd', unit_amount: amountCents }, quantity: 1 }] });
      expect(payload.subscription_data).toBeUndefined();
    }
    expect((await checkout.balance(org)).balanceNanos).toBe('0');
    expect(await db.aiWalletLedger.count({ where: { organizationId: org } })).toBe(0);
    process.env.AI_WALLET_TEST_OFFERS = '[]'; await expect(checkout.offers(org)).resolves.toEqual([]);
    process.env.AI_WALLET_TEST_OFFERS = ''; await expect(checkout.offers(org)).rejects.toThrow('Invalid test');
  });

  it.each(['not-json', '[{"id":"a","amountCents":1.5}]',
    '[{"id":"a","amountCents":100},{"id":"a","amountCents":200}]'])('rejects invalid catalogue %s', async (catalogue) => {
    process.env.AI_WALLET_TEST_OFFERS = catalogue;
    await expect(checkout.offers(org)).rejects.toThrow('Invalid test top-up');
  });

  it('uses server org/customer/amount, requires an administrator, and ignores forged body amounts', async () => {
    const body = { offerId: 'synthetic', operationKey: 'request_1', amountCents: 1, organizationId: 'forged' };
    expect(() => billing.createWalletTopup({ id: org, users: [{ role: 'USER' }] } as any, body)).toThrow('administrator');
    await billing.createWalletTopup({ id: org, users: [{ role: 'ADMIN' }] } as any, body);
    const [payload] = sdk.checkout.sessions.create.mock.calls[0];
    expect(payload).toMatchObject({ mode: 'payment', customer: 'cus_synthetic', payment_method_types: ['card'],
      line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: 123 } }] });
    expect(payload).not.toHaveProperty('subscription_data');
    expect((await checkout.balance(org)).balanceNanos).toBe('0');
  });

  it('opts this card-only prepaid session out of an account Managed Payments default', async () => {
    const original = sdk.checkout.sessions.create.getMockImplementation();
    sdk.checkout.sessions.create.mockImplementation(async (params: any, options: any) => {
      if (params.managed_payments?.enabled !== false) throw new Stripe.errors.StripeInvalidRequestError({
        type: 'invalid_request_error', param: 'payment_method_types', message: 'Synthetic Managed Payments default',
      });
      return original(params, options);
    });
    await create('direct_merchant');
    expect(sdk.checkout.sessions.create.mock.calls[0][0]).toMatchObject({
      managed_payments: { enabled: false }, payment_method_types: ['card'], mode: 'payment',
    });
    expect((await checkout.balance(org)).balanceNanos).toBe('0');
  });

  it('serializes the documented opt-out through the pinned SDK without an external request', async () => {
    const transport = jest.fn(async (_url: any, init: any) => {
      if (String(_url).includes('/v1/account')) return new Response(JSON.stringify({ id: 'acct_synthetic', object: 'account' }), { status: 200 });
      if (String(_url).includes('/v1/customers/')) return new Response(JSON.stringify({ id: 'cus_synthetic', object: 'customer', livemode: false }), { status: 200 });
      const body = new URLSearchParams(init.body);
      expect(body.get('managed_payments[enabled]')).toBe('false');
      expect(body.get('payment_method_types[0]')).toBe('card');
      expect(init.method).toBe('POST');
      const topupId = body.get('client_reference_id');
      expect(new Map(init.headers).get('Idempotency-Key')).toBe(`ai-wallet-topup:${topupId}`);
      return new Response(JSON.stringify({ id: `cs_test_serialized_${topupId}`, livemode: false, mode: 'payment',
        customer: 'cus_synthetic', client_reference_id: topupId,
        metadata: { service: AI_WALLET_TEST_SERVICE, topupId }, currency: 'usd', amount_total: 123,
        status: 'open', url: 'https://checkout.stripe.com/c/pay/synthetic' }),
        { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const actual = new Stripe(fixtureEnv.STRIPE_SECRET_KEY, { maxNetworkRetries: 0, telemetry: false,
      httpClient: Stripe.createFetchHttpClient(transport) });
    (checkout as any).client.mockReturnValue(actual);
    await create('serialized_direct_merchant');
    expect(transport).toHaveBeenCalledTimes(3);
  });

  it('preserves customer, topup and idempotency when retrying a parameter-validation refusal', async () => {
    await db.organization.update({ where: { id: org }, data: { paymentId: null } });
    sdk.checkout.sessions.create.mockRejectedValueOnce(new Stripe.errors.StripeInvalidRequestError({
      type: 'invalid_request_error', param: 'payment_method_types', message: 'Synthetic validation refusal',
    }));
    await expect(create('validation_retry')).rejects.toThrow('Synthetic validation refusal');
    const topup = await db.aiWalletTopup.findFirstOrThrow({ where: { organizationId: org } });
    expect(topup).toMatchObject({ sessionId: null, paymentId: null, fundedAt: null });
    expect(await db.aiWalletLedger.count({ where: { organizationId: org } })).toBe(0);
    await create('validation_retry');
    expect(sdk.customers.create).toHaveBeenCalledTimes(1);
    expect(await db.aiWalletTopup.count({ where: { organizationId: org } })).toBe(1);
    expect(sdk.checkout.sessions.create.mock.calls[0]).toEqual(sdk.checkout.sessions.create.mock.calls[1]);
    expect(sdk.checkout.sessions.create.mock.calls[1][1].idempotencyKey).toBe(`ai-wallet-topup:${topup.id}`);
    expect((await checkout.balance(org)).balanceNanos).toBe('0');
  });

  it('binds one test customer for a new organization under concurrent Checkout requests', async () => {
    await db.organization.update({ where: { id: org }, data: { paymentId: null } });
    await Promise.all([create('new_org'), create('new_org')]);
    const saved = await db.organization.findUniqueOrThrow({ where: { id: org } });
    expect(saved.paymentId).toBe(`cus_test_ai-wallet-test-customer:${org}`);
    expect(new Set(sdk.customers.create.mock.calls.map((call: any) => call[1].idempotencyKey)).size).toBe(1);
    expect(sessions.size).toBe(1);
  });

  it('reuses one intent/session across concurrent retries without granting return-page credits', async () => {
    const results = await Promise.all([create('same_operation'), create('same_operation'), create('same_operation')]);
    expect(new Set(results.map((value) => value.topupId)).size).toBe(1);
    expect(sessions.size).toBe(1);
    expect(await db.aiWalletTopup.count({ where: { organizationId: org } })).toBe(1);
    await create('same_operation'); expect(sdk.checkout.sessions.retrieve).toHaveBeenCalled();
    expect((await checkout.balance(org)).balanceNanos).toBe('0');
  });

  it('accepts signed paid events exactly once then reserves/settles synthetic usage with visible costs', async () => {
    await create(); const receipt = paid(); const duplicate = event(receipt);
    await Promise.all([hook.stripe(request(duplicate)), hook.stripe(request(duplicate)), deliver(receipt)]);
    const reservation = await wallet.reserve(org, 'synthetic_usage', 'synthetic', 'offline-model', 10000000n);
    expect((await wallet.dispatch(org, reservation.id)).dispatch).toBe(true);
    await wallet.settle(org, reservation.id, 3000000n, `offline_usage_${reservation.id}`);
    const balance = await checkout.balance(org);
    expect(balance).toMatchObject({ balanceNanos: '1227000000', heldNanos: '0', availableNanos: '1227000000' });
    expect(balance.entries.map((value) => value.kind).sort()).toEqual(['FUNDING', 'USAGE']);
    expect(balance.entries.find((value) => value.kind === 'USAGE')?.amountNanos).toBe('3000000');
    expect(JSON.parse(JSON.stringify(balance)).currency).toBe('usd');
  });

  it('funds once, executes authorized text once, then replays after revocation without a new debit', async () => {
    jest.spyOn(checkout, 'assertPrepaidPlan').mockRestore();
    await db.subscription.create({ data: { organizationId: org, subscriptionTier: 'LAUNCH_V1', totalChannels: 0, period: 'MONTHLY' } });
    await create(); await deliver(paid());
    const original = [process.env.AI_WALLET_TEXT_ENABLED, process.env.AI_WALLET_TEXT_RATE_CARDS];
    try {
      process.env.AI_WALLET_TEXT_ENABLED = 'true';
      process.env.AI_WALLET_TEXT_RATE_CARDS = JSON.stringify({ 'gpt-6-luna': { billingContext: 'standard-text-receipt-no-extra-charges',
        rateVersion: 'synthetic', per: '1', rates: { inputUncachedLow: '2', inputCachedLow: '1', outputLow: '5',
          inputUncachedHigh: '4', inputCachedHigh: '2', outputHigh: '8' } } });
      const adapter = new AiWalletTextService(wallet), key = `guided-text:${randomUUID()}:summary`;
      const body = { model: 'gpt-6-luna', reasoning_effort: 'none', messages: [{ role: 'user', content: 'Synthetic facts' }],
        response_format: { type: 'json_schema', json_schema: {} } };
      const invoke = jest.fn(async () => ({ id: randomUUID(), model: body.model, service_tier: 'default',
        choices: [{ finish_reason: 'stop', message: { parsed: { text: 'Synthetic draft' } } }],
        usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13, prompt_tokens_details: { cached_tokens: 2 } } }));
      const run = (operation = key, allowed = true) => adapter.run(org, operation, 'a'.repeat(64), body, allowed, invoke);
      await run(); await db.subscription.delete({ where: { organizationId: org } });
      await run(key, false); await expect(run(`${key}-new`)).rejects.toThrow('not included');
      expect(invoke).toHaveBeenCalledTimes(1);
      expect(await db.aiWallet.findUniqueOrThrow({ where: { organizationId: org } })).toMatchObject({ balanceNanos: 1229999960n });
      expect(await db.aiWalletLedger.count({ where: { organizationId: org, kind: 'USAGE' } })).toBe(1);
    } finally {
      ['AI_WALLET_TEXT_ENABLED', 'AI_WALLET_TEXT_RATE_CARDS'].forEach((key, i) => {
        if (original[i] === undefined) delete process.env[key]; else process.env[key] = original[i];
      });
    }
  });

  it.each(['charge.refunded', 'refund.created', 'charge.dispute.created', 'charge.dispute.closed'])('records the unsupported %s wallet reconciliation gap', async type => {
    await create(); await deliver(paid());
    const object = { id: `fixture_${type}`, object: type.startsWith('charge.dispute') ? 'dispute' : type.startsWith('refund') ? 'refund' : 'charge',
      amount: 123, amount_refunded: 123, currency: 'usd', payment_intent: paid().payment_intent, metadata: {} };
    const receipt = request(event(object, { type }));
    await hook.stripe(receipt); await hook.stripe(receipt);
    // Characterization of a launch blocker, NOT successful refund/dispute acceptance.
    expect((await checkout.balance(org)).balanceNanos).toBe('1230000000');
    expect(await db.aiWalletLedger.count({ where: { organizationId: org } })).toBe(1);
  });

  it.each([{ customer: 'cus_other' }, { amount_total: 1 }, { currency: 'eur' },
    { metadata: { service: AI_WALLET_TEST_SERVICE, topupId: 'forged' } },
    { client_reference_id: 'forged' }, { livemode: true }, { id: 'cs_unknown' }])('rejects signed mismatched receipt %j', async (changes) => {
    await create(); await expect(deliver({ ...paid(), ...changes })).rejects.toThrow();
    expect((await checkout.balance(org)).balanceNanos).toBe('0');
    expect(await db.aiWalletPaymentEvent.count({ where: { organizationId: org } })).toBe(0);
  });

  it('recovers a lost creation acknowledgment with the same provider idempotency key', async () => {
    const original = sdk.checkout.sessions.create.getMockImplementation();
    sdk.checkout.sessions.create.mockImplementationOnce(async (...args: any[]) => {
      await original(...args); throw Error('synthetic lost acknowledgment');
    });
    await expect(create('lost_ack')).rejects.toThrow('lost acknowledgment');
    await create('lost_ack');
    expect(sessions.size).toBe(1);
    await deliver(paid());
    expect((await checkout.balance(org)).balanceNanos).toBe('1230000000');
  });

  it('retains exact dispatch identity across response loss, restart and changed provider retention', async () => {
    const original = sdk.checkout.sessions.create.getMockImplementation();
    sdk.checkout.sessions.create.mockImplementationOnce(async (...args: any[]) => {
      await original(...args); throw Error('lost response');
    });
    await expect(create('restart')).rejects.toThrow('lost response');
    const before = await db.aiWalletTopup.findFirstOrThrow({ where: { organizationId: org } });
    checkout = new AiWalletCheckoutService(db as any, new AiWalletService({ model: db } as any));
    jest.spyOn(checkout, 'assertPrepaidPlan').mockResolvedValue(undefined);
    jest.spyOn(checkout as any, 'client').mockReturnValue(sdk);
    await create('restart');
    const after = await db.aiWalletTopup.findUniqueOrThrow({ where: { id: before.id } });
    expect(after.firstDispatchedAt).toEqual(before.firstDispatchedAt);
    expect(after.requestFingerprint).toBe(before.requestFingerprint);
    expect(sdk.checkout.sessions.create.mock.calls[0]).toEqual(sdk.checkout.sessions.create.mock.calls[1]);
    expect(sessions.size).toBe(1);
  });

  it('never creates after the retry deadline and recovers a matching signed paid event indefinitely', async () => {
    const original = sdk.checkout.sessions.create.getMockImplementation();
    sdk.checkout.sessions.create.mockImplementationOnce(async (...args: any[]) => {
      await original(...args); throw Error('lost response');
    });
    await expect(create('late_ack')).rejects.toThrow('lost response');
    const row = await db.aiWalletTopup.findFirstOrThrow({ where: { organizationId: org } });
    const now = jest.spyOn(Date, 'now').mockReturnValue(row.firstDispatchedAt!.getTime() + 24 * 60 * 60 * 1000);
    await expect(create('late_ack')).rejects.toThrow('reconciliation');
    expect(sdk.checkout.sessions.create).toHaveBeenCalledTimes(1);
    now.mockRestore();
    await deliver(paid()); await deliver(paid());
    await expect(create('late_ack')).resolves.toMatchObject({ topupId: row.id, status: 'funded', url: null });
    expect((await checkout.balance(org)).balanceNanos).toBe('1230000000');
    expect(sdk.checkout.sessions.create).toHaveBeenCalledTimes(1);
  });

  it('commits dispatch before the network call and survives a crash before sending', async () => {
    const claim = wallet.claimTopupCheckout.bind(wallet);
    jest.spyOn(wallet, 'claimTopupCheckout').mockImplementationOnce(async (...args) => {
      await claim(...args); throw Error('crash after durable claim');
    });
    await expect(create('crash')).rejects.toThrow('crash');
    const row = await db.aiWalletTopup.findFirstOrThrow({ where: { organizationId: org } });
    expect(row).toMatchObject({ checkoutState: 'DISPATCHED', sessionId: null });
    expect(row.firstDispatchedAt).toBeInstanceOf(Date);
    expect(sdk.checkout.sessions.create).not.toHaveBeenCalled();
    await create('crash'); expect(sessions.size).toBe(1);
  });

  it('rejects changed account and immutable callback identity before another checkout', async () => {
    await create('identity');
    sdk.accounts.retrieve.mockResolvedValueOnce({ id: 'acct_other' });
    await expect(create('identity')).rejects.toThrow('identity');
    const url = process.env.FRONTEND_URL;
    try {
      process.env.FRONTEND_URL = 'https://other.example';
      await expect(create('identity')).rejects.toThrow('identity');
    } finally { process.env.FRONTEND_URL = url; }
    expect(sdk.checkout.sessions.create).toHaveBeenCalledTimes(1);
    sdk.accounts.retrieve.mockResolvedValueOnce({ id: 'acct_other' });
    await expect(deliver(paid())).rejects.toThrow('account');
    await expect(deliver(paid(), { account: 'acct_synthetic' })).rejects.toThrow('Connect');
    expect((await checkout.balance(org)).balanceNanos).toBe('0');
  });

  it('does not promote historical unbound records or accept events before durable dispatch', async () => {
    await wallet.createTopup(org, 'legacy', 'cus_synthetic', 123);
    await expect(create('legacy')).rejects.toThrow('identity');
    const row = await wallet.createTopup(org, 'prepared', 'cus_synthetic', 123,
      { accountId: 'acct_synthetic', mode: 'test', returnUrl: fixtureEnv.FRONTEND_URL });
    await expect(deliver({ id: 'cs_prepared', livemode: false, mode: 'payment', customer: row.customerId,
      metadata: { service: AI_WALLET_TEST_SERVICE, topupId: row.id }, client_reference_id: row.id,
      amount_total: 123, currency: 'usd', payment_status: 'paid', payment_intent: 'pi_prepared' })).rejects.toThrow('account');
    expect(sdk.checkout.sessions.create).not.toHaveBeenCalled();
    expect((await checkout.balance(org)).balanceNanos).toBe('0');
  });

  it('enforces immutable dispatch parameters and clocks in PostgreSQL', async () => {
    await create('immutable');
    const row = await db.aiWalletTopup.findFirstOrThrow({ where: { organizationId: org } });
    for (const data of [{ stripeAccountId: 'acct_other' }, { firstDispatchedAt: new Date(0) },
      { requestFingerprint: 'b'.repeat(64) }, { checkoutState: 'PREPARED' }, { amountCents: 124 }]) {
      await expect(db.aiWalletTopup.update({ where: { id: row.id }, data })).rejects.toThrow();
    }
    expect(await db.aiWalletTopup.findUnique({ where: { id: row.id } })).toEqual(row);
  });

  it('rolls back early session binding if funding fails, then recovers once', async () => {
    const original = sdk.checkout.sessions.create.getMockImplementation();
    sdk.checkout.sessions.create.mockImplementationOnce(async (...args: any[]) => {
      await original(...args); throw Error('lost response');
    });
    await expect(create('rollback')).rejects.toThrow();
    await expect(deliver({ ...paid(), amount_total: 1 })).rejects.toThrow();
    expect(await db.aiWalletTopup.findFirst({ where: { organizationId: org } })).toMatchObject({ sessionId: null, fundedAt: null, checkoutState: 'DISPATCHED' });
    await Promise.all([deliver(paid()), deliver(paid())]);
    expect(await db.aiWalletLedger.count({ where: { organizationId: org, kind: 'FUNDING' } })).toBe(1);
  });

  it('atomically binds and funds an early signed webhook before the creation response returns', async () => {
    const original = sdk.checkout.sessions.create.getMockImplementation();
    sdk.checkout.sessions.create.mockImplementationOnce(async (...args: any[]) => {
      const value = await original(...args);
      await deliver({ ...value, payment_status: 'paid', payment_intent: `pi_${value.id}` });
      expect((await checkout.balance(org)).balanceNanos).toBe('1230000000');
      return value;
    });
    await create(); await deliver(paid());
    expect((await checkout.balance(org)).balanceNanos).toBe('1230000000');
  });

  it('rejects forged, mutated, stale and live signed events before funding', async () => {
    await create(); const value = event(paid()); const req = request(value);
    req.rawBody = Buffer.from(JSON.stringify({ ...value, id: 'mutated' }));
    expect(() => hook.stripe(req)).toThrow();
    const stale = request(value); stale.headers['stripe-signature'] = signer.webhooks.generateTestHeaderString({
      payload: JSON.stringify(value), secret: fixtureEnv.STRIPE_SIGNING_KEY, timestamp: Math.floor(Date.now() / 1000) - 600 });
    expect(() => hook.stripe(stale)).toThrow();
    const forged = request(value); forged.headers['stripe-signature'] = 't=1,v1=forged';
    expect(() => hook.stripe(forged)).toThrow();
    await expect(deliver(paid(), { livemode: true })).rejects.toThrow('Live');
    expect((await checkout.balance(org)).balanceNanos).toBe('0');
  });

  it('retains legitimate payment bookkeeping while purchasing is paused and handles delayed failure', async () => {
    await create(); await deliver(session());
    process.env.BILLING_ENABLED = 'false'; process.env.AI_WALLET_ENABLED = 'false';
    await deliver(paid(), { type: 'checkout.session.async_payment_succeeded' });
    await deliver(session(), { type: 'checkout.session.async_payment_failed' });
    expect((await checkout.balance(org)).balanceNanos).toBe('1230000000');
    await expect(create()).rejects.toThrow('disabled');
    const other = await db.organization.create({ data: { name: 'Other synthetic org' } });
    expect((await checkout.balance(other.id)).balanceNanos).toBe('0');
  });
  it('returns consistent org-only pending and settled history without payment/provider receipt IDs', async () => {
    await create(); await deliver(paid());
    const pending = await wallet.reserve(org, randomUUID(), 'openai', 'fixture-model', 5000000n);
    await wallet.dispatch(org, pending.id); await wallet.markUnknown(org, pending.id, `request_${pending.id}`);
    const settled = await wallet.reserve(org, randomUUID(), 'openai', 'fixture-model', 4000000n);
    await wallet.dispatch(org, settled.id); await wallet.settle(org, settled.id, 2000000n, `request_${settled.id}`);
    const other = `view-other-${randomUUID()}`; await db.organization.create({ data: { id: other, name: 'Other tenant' } });
    const otherTopup = await wallet.createTopup(other, randomUUID(), 'cus_other', 1);
    await wallet.bindTopupSession(other, otherTopup.id, `cs_${otherTopup.id}`);
    await wallet.applyVerifiedTopupEvent({ eventId: `evt_${otherTopup.id}`, organizationId: other, topupId: otherTopup.id,
      sessionId: `cs_${otherTopup.id}`, paymentId: `pi_${otherTopup.id}`, customerId: 'cus_other', amountCents: 1,
      currency: 'usd', mode: 'payment', paymentStatus: 'paid' });
    const otherHold = await wallet.reserve(other, randomUUID(), 'openai', 'other-model', 1n);
    process.env.AI_WALLET_ENABLED = 'false'; process.env.BILLING_ENABLED = 'false';
    const value = await checkout.balance(org);
    expect(value).toMatchObject({ organizationId: org, heldNanos: '5000000', balanceNanos: '1228000000', availableNanos: '1223000000' });
    expect(value.operations).toHaveLength(2);
    expect(value.operations.find((operation) => operation.id === pending.id)).toMatchObject({ state: 'UNKNOWN', chargedNanos: null });
    expect(value.operations.find((operation) => operation.id === settled.id)).toMatchObject({ state: 'SETTLED', chargedNanos: '2000000' });
    expect(JSON.stringify(value)).not.toMatch(/paymentId|providerRequestId|customerId|operationKey|cs_test|pi_cs/);
    expect((await checkout.balance(other)).operations.map((operation) => operation.id)).toEqual([otherHold.id]);
    expect(value.operations.map((operation) => operation.id)).not.toContain(otherHold.id);
  });

});
