jest.mock('bcrypt', () => ({ hashSync: jest.fn(), compareSync: jest.fn() }));
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { OrganizationRepository } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.repository';
import { WebhooksRepository } from '@gitroom/nestjs-libraries/database/prisma/webhooks/webhooks.repository';
import { AutopostRepository } from '@gitroom/nestjs-libraries/database/prisma/autopost/autopost.repository';
const fixtureUrl = process.env.AI_WALLET_TEST_DATABASE_URL;
(fixtureUrl ? describe : describe.skip)('launch plan PostgreSQL entitlement boundary', () => {
  let db: PrismaClient, organizations: OrganizationRepository, webhooks: WebhooksRepository, autoposts: AutopostRepository;
  beforeAll(async () => {
    const url = new URL(fixtureUrl!);
    if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.port !== '55473' || url.pathname !== '/ep_ai_wallet_test') {
      throw Error('Owned isolated launch fixture on loopback:55473/ep_ai_wallet_test required');
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
    db.userOrganization.create({ data: { organizationId: org, role, disabled, createdAt,
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
});
