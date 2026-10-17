import { SubscriptionRepository } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.repository';
import { SubscriptionService } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service';
jest.mock('bcrypt', () => ({ hashSync: jest.fn(), compareSync: jest.fn() }));
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { OrganizationRepository } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.repository';
import { WebhooksRepository } from '@gitroom/nestjs-libraries/database/prisma/webhooks/webhooks.repository';
import { AutopostRepository } from '@gitroom/nestjs-libraries/database/prisma/autopost/autopost.repository';
const fixtureUrl = process.env.LAUNCH_ENTITLEMENT_TEST_DATABASE_URL;
(fixtureUrl ? describe : describe.skip)('launch plan PostgreSQL entitlement boundary', () => {
  let db: PrismaClient, organizations: OrganizationRepository, webhooks: WebhooksRepository, autoposts: AutopostRepository;
  beforeAll(async () => {
    const url = new URL(fixtureUrl!);
    if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/ep_ai_wallet_test') {
      throw Error('Owned isolated launch fixture on loopback/ep_ai_wallet_test required');
    }
    db = new PrismaClient({ datasources: { db: { url: fixtureUrl } } }); await db.$connect();
    const repository = { model: db } as any;
    organizations = new OrganizationRepository(repository, repository, repository, repository);
    webhooks = new WebhooksRepository(repository); autoposts = new AutopostRepository(repository);
  });
  afterAll(async () => { await db?.$disconnect(); });
  const createOrg = async (tier?: string) => db.organization.create({ data: {
    name: 'Offline launch entitlement fixture',
    ...(tier ? { subscription: { create: { subscriptionTier: tier as any, period: 'MONTHLY', totalChannels: 0 } } } : {}),
  } });
  const addMember = async (org: string, role: 'SUPERADMIN' | 'ADMIN', disabled: boolean, createdAt: Date) =>
    db.userOrganization.create({ data: { organization: { connect: { id: org } }, role, disabled, createdAt,
      user: { create: { email: randomUUID() + '@fixture.invalid', providerName: 'LOCAL', timezone: 0 } },
    } });
  it.each(['LAUNCH_V1', 'PRO', undefined])('filters current persisted plan without hiding legacy/no-subscription rows (%s)', async (tier) => {
    const org = await createOrg(tier);
    const hook = await db.webhooks.create({ data: { organizationId: org.id, name: 'Offline only', url: 'https://fixture.invalid/hook' } });
    const task = await db.autoPost.create({ data: { organizationId: org.id, title: 'Offline only', url: 'https://fixture.invalid/feed',
      integrations: '[]', active: true, addPicture: false, generateContent: false, syncLast: false, onSlot: false, lastUrl: '' } });
    const hooks = await webhooks.getWebhooks(org.id), queued = await autoposts.getAutopost(task.id);
    if (tier === 'LAUNCH_V1') {
      expect(hooks).toEqual([]); expect(queued).toBeNull();
      await expect(organizations.assertAdvancedAutomationAllowed(org.id)).rejects.toThrow();
    } else {
      expect(hooks.map((h) => h.id)).toContain(hook.id); expect(queued?.id).toBe(task.id);
      await expect(organizations.assertAdvancedAutomationAllowed(org.id)).resolves.toBeUndefined();
    }
  });
  it('rechecks a formerly legacy queued task after switching to launch', async () => {
    const org = await createOrg('PRO');
    const task = await db.autoPost.create({ data: { organizationId: org.id, title: 'Offline only', url: 'https://fixture.invalid/feed',
      integrations: '[]', active: true, addPicture: false, generateContent: false, syncLast: false, onSlot: false, lastUrl: '' } });
    expect((await autoposts.getAutopost(task.id))?.id).toBe(task.id);
    await db.subscription.update({ where: { organizationId: org.id }, data: { subscriptionTier: 'LAUNCH_V1' as any } });
    expect(await autoposts.getAutopost(task.id)).toBeNull();
  });
  it('preserves the oldest enabled owner, including across retries, without reviving an older disabled owner', async () => {
    const org = await createOrg('LAUNCH_V1');
    const disabledOwner = await addMember(org.id, 'SUPERADMIN', true, new Date('2020-01-01'));
    const owner = await addMember(org.id, 'SUPERADMIN', false, new Date('2021-01-01'));
    const extra = await addMember(org.id, 'SUPERADMIN', false, new Date('2022-01-01'));
    const admin = await addMember(org.id, 'ADMIN', false, new Date('2020-01-01'));
    await expect(organizations.enforceSingleEnabledOwner(org.id)).resolves.toEqual({ count: 2 });
    await expect(organizations.enforceSingleEnabledOwner(org.id)).resolves.toEqual({ count: 0 });
    const rows = await db.userOrganization.findMany({ where: { organizationId: org.id } });
    expect(rows.filter((r) => !r.disabled).map((r) => r.id)).toEqual([owner.id]);
    for (const id of [disabledOwner.id, extra.id, admin.id]) expect(rows.find((r) => r.id === id)?.disabled).toBe(true);
  });
  it('fails without writes if no enabled owner exists', async () => {
    const org = await createOrg('LAUNCH_V1');
    await addMember(org.id, 'SUPERADMIN', true, new Date('2020-01-01'));
    await addMember(org.id, 'ADMIN', false, new Date('2021-01-01'));
    const before = await db.userOrganization.findMany({ where: { organizationId: org.id }, orderBy: { id: 'asc' } });
    await expect(organizations.enforceSingleEnabledOwner(org.id)).rejects.toThrow('enabled owner');
    expect(await db.userOrganization.findMany({ where: { organizationId: org.id }, orderBy: { id: 'asc' } })).toEqual(before);
  });
  it('persists revocation/recovery under the customer lock and preserves lifetime/legacy rows', async () => {
    const saved = process.env.BILLING_ENABLED; process.env.BILLING_ENABLED = 'true';
    try {
      const org = await createOrg('LAUNCH_V1'); const customer = `cus_fixture_${org.id}`;
      await db.organization.update({ where: { id: org.id }, data: { paymentId: customer, isTrailing: true } });
      const repository = { model: db } as any;
      const subscriptions = new SubscriptionRepository(repository, repository, repository, repository, repository);
      const integrations = { getIntegrationsList: jest.fn(async () => []), changeActiveCron: jest.fn(), restoreActiveCron: jest.fn() };
      const owners = { enforceSingleEnabledOwner: jest.fn(), disableOrEnableNonSuperAdminUsers: jest.fn() };
      const service = new SubscriptionService(subscriptions, integrations as any, owners as any, repository);
      let unblock!: () => void, entered!: () => void;
      const held = new Promise<void>(resolve => { unblock = resolve; });
      const ready = new Promise<void>(resolve => { entered = resolve; });
      const grant = service.reconcileLaunchSubscription(customer, async () => {
        entered(); await held;
        return { status: 'active', identifier: 'current', period: 'MONTHLY', cancelAt: 2000000000 };
      });
      await ready;
      const revokeRead = jest.fn(async () => null);
      const revoke = service.reconcileLaunchSubscription(customer, revokeRead);
      // The second transaction must not read a provider snapshot before owning the lock.
      await new Promise(resolve => setTimeout(resolve, 30)); expect(revokeRead).not.toHaveBeenCalled();
      unblock(); await Promise.all([grant, revoke]);
      expect(await subscriptions.getSubscription(org.id)).toBeNull();
      expect((await db.organization.findUnique({ where: { id: org.id } }))?.isTrailing).toBe(false);
      expect(owners.disableOrEnableNonSuperAdminUsers).toHaveBeenCalledWith(org.id, true);
      const recovered = { status: 'trialing', identifier: 'recovered', period: 'MONTHLY' as const, cancelAt: 2000000000 };
      await service.reconcileLaunchSubscription(customer, async () => recovered);
      expect(await subscriptions.getSubscription(org.id)).toMatchObject({ subscriptionTier: 'LAUNCH_V1', cancelAt: new Date(2000000000000) });
      expect(owners.enforceSingleEnabledOwner).toHaveBeenCalledWith(org.id);
      for (const isLifetime of [false, true]) {
        await db.subscription.update({ where: { organizationId: org.id }, data: { subscriptionTier: 'PRO', isLifetime } });
        const before = await subscriptions.getSubscription(org.id); const read = jest.fn(async () => null);
        await service.reconcileLaunchSubscription(customer, read);
        expect(read).not.toHaveBeenCalled(); expect(await subscriptions.getSubscription(org.id)).toEqual(before);
      }
    } finally { if (saved === undefined) delete process.env.BILLING_ENABLED; else process.env.BILLING_ENABLED = saved; }
  });

});
