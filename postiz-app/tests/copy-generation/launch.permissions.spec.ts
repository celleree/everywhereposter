import { PermissionsService } from '../../apps/backend/src/services/auth/permissions/permissions.service';
import { AuthorizationActions, Sections } from '../../apps/backend/src/services/auth/permissions/permission.exception.class';
import { PublicAuthMiddleware } from '../../apps/backend/src/services/auth/public.auth.middleware';

jest.mock('@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service', () => ({ SubscriptionService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/posts/posts.service', () => ({ PostsService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/integrations/integration.service', () => ({ IntegrationService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/webhooks/webhooks.service', () => ({ WebhooksService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/organizations/organization.service', () => ({ OrganizationService: class {} }));
const keys = ['BILLING_ENABLED', 'AI_WALLET_ENABLED', 'AI_WALLET_TEXT_ENABLED', 'AI_WALLET_TRANSCRIPTION_ENABLED'];
const saved = keys.map(key => process.env[key]);
afterAll(() => { keys.forEach((key, i) => saved[i] === undefined ? delete process.env[key] : process.env[key] = saved[i]); });
it.each(['true', 'false'])('launch permits unlimited ordinary posting but rejects unmetered AI with billing flag %s', async (flag) => {
  process.env.BILLING_ENABLED = flag;
  const posts = { countPostsFromDay: jest.fn().mockResolvedValue(9999999) };
  const integrations = { getIntegrationsList: jest.fn().mockResolvedValue(Array(10000).fill({})) };
  const service = new PermissionsService({ getSubscriptionByOrganizationId: jest.fn().mockResolvedValue({ subscriptionTier: 'LAUNCH_V1', totalChannels: 0 }) } as any,
    posts as any, integrations as any, { getTotal: jest.fn().mockResolvedValue(0) } as any);
  const sections = [Sections.CHANNEL, Sections.POSTS_PER_MONTH, Sections.AI, Sections.LOCAL_VIDEO_EDIT, Sections.TEAM_MEMBERS, Sections.WEBHOOKS];
  const ability = await service.check('org_fixture', new Date(), 'SUPERADMIN', sections.map(section => [AuthorizationActions.Create, section]));
  expect(ability.can(AuthorizationActions.Create, Sections.CHANNEL)).toBe(true);
  expect(ability.can(AuthorizationActions.Create, Sections.POSTS_PER_MONTH)).toBe(true);
  expect(ability.can(AuthorizationActions.Create, Sections.LOCAL_VIDEO_EDIT)).toBe(true);
  for (const section of [Sections.AI, Sections.TEAM_MEMBERS, Sections.WEBHOOKS]) expect(ability.can(AuthorizationActions.Create, section)).toBe(false);
  expect(posts.countPostsFromDay).not.toHaveBeenCalled(); expect(integrations.getIntegrationsList).not.toHaveBeenCalled();
});
it('preserves the existing billing-disabled legacy AI behavior', async () => {
  process.env.BILLING_ENABLED = 'false';
  const service = new PermissionsService({ getSubscriptionByOrganizationId: jest.fn().mockResolvedValue({ subscriptionTier: 'STANDARD' }) } as any, {} as any, {} as any, {} as any);
  const ability = await service.check('org_fixture', new Date(), 'SUPERADMIN', [[AuthorizationActions.Create, Sections.AI]]);
  expect(ability.can(AuthorizationActions.Create, Sections.AI)).toBe(true);
});
it.each(['true', 'false'])('denies a launch API key with billing flag %s', async (flag) => {
  process.env.BILLING_ENABLED = flag;
  const middleware = new PublicAuthMiddleware({ getOrgByApiKey: jest.fn().mockResolvedValue({ subscription: { subscriptionTier: 'LAUNCH_V1' } }) } as any);
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() }; const next = jest.fn();
  await middleware.use({ headers: { authorization: 'fixture_api_key' } } as any, res as any, next);
  expect(res.status).toHaveBeenCalledWith(403); expect(next).not.toHaveBeenCalled();
});

it('permits only the metered guided-copy boundary for Launch, without enabling generic AI', async () => {
  process.env.BILLING_ENABLED = 'true';
  const service = new PermissionsService({ getSubscriptionByOrganizationId: jest.fn().mockResolvedValue({ subscriptionTier: 'LAUNCH_V1' }) } as any, {} as any, {} as any, {} as any);
  const ability = await service.check('org_fixture', new Date(), 'SUPERADMIN', [[AuthorizationActions.Create, Sections.GUIDED_COPY], [AuthorizationActions.Create, Sections.AI]]);
  expect(ability.can(AuthorizationActions.Create, Sections.GUIDED_COPY)).toBe(true);
  expect(ability.can(AuthorizationActions.Create, Sections.AI)).toBe(false);
});

it('allows only owned guided bookkeeping through revoked-plan policies, keeping generic AI denied', async () => {
  process.env.BILLING_ENABLED = 'true';
  const wallet = { existingTextRequest: jest.fn(async (org: string, key: string) =>
    org === 'owner' && key === 'owned-guided-request-key' ? { id: 'held' } : null) };
  const service = new PermissionsService({ getSubscriptionByOrganizationId: async () => null, getSubscription: async () => null } as any,
    { countPostsFromDay: async () => 999999 } as any, {} as any, {} as any, wallet as any);
  const sections = [Sections.GUIDED_COPY, Sections.POSTS_PER_MONTH, Sections.AI, Sections.LOCAL_VIDEO_EDIT];
  for (const [org, key, recovery] of [['owner', 'owned-guided-request-key', true], ['other', 'owned-guided-request-key', false],
    ['owner', 'fresh-guided-request-key', false], ['owner', '*', false]] as const) {
    const ability = await service.check(org, new Date(), 'SUPERADMIN', sections.map(section => [AuthorizationActions.Create, section]), undefined, key);
    expect(ability.can(AuthorizationActions.Create, Sections.GUIDED_COPY)).toBe(recovery);
    expect(ability.can(AuthorizationActions.Create, Sections.POSTS_PER_MONTH)).toBe(recovery);
    expect(ability.can(AuthorizationActions.Create, Sections.AI)).toBe(false);
    expect(ability.can(AuthorizationActions.Create, Sections.LOCAL_VIDEO_EDIT)).toBe(false);
  }
});

it.each([
  ['STANDARD', 'true', true], ['TEAM', 'true', true], ['PRO', 'true', true], ['ULTIMATE', 'true', true],
  ['FREE', 'true', false], [null, 'true', false], ['STANDARD', 'false', true], [null, 'false', true],
])('preserves local editor access for tier=%s billing=%s', async (tier, billing, allowed) => {
  process.env.BILLING_ENABLED = billing as string;
  const service = new PermissionsService({ getSubscriptionByOrganizationId: async () => tier ? { subscriptionTier: tier } : null } as any,
    {} as any, {} as any, {} as any);
  const ability = await service.check('org_fixture', new Date(), 'USER', [[AuthorizationActions.Create, Sections.LOCAL_VIDEO_EDIT]]);
  expect(ability.can(AuthorizationActions.Create, Sections.LOCAL_VIDEO_EDIT)).toBe(allowed);
});

it.each(['true', 'false'])('local Launch admission never reads or reserves AI credits with billing=%s', async (billing) => {
  process.env.BILLING_ENABLED = billing;
  for (const key of keys.slice(1)) process.env[key] = 'false';
  const wallet = { existingTextRequest: jest.fn(), getBalance: jest.fn(), reserve: jest.fn() };
  const subscription = { getSubscriptionByOrganizationId: jest.fn().mockResolvedValue({ subscriptionTier: 'LAUNCH_V1' }) };
  const service = new PermissionsService(subscription as any, {} as any, {} as any, {} as any, wallet as any);
  const ability = await service.check('org_fixture', new Date(), 'USER', [[AuthorizationActions.Create, Sections.LOCAL_VIDEO_EDIT]], undefined, 'owned-guided-request-key');
  expect(ability.can(AuthorizationActions.Create, Sections.LOCAL_VIDEO_EDIT)).toBe(true);
  expect(subscription.getSubscriptionByOrganizationId).toHaveBeenCalledWith('org_fixture');
  for (const operation of Object.values(wallet)) expect(operation).not.toHaveBeenCalled();
});
