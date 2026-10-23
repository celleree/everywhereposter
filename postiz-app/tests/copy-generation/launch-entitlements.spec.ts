jest.mock('@gitroom/nestjs-libraries/services/stripe.service', () => ({ StripeService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service', () => ({ SubscriptionService: class {} }));
jest.mock('@gitroom/backend/services/auth/auth.service', () => ({ AuthService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/users/users.service', () => ({ UsersService: class {} }));
jest.mock('@gitroom/nestjs-libraries/track/track.service', () => ({ TrackService: class {} }));
import { UsersController } from '../../apps/backend/src/api/routes/users.controller';
jest.mock('bcrypt', () => ({ hashSync: jest.fn(), compareSync: jest.fn() }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/webhooks/webhooks.service', () => ({ WebhooksService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/autopost/autopost.service', () => ({ AutopostService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/organizations/organization.service', () => ({ OrganizationService: class {} }));
import { OrganizationRepository } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.repository';
import { WebhooksRepository } from '@gitroom/nestjs-libraries/database/prisma/webhooks/webhooks.repository';
import { AutopostRepository } from '@gitroom/nestjs-libraries/database/prisma/autopost/autopost.repository';
import { WebhookController } from '../../apps/backend/src/api/routes/webhooks.controller';
import { AutopostController } from '../../apps/backend/src/api/routes/autopost.controller';

describe('launch plan entitlement boundaries', () => {
  const org = { id: 'org' } as any;
  let repository: OrganizationRepository;
  let organization: any;
  let membership: any;
  let transaction: any;
  let user: any;
  beforeEach(() => {
    organization = { findUnique: jest.fn(), findFirst: jest.fn() };
    membership = { findFirst: jest.fn().mockResolvedValue({ id: 'owner' }), updateMany: jest.fn().mockResolvedValue({ count: 2 }), create: jest.fn() };
    user = { findFirst: jest.fn().mockResolvedValue(null), update: jest.fn() };
    transaction = jest.fn((callback) => callback({ userOrganization: membership }));
    repository = new OrganizationRepository({ model: { organization } } as any,
      { model: { userOrganization: membership } } as any, { model: { user } } as any,
      { model: { $transaction: transaction } } as any);
  });
  it.each(['true', 'false'])('returns a serializable unlimited flag without exposing a launch API key (billing=%s)', async (billing) => {
    const previous = process.env.BILLING_ENABLED; process.env.BILLING_ENABLED = billing;
    try {
      const controller = new UsersController({} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
      const response = await controller.getSelf({ id: 'user' } as any,
        { id: 'org', apiKey: 'private-key', users: [{ role: 'SUPERADMIN' }], subscription: { subscriptionTier: 'LAUNCH_V1', totalChannels: 0 } } as any,
        { cookies: {}, headers: {} } as any);
      expect(response.unlimitedChannels).toBe(true); expect(response.publicApi).toBe('');
      expect(Number.isFinite(response.totalChannels)).toBe(true);
      expect(JSON.parse(JSON.stringify(response)).unlimitedChannels).toBe(true);
    } finally { if (previous === undefined) delete process.env.BILLING_ENABLED; else process.env.BILLING_ENABLED = previous; }
  });
  it('keeps legacy API-key presentation and finite channel limits', async () => {
    const previous = process.env.BILLING_ENABLED; process.env.BILLING_ENABLED = 'true';
    try {
      const controller = new UsersController({} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
      const response = await controller.getSelf({ id: 'user' } as any,
        { id: 'org', apiKey: 'legacy-key', users: [{ role: 'ADMIN' }], subscription: { subscriptionTier: 'PRO', totalChannels: 10 } } as any,
        { cookies: {}, headers: {} } as any);
      expect(response.unlimitedChannels).toBe(false); expect(response.publicApi).toBe('legacy-key'); expect(response.totalChannels).toBe(10);
    } finally { if (previous === undefined) delete process.env.BILLING_ENABLED; else process.env.BILLING_ENABLED = previous; }
  });
  it('keeps the oldest enabled owner and only disables other enabled memberships', async () => {
    await expect(repository.enforceSingleEnabledOwner('org')).resolves.toEqual({ count: 2 });
    expect(membership.findFirst).toHaveBeenCalledWith({
      where: { organizationId: 'org', role: 'SUPERADMIN', disabled: false },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { id: true },
    });
    expect(membership.updateMany).toHaveBeenCalledWith({
      where: { organizationId: 'org', id: { not: 'owner' }, disabled: false }, data: { disabled: true },
    });
    expect(transaction.mock.calls[0][1]).toEqual({ isolationLevel: 'Serializable' });
  });
  it('fails closed without an enabled owner and never enables a membership', async () => {
    membership.findFirst.mockResolvedValue(null);
    await expect(repository.enforceSingleEnabledOwner('org')).rejects.toThrow('enabled owner');
    expect(membership.updateMany).not.toHaveBeenCalled();
  });
  it.each(['LAUNCH_V1', undefined])('rejects advanced automation for launch or missing organization (%s)', async (tier) => {
    organization.findUnique.mockResolvedValue(tier ? { subscription: { subscriptionTier: tier } } : null);
    await expect(repository.assertAdvancedAutomationAllowed('org')).rejects.toThrow();
  });
  it.each(['STANDARD', 'PRO', 'ULTIMATE', 'TEAM', undefined])('preserves legacy automation policy (%s)', async (tier) => {
    organization.findUnique.mockResolvedValue({ subscription: tier ? { subscriptionTier: tier } : null });
    await expect(repository.assertAdvancedAutomationAllowed('org')).resolves.toBeUndefined();
  });
  it('rejects outstanding launch invitations even when billing is paused', async () => {
    const previous = process.env.BILLING_ENABLED;
    process.env.BILLING_ENABLED = 'false';
    organization.findFirst.mockResolvedValue({ subscription: { subscriptionTier: 'LAUNCH_V1' } });
    try {
      await expect(repository.addUserToOrg('user', 'invite', 'org', 'ADMIN')).resolves.toBe(false);
      expect(membership.create).not.toHaveBeenCalled();
      expect(user.update).not.toHaveBeenCalled();
    } finally { if (previous === undefined) delete process.env.BILLING_ENABLED; else process.env.BILLING_ENABLED = previous; }
  });
  it('filters queued webhook and autopost execution using current persisted plan', async () => {
    const findMany = jest.fn(); const findUnique = jest.fn();
    new WebhooksRepository({ model: { webhooks: { findMany } } } as any).getWebhooks('org');
    new AutopostRepository({ model: { autoPost: { findUnique } } } as any).getAutopost('task');
    for (const mock of [findMany, findUnique]) expect(mock.mock.calls[0][0].where.NOT).toEqual({
      organization: { subscription: { is: { subscriptionTier: 'LAUNCH_V1' } } },
    });
  });
  it('blocks webhook mutation/send before side effects but permits deletion', async () => {
    const guard = { assertAdvancedAutomationAllowed: jest.fn().mockRejectedValue(new Error('unavailable')) };
    const service = { createWebhook: jest.fn(), deleteWebhook: jest.fn() };
    const controller = new WebhookController(service as any, guard as any);
    const fetchMock = jest.spyOn(global, 'fetch').mockRejectedValue(new Error('must not run'));
    try {
      await expect(controller.createAWebhook(org, {} as any)).rejects.toThrow('unavailable');
      await expect(controller.updateWebhook(org, {} as any)).rejects.toThrow('unavailable');
      await expect(controller.sendWebhook(org, {}, { url: 'https://example.test' })).rejects.toThrow('unavailable');
      expect(service.createWebhook).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled();
      await controller.deleteWebhook(org, 'id'); expect(service.deleteWebhook).toHaveBeenCalledWith('org', 'id');
    } finally { fetchMock.mockRestore(); }
  });
  it('blocks autopost mutation, activation and send before side effects but permits deletion', async () => {
    const guard = { assertAdvancedAutomationAllowed: jest.fn().mockRejectedValue(new Error('unavailable')) };
    const service = { createAutopost: jest.fn(), changeActive: jest.fn(), loadXML: jest.fn(), deleteAutopost: jest.fn() };
    const controller = new AutopostController(service as any, guard as any);
    await expect(controller.createAutopost(org, {} as any)).rejects.toThrow('unavailable');
    await expect(controller.updateAutopost(org, {} as any, 'id')).rejects.toThrow('unavailable');
    await expect(controller.changeActive(org, 'id', true)).rejects.toThrow('unavailable');
    await expect(controller.sendWebhook(org, { url: 'https://example.test' })).rejects.toThrow('unavailable');
    expect(service.createAutopost).not.toHaveBeenCalled(); expect(service.changeActive).not.toHaveBeenCalled(); expect(service.loadXML).not.toHaveBeenCalled();
    await controller.deleteAutopost(org, 'id'); expect(service.deleteAutopost).toHaveBeenCalledWith('org', 'id');
  });
});
