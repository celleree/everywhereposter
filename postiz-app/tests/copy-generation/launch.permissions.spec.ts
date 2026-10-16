import { PermissionsService } from '../../apps/backend/src/services/auth/permissions/permissions.service';
import { AuthorizationActions, Sections } from '../../apps/backend/src/services/auth/permissions/permission.exception.class';
import { PublicAuthMiddleware } from '../../apps/backend/src/services/auth/public.auth.middleware';

jest.mock('@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service', () => ({ SubscriptionService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/posts/posts.service', () => ({ PostsService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/integrations/integration.service', () => ({ IntegrationService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/webhooks/webhooks.service', () => ({ WebhooksService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/organizations/organization.service', () => ({ OrganizationService: class {} }));
const saved = process.env.BILLING_ENABLED;
afterAll(() => { if (saved === undefined) delete process.env.BILLING_ENABLED; else process.env.BILLING_ENABLED = saved; });
it.each(['true', 'false'])('launch permits unlimited ordinary posting but rejects unmetered AI with billing flag %s', async (flag) => {
  process.env.BILLING_ENABLED = flag;
  const posts = { countPostsFromDay: jest.fn().mockResolvedValue(9999999) };
  const integrations = { getIntegrationsList: jest.fn().mockResolvedValue(Array(10000).fill({})) };
  const service = new PermissionsService({ getSubscriptionByOrganizationId: jest.fn().mockResolvedValue({ subscriptionTier: 'LAUNCH_V1', totalChannels: 0 }) } as any,
    posts as any, integrations as any, { getTotal: jest.fn().mockResolvedValue(0) } as any);
  const sections = [Sections.CHANNEL, Sections.POSTS_PER_MONTH, Sections.AI, Sections.TEAM_MEMBERS, Sections.WEBHOOKS];
  const ability = await service.check('org_fixture', new Date(), 'SUPERADMIN', sections.map(section => [AuthorizationActions.Create, section]));
  expect(ability.can(AuthorizationActions.Create, Sections.CHANNEL)).toBe(true);
  expect(ability.can(AuthorizationActions.Create, Sections.POSTS_PER_MONTH)).toBe(true);
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
