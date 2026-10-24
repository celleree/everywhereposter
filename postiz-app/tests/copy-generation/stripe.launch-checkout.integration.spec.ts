import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { StripeService } from '@gitroom/nestjs-libraries/services/stripe.service';
import { SubscriptionRepository } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.repository';
import { SubscriptionService } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service';

jest.mock('@gitroom/nestjs-libraries/database/prisma/integrations/integration.service', () => ({ IntegrationService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/organizations/organization.service', () => ({ OrganizationService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/users/users.service', () => ({ UsersService: class {} }));
jest.mock('@gitroom/nestjs-libraries/track/track.service', () => ({ TrackService: class {} }));
jest.mock('@gitroom/helpers/auth/auth.service', () => ({ AuthService: class {} }));
const mockPrices = jest.fn(), mockCreate = jest.fn(), mockList = jest.fn(), mockRetrieve = jest.fn();
const mockExpire = jest.fn(), mockSubscriptions = jest.fn(), mockCustomer = jest.fn();
jest.mock('stripe', () => ({ __esModule: true, default: jest.fn(() => ({
  prices: { list: (...args: any[]) => mockPrices(...args) },
  customers: { create: (...args: any[]) => mockCustomer(...args), update: jest.fn() },
  subscriptions: { list: (...args: any[]) => mockSubscriptions(...args) },
  checkout: { sessions: { create: (...args: any[]) => mockCreate(...args), list: (...args: any[]) => mockList(...args),
    retrieve: (...args: any[]) => mockRetrieve(...args), expire: (...args: any[]) => mockExpire(...args) } },
})) }));

// No Stripe SDK requests and no DATABASE_URL fallback. CI must explicitly supply
// its job-owned disposable fixture and require zero skips for this suite.
const fixture = process.env.LAUNCH_CHECKOUT_TEST_DATABASE_URL;
(fixture ? describe : describe.skip)('Launch Checkout admission on PostgreSQL with mocked Stripe', () => {
  let clients: PrismaClient[], org: string, clock: number;
  let sessions: Map<string, any>, keys: Map<string, any>, subscriptions: any[];
  const before = { BILLING_ENABLED: process.env.BILLING_ENABLED, FRONTEND_URL: process.env.FRONTEND_URL };
  const price = (period = 'MONTHLY') => ({ id: `price_${period}`, active: true, currency: 'usd',
    type: 'recurring', billing_scheme: 'per_unit', unit_amount: period === 'MONTHLY' ? 900 : 9000,
    recurring: { interval: period === 'MONTHLY' ? 'month' : 'year', interval_count: 1 },
    lookup_key: `everywhereposter_launch_v1_${period.toLowerCase()}`, metadata: { plan_version: 'LAUNCH_V1' } });
  const deferred = () => {
    let resolve!: () => void;
    const promise = new Promise<void>(done => { resolve = done; });
    return { promise, resolve };
  };
  const createSession = async (params: any, options: any) => {
    // A Checkout must never be attached to an uncommitted/losing customer ID.
    const binding = await clients[0].organization.findUniqueOrThrow({ where: { id: org } });
    expect(params.customer).toBe(binding.paymentId);
    expect(options).toMatchObject({ timeout: 10000, maxNetworkRetries: 0 });
    const prior = keys.get(options.idempotencyKey);
    if (prior) {
      expect(params).toEqual(prior.params);
      return { ...sessions.get(prior.id) };
    }
    const id = `cs_${randomUUID()}`;
    const session = { ...params, id, status: 'open', subscription: null,
      line_items: { data: [{ price: price(params.subscription_data.metadata.period), quantity: 1 }], has_more: false },
      url: `https://checkout.stripe.com/c/pay/${id}`, client_secret: `${id}_secret` };
    sessions.set(id, session);
    keys.set(options.idempotencyKey, { id, params: structuredClone(params) });
    return { ...session };
  };
  const setup = (index = 0) => {
    const repository = { model: clients[index] } as any;
    const subscriptions = new SubscriptionService(
      new SubscriptionRepository(repository, repository, repository, repository, repository),
      {} as any, {} as any, repository);
    return { subscriptions, service: new StripeService(subscriptions,
      { getOrgById: (id: string) => clients[index].organization.findUnique({ where: { id } }),
        getTeam: async () => ({ users: [{ user: { email: 'fixture@example.test' } }] }) } as any,
      { getUserById: async () => ({ email: 'fixture@example.test' }) } as any, {} as any) };
  };
  const request = (service: StripeService, mode = 'hosted', period = 'MONTHLY') =>
    (service as any)[mode === 'hosted' ? 'subscribe' : 'embedded']('tracking', org, 'user_fixture',
      { billing: 'LAUNCH_V1', period }, true);
  const attempts = () => clients[0].launchCheckoutAttempt.findMany({ where: { organizationId: org }, orderBy: { createdAt: 'asc' } });

  beforeAll(async () => {
    const url = new URL(fixture!);
    if (url.protocol !== 'postgresql:' || url.hostname !== '127.0.0.1' ||
        url.pathname !== '/ep_ai_wallet_test' || url.username !== 'isolated') throw Error('Owned disposable fixture required');
    clients = [0, 1].map(() => new PrismaClient({ datasources: { db: { url: fixture } } }));
    await Promise.all(clients.map(client => client.$connect()));
  });
  beforeEach(async () => {
    process.env.BILLING_ENABLED = 'true';
    process.env.FRONTEND_URL = 'https://app.example.test';
    org = randomUUID(); clock = Date.now();
    jest.spyOn(Date, 'now').mockImplementation(() => clock);
    await clients[0].organization.create({ data: { id: org, name: 'Synthetic Launch checkout',
      paymentId: `cus_${org}`, allowTrial: true } });
    sessions = new Map(); keys = new Map(); subscriptions = [];
    mockPrices.mockImplementation(async query => ({ data: [price(query.lookup_keys[0].endsWith('yearly') ? 'YEARLY' : 'MONTHLY')] }));
    mockSubscriptions.mockImplementation(async () => ({ data: subscriptions, has_more: false }));
    mockList.mockImplementation(async () => ({ data: [...sessions.values()], has_more: false }));
    mockRetrieve.mockImplementation(async id => {
      if (!sessions.has(id)) throw Error('Unknown fixture session');
      return structuredClone(sessions.get(id));
    });
    mockCreate.mockImplementation(createSession);
    mockCustomer.mockImplementation(async () => ({ id: `cus_${randomUUID()}` }));
    mockExpire.mockImplementation(async id => {
      const session = sessions.get(id);
      if (session.status !== 'open') throw Error('Session is not open');
      session.status = 'expired';
      return { ...session };
    });
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => {
    for (const [key, value] of Object.entries(before)) value === undefined ? delete process.env[key] : process.env[key] = value;
    // Preserve attempt history. The job owns and discards the entire fixture;
    // this suite never deletes rows or connects to a real application database.
    await Promise.all((clients || []).map(client => client.$disconnect()));
  });

  it.each(['hosted', 'custom'])('reuses matching %s sessions across process/service restart', async mode => {
    const first = await request(setup().service, mode);
    expect(await request(setup(1).service, mode)).toEqual(first);
    expect(mockCreate).toHaveBeenCalledTimes(1);
    const rows = await attempts();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ state: 'OPEN', leaseToken: null, leaseUntil: null });
    expect(JSON.stringify(rows)).not.toContain('client_secret');
  });

  it.each(['hosted', 'custom'])('serializes concurrent hosted/%s admission without holding a provider transaction', async mode => {
    const entered = deferred(), finish = deferred();
    mockCreate.mockImplementationOnce(async (...args) => {
      entered.resolve(); await finish.promise;
      return createSession(args[0], args[1]);
    });
    const first = request(setup().service);
    await entered.promise;
    try {
      await expect(request(setup(1).service, mode)).rejects.toThrow('pending');
      // This separate connection can acquire the same advisory lock while the
      // provider mock is blocked: no long transaction spans provider I/O.
      const locked = await clients[1].$transaction(tx => tx.$queryRaw<Array<{ locked: boolean }>>
        `SELECT pg_try_advisory_xact_lock(hashtextextended(${org}, 2)) AS locked`);
      expect(locked[0].locked).toBe(true);
    } finally { finish.resolve(); }
    await first;
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect((await attempts()).filter(a => a.state !== 'CLOSED')).toHaveLength(1);
  });

  it('returns a mode conflict without creating a second usable path', async () => {
    await request(setup().service);
    await expect(request(setup(1).service, 'custom')).rejects.toThrow('mode or contract changed');
    expect(mockCreate).toHaveBeenCalledTimes(1); expect(mockExpire).not.toHaveBeenCalled();
  });

  it('expires only its recognized open session before a period replacement', async () => {
    await request(setup().service);
    const first = (await attempts())[0];
    clock += 1000;
    await request(setup(1).service, 'hosted', 'YEARLY');
    expect(mockExpire).toHaveBeenCalledWith(first.sessionId, {}, expect.objectContaining({
      timeout: 10000, maxNetworkRetries: 0, idempotencyKey: `launch-expire:${first.id}` }));
    const rows = await attempts();
    expect(rows.map(row => row.state).sort()).toEqual(['CLOSED', 'OPEN']);
    expect(rows.find(row => row.id === first.id)?.parameters).toEqual(first.parameters);
    expect([...sessions.values()].filter(s => s.status === 'open')).toHaveLength(1);
  });

  it('completion wins the period-change race even with temporarily empty subscription history', async () => {
    await request(setup().service);
    mockExpire.mockImplementationOnce(async id => {
      Object.assign(sessions.get(id), { status: 'complete', subscription: 'sub_settling' });
      throw Error('completion won');
    });
    await expect(request(setup(1).service, 'hosted', 'YEARLY')).rejects.toThrow('completed before replacement');
    await expect(request(setup().service)).rejects.toThrow('settlement is pending');
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect((await attempts())[0].state).toBe('SETTLEMENT_PENDING');
  });

  it('rechecks provider subscriptions after expiration before creating a replacement', async () => {
    await request(setup().service);
    mockExpire.mockImplementationOnce(async id => {
      sessions.get(id).status = 'expired';
      subscriptions.push({ id: 'sub_raced', status: 'active', customer: `cus_${org}` });
      return sessions.get(id);
    });
    await expect(request(setup(1).service, 'hosted', 'YEARLY')).rejects.toThrow('subscription exists');
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect((await attempts())[0].state).toBe('EXPIRING');
  });

  it('keeps an uncertain expiration pending until a fresh terminal response proves safety', async () => {
    await request(setup().service);
    mockExpire.mockRejectedValueOnce(Error('timeout'));
    await expect(request(setup(1).service, 'hosted', 'YEARLY')).rejects.toThrow('expiration is pending');
    expect(mockCreate).toHaveBeenCalledTimes(1);
    await request(setup().service, 'hosted', 'YEARLY');
    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect([...sessions.values()].filter(s => s.status === 'open')).toHaveLength(1);
  });

  it('commits and rereads the canonical binding after concurrent customer creation', async () => {
    await clients[0].organization.update({ where: { id: org }, data: { paymentId: null } });
    let count = 0;
    const entered = deferred();
    mockCustomer.mockImplementation(async () => {
      const id = `cus_race_${++count}`;
      if (count === 2) entered.resolve();
      await entered.promise; return { id };
    });
    const results = await Promise.allSettled([request(setup().service), request(setup(1).service)]);
    expect(results.some(r => r.status === 'fulfilled')).toBe(true);
    const canonical = (await clients[0].organization.findUniqueOrThrow({ where: { id: org } })).paymentId;
    expect(['cus_race_1', 'cus_race_2']).toContain(canonical);
    expect([...sessions.values()].every(s => s.customer === canonical)).toBe(true);
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('also prevents a stale legacy customer creator from overwriting the binding', async () => {
    const stale = { id: org, name: 'Synthetic', paymentId: null } as any;
    const canonical = await setup().service.createOrGetCustomer(stale);
    expect(canonical).toBe(`cus_${org}`);
    expect((await clients[0].organization.findUniqueOrThrow({ where: { id: org } })).paymentId).toBe(canonical);
  });

  it('recovers a successful POST whose response was lost using positive session identity', async () => {
    mockCreate.mockImplementationOnce(async (...args) => { await createSession(args[0], args[1]); throw Error('response lost'); });
    await expect(request(setup().service)).rejects.toThrow('response lost');
    const dispatched = (await attempts())[0];
    expect(dispatched).toMatchObject({ state: 'DISPATCHED', sessionId: null });
    await request(setup(1).service);
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect((await attempts())[0]).toMatchObject({ id: dispatched.id, state: 'OPEN', operationKey: dispatched.operationKey });
  });

  it('retries the identical persisted POST within its window when list visibility lags', async () => {
    mockCreate.mockImplementationOnce(async (...args) => { await createSession(args[0], args[1]); throw Error('response lost'); });
    await expect(request(setup().service)).rejects.toThrow('response lost');
    mockList.mockResolvedValueOnce({ data: [], has_more: false });
    await request(setup(1).service);
    expect(mockCreate.mock.calls[1]).toEqual(mockCreate.mock.calls[0]);
    expect(sessions.size).toBe(1);
  });

  it('recovers a crash after durable dispatch marking but before sending the POST', async () => {
    const first = setup();
    const transition = first.subscriptions.transitionLaunchCheckout.bind(first.subscriptions);
    jest.spyOn(first.subscriptions, 'transitionLaunchCheckout').mockImplementation(async (...args) => {
      const result = await transition(...args);
      if (args[2].state === 'DISPATCHED') throw Error('simulated crash');
      return result;
    });
    await expect(request(first.service)).rejects.toThrow('simulated crash');
    expect(mockCreate).not.toHaveBeenCalled();
    const marked = (await attempts())[0];
    await request(setup(1).service);
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockCreate.mock.calls[0][1].idempotencyKey).toBe(marked.operationKey);
  });

  it('never starts a new identity after idempotency pruning and an empty history', async () => {
    mockCreate.mockImplementationOnce(async (...args) => { await createSession(args[0], args[1]); throw Error('response lost'); });
    await expect(request(setup().service)).rejects.toThrow('response lost');
    const original = (await attempts())[0];
    clock += 25 * 60 * 60 * 1000; keys.clear();
    mockList.mockResolvedValue({ data: [], has_more: false });
    await expect(request(setup(1).service)).rejects.toThrow('beyond the retry window');
    await expect(request(setup().service, 'hosted', 'YEARLY')).rejects.toThrow('unresolved');
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(await attempts()).toEqual([expect.objectContaining({ id: original.id, state: 'REVIEW', sessionId: null,
      firstDispatchedAt: original.firstDispatchedAt, operationKey: original.operationKey })]);
  });

  it('can recover positive session evidence beyond the retry window without sending another POST', async () => {
    mockCreate.mockImplementationOnce(async (...args) => { await createSession(args[0], args[1]); throw Error('response lost'); });
    await expect(request(setup().service)).rejects.toThrow('response lost');
    clock += 25 * 60 * 60 * 1000; keys.clear();
    await request(setup(1).service);
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect((await attempts())[0].state).toBe('OPEN');
  });

  it.each(['checkout', 'subscription'])('requires complete %s history before dispatch', async kind => {
    (kind === 'checkout' ? mockList : mockSubscriptions).mockResolvedValue({ data: [], has_more: true });
    await expect(request(setup().service)).rejects.toThrow('history is incomplete');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it.each(['open', 'complete', null])('refuses unknown subscription checkout state %s', async status => {
    sessions.set('cs_unknown', { id: 'cs_unknown', mode: 'subscription', customer: `cus_${org}`, status });
    await expect(request(setup().service)).rejects.toThrow('requires reconciliation');
    expect(mockCreate).not.toHaveBeenCalled(); expect(mockExpire).not.toHaveBeenCalled();
  });

  it('refuses multiple matching sessions without attempting cleanup', async () => {
    await request(setup().service);
    const session = [...sessions.values()][0];
    sessions.set('cs_extra', { ...session, id: 'cs_extra' });
    await expect(request(setup(1).service)).rejects.toThrow('Multiple checkout identities');
    expect(mockCreate).toHaveBeenCalledTimes(1); expect(mockExpire).not.toHaveBeenCalled();
  });

  it('blocks an existing stored Launch subscription at embedded admission', async () => {
    await clients[0].subscription.create({ data: { organizationId: org, subscriptionTier: 'LAUNCH_V1', totalChannels: 0, period: 'MONTHLY' } });
    await expect(request(setup().service, 'custom')).rejects.toThrow('Subscription');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('checks fresh stored subscription state before returning an open checkout', async () => {
    mockCreate.mockImplementationOnce(async (...args) => {
      const session = await createSession(args[0], args[1]);
      await clients[1].subscription.create({ data: { organizationId: org, subscriptionTier: 'LAUNCH_V1', totalChannels: 0, period: 'MONTHLY' } });
      return session;
    });
    await expect(request(setup().service, 'custom')).rejects.toThrow('Subscription');
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect((await attempts())[0].state).toBe('DISPATCHED');
  });

  it('rechecks trial eligibility before exposing a previously eligible checkout', async () => {
    mockCreate.mockImplementationOnce(async (...args) => {
      const session = await createSession(args[0], args[1]);
      await clients[1].organization.update({ where: { id: org }, data: { allowTrial: false } });
      return session;
    });
    await expect(request(setup().service)).rejects.toThrow('Trial eligibility changed');
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect((await attempts())[0].state).toBe('DISPATCHED');
  });

  it('enforces one unresolved row and immutable request/history at the database boundary', async () => {
    await request(setup().service);
    const first = (await attempts())[0];
    await expect(clients[1].launchCheckoutAttempt.create({ data: {
      id: randomUUID(), operationKey: randomUUID(), organizationId: org, customerId: first.customerId,
      requestFingerprint: first.requestFingerprint, parameters: first.parameters as any,
    } })).rejects.toThrow();
    await expect(clients[0].launchCheckoutAttempt.update({ where: { id: first.id }, data: { parameters: {} } })).rejects.toThrow();
    await expect(clients[0].launchCheckoutAttempt.update({ where: { id: first.id }, data: { firstDispatchedAt: new Date(0) } })).rejects.toThrow();
    await expect(clients[0].launchCheckoutAttempt.delete({ where: { id: first.id } })).rejects.toThrow();
    expect((await attempts())[0].parameters).toEqual(first.parameters);
  });

  it('fences stale results after lease replacement and terminal transition', async () => {
    await request(setup().service);
    const first = (await attempts())[0];
    const proposal = { id: randomUUID(), operationKey: randomUUID(), requestFingerprint: first.requestFingerprint,
      parameters: first.parameters as any, allowTrial: true };
    const one = setup().subscriptions, two = setup(1).subscriptions;
    const stale = await one.claimLaunchCheckout(org, first.customerId, proposal, 'old-request');
    clock += 121000;
    const fresh = await two.claimLaunchCheckout(org, first.customerId, proposal, 'new-request');
    await two.transitionLaunchCheckout(fresh, ['OPEN'], { state: 'CLOSED' });
    await expect(one.transitionLaunchCheckout(stale, ['OPEN'], { state: 'OPEN' })).rejects.toThrow('ownership changed');
    await one.releaseLaunchCheckout(stale);
    const final = (await attempts())[0];
    expect(final.state).toBe('CLOSED'); expect(final.leaseToken).toBe('new-request');
    await expect(clients[0].launchCheckoutAttempt.update({ where: { id: first.id }, data: { state: 'OPEN' } })).rejects.toThrow();
  });
});
