import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { validateSync } from 'class-validator';
import { AiWalletTopupDto } from '@gitroom/nestjs-libraries/dtos/billing/ai-wallet-topup.dto';
import Stripe from 'stripe';
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
    sessions = new Map();
    sdk = { customers: { create: jest.fn(async (_body: any, options: any) => ({ id: `cus_test_${options.idempotencyKey}`, livemode: false })) }, checkout: { sessions: {
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

  it.each(['not-json', '[{"id":"a","amountCents":1.5}]',
    '[{"id":"a","amountCents":100},{"id":"a","amountCents":200}]'])('rejects invalid catalogue %s', (catalogue) => {
    process.env.AI_WALLET_TEST_OFFERS = catalogue;
    expect(() => checkout.offers()).toThrow('Invalid test top-up');
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

  it('keeps an early webhook retryable until the session is bound', async () => {
    const original = sdk.checkout.sessions.create.getMockImplementation();
    sdk.checkout.sessions.create.mockImplementationOnce(async (...args: any[]) => {
      const value = await original(...args);
      await expect(deliver({ ...value, payment_status: 'paid', payment_intent: `pi_${value.id}` })).rejects.toThrow('not yet bound');
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
    await expect(deliver(paid(), { livemode: true })).rejects.toThrow('Live wallet');
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
});
