jest.mock('@sentry/nestjs', () => ({ suppressTracing: (run: any) => run() }));
jest.mock('@gitroom/nestjs-libraries/upload/upload.factory', () => ({ UploadFactory: {
  createStorage: () => ({ uploadSimple: async (value: any) => value }),
} }));
jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({ ioRedis: { get: jest.fn(), del: jest.fn() } }));
jest.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({ IntegrationManager: class {} }));
jest.mock('sharp', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('bcrypt', () => ({ compareSync: jest.fn(), hashSync: jest.fn() }));
import { NoAuthIntegrationsController } from '@gitroom/backend/api/routes/no.auth.integrations.controller';
import { IntegrationService, hasYoutubeOfflineAuthorization } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { IntegrationRepository } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.repository';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import { NotEnoughScopes } from '@gitroom/nestjs-libraries/integrations/social.abstract';

async function expectCallbackDenied(run: () => Promise<unknown>, message: string) {
  let rejected: unknown;
  try { await run(); } catch (error) { rejected = error; }
  // This is the established plain rejection object handled by the route's
  // NotEnoughScopesFilter, not an Error subclass for Jest's toThrow matcher.
  expect(rejected).toBeInstanceOf(NotEnoughScopes);
  expect((rejected as NotEnoughScopes).message).toContain(message);
}

const auth = { id: 'google-user', name: 'User', picture: '', username: '',
  accessToken: 'synthetic-new-access', refreshToken: 'synthetic-new-refresh', expiresIn: 3600 };
const invalid = [
  ['omitted refresh token (legitimate Google response)', { refreshToken: undefined }],
  ['blank refresh token', { refreshToken: ' ' }], ['missing access', { accessToken: '' }],
  ['omitted expiry', { expiresIn: undefined }], ['expired', { expiresIn: -1 }],
  ['nonfinite expiry', { expiresIn: Infinity }], ['invalid expiry', { expiresIn: NaN }],
] as const;
function callback(reconnect = true, platform = 'youtube') {
  (ioRedis.get as jest.Mock).mockImplementation(async (key: string) => key.startsWith('login:') ? 'verifier'
    : key.startsWith('organization:') ? 'org' : key.startsWith('refresh:') && reconnect ? 'channel' : null);
  const provider = { authenticate: jest.fn().mockResolvedValue({ ...auth }),
    reConnect: jest.fn().mockResolvedValue({ id: 'channel', name: 'Channel', picture: '', username: '@channel', accessToken: auth.accessToken }),
    pages: jest.fn().mockResolvedValue([]), isBetweenSteps: true };
  const persistence = { createOrUpdateIntegration: jest.fn().mockResolvedValue({ id: 'pending' }) };
  const controller = new NoAuthIntegrationsController({ getAllowedSocialsIntegrations: () => [platform], getSocialIntegration: () => provider } as any,
    persistence as any, { startRefreshWorkflow: jest.fn().mockResolvedValue(undefined) } as any,
    { getOrgById: async () => ({ id: 'org' }) } as any);
  const run = () => controller.connectSocialMedia(platform, { state: 'state', code: 'code', timezone: '0', refresh: 'not-a-Google-credential' });
  return { provider, persistence, run };
}
function selection(existing = true, platform = 'youtube') {
  const expires = new Date(Date.now() + 3600000);
  const pending: any = { id: 'pending', organizationId: 'org', internalId: 'google-user', providerIdentifier: platform,
    inBetweenSteps: true, token: auth.accessToken, refreshToken: auth.refreshToken, tokenExpiration: expires };
  const saved: any = { id: 'saved-channel', organizationId: 'org', internalId: 'channel', name: 'Old name',
    refreshNeeded: true, refreshToken: 'synthetic-old-refresh', tokenExpiration: new Date(0) };
  const scheduled = { integrationId: saved.id, state: 'QUEUE', deletedAt: null };
  const model = { findUnique: jest.fn(async ({ where }: any) => existing && where.organizationId_internalId.organizationId === 'org' ? saved : null),
    update: jest.fn(async ({ where, data }: any) => Object.assign(where.id === saved.id ? saved : pending, data)) };
  const posts = { updateMany: jest.fn(async ({ where, data }: any) => {
    if (where.integrationId === scheduled.integrationId) Object.assign(scheduled, data); return { count: 0 };
  }) };
  const repository = new IntegrationRepository({ model: { integration: model } } as any, { model: { post: posts } } as any,
    {} as any, {} as any, {} as any, {} as any, {} as any);
  const get = jest.spyOn(repository, 'getIntegrationById').mockImplementation(async (org) => org === 'org' ? pending : null as any);
  const cleanup = jest.spyOn(repository, 'checkForDeletedOnceAndUpdate').mockResolvedValue(undefined as any);
  const provider = { fetchPageInformation: jest.fn().mockResolvedValue({ id: 'channel', name: 'Updated', username: '@channel', access_token: auth.accessToken }) };
  const service = new IntegrationService(repository, {} as any, { getSocialIntegration: () => provider } as any,
    {} as any, {} as any, {} as any);
  return { service, provider, repository, get, cleanup, model, posts, pending, saved, scheduled, expires };
}
afterEach(() => jest.restoreAllMocks());

it.each([false, true])('preserves fresh Google authorization on initial/reconnect callback (reconnect=%s)', async reconnect => {
  const f = callback(reconnect); await f.run();
  expect(f.persistence.createOrUpdateIntegration.mock.calls[0].slice(8, 11)).toEqual([auth.accessToken, auth.refreshToken, auth.expiresIn]);
  if (reconnect) expect(f.provider.reConnect).toHaveBeenCalledWith('google-user', 'channel', auth.accessToken);
});
it.each(invalid)('does not replace a saved grant when Google returns %s', async (_, patch) => {
  const f = callback(); f.provider.authenticate.mockResolvedValue({ ...auth, ...patch } as any);
  await expectCallbackDenied(f.run, 'Your saved channel was not changed');
  expect(f.persistence.createOrUpdateIntegration).not.toHaveBeenCalled(); expect(f.provider.reConnect).not.toHaveBeenCalled();
});
it.each(['authenticate', 'reConnect'] as const)('sanitizes %s failure before persistence', async method => {
  const f = callback(); f.provider[method].mockRejectedValue(Error('synthetic-private-provider-detail'));
  const log = jest.spyOn(console, 'error').mockImplementation(() => {});
  await expectCallbackDenied(f.run, 'Your saved channel was not changed');
  expect(f.persistence.createOrUpdateIntegration).not.toHaveBeenCalled(); expect(log).not.toHaveBeenCalled();
});
it('refuses reconnecting a different channel', async () => {
  const f = callback(); f.provider.reConnect.mockResolvedValue({ ...auth, id: 'wrong-channel' } as any);
  await expectCallbackDenied(f.run, 'Please refresh the channel'); expect(f.persistence.createOrUpdateIntegration).not.toHaveBeenCalled();
});
it.each([false, true])('selects a new/existing channel with fresh offline metadata (existing=%s)', async existing => {
  const f = selection(existing); await f.service.saveProviderPage('org', 'pending', { id: 'channel' });
  const result = existing ? f.saved : f.pending;
  expect(result).toMatchObject({ id: existing ? 'saved-channel' : 'pending', internalId: 'channel', refreshNeeded: false,
    refreshToken: auth.refreshToken, token: auth.accessToken, tokenExpiration: f.expires, inBetweenSteps: false });
  expect(f.scheduled).toEqual({ integrationId: 'saved-channel', state: 'QUEUE', deletedAt: null });
});
it.each([undefined, '', ' '])('retains the saved channel when the pending refresh token is %s', async refreshToken => {
  const f = selection(); f.pending.refreshToken = refreshToken;
  await expect(f.service.saveProviderPage('org', 'pending', { id: 'channel' })).rejects.toThrow('Your saved channel was not changed');
  expect(f.provider.fetchPageInformation).not.toHaveBeenCalled(); expect(f.cleanup).not.toHaveBeenCalled(); expect(f.model.update).not.toHaveBeenCalled();
  expect(f.saved.refreshNeeded).toBe(true); expect(f.saved.refreshToken).toBe('synthetic-old-refresh');
});
it.each([null, new Date(0), new Date(NaN)])('refuses missing/expired/invalid pending expiry: %s', async expiry => {
  const f = selection(); f.pending.tokenExpiration = expiry;
  await expect(f.service.saveProviderPage('org', 'pending', { id: 'channel' })).rejects.toThrow('Your saved channel was not changed');
  expect(f.model.update).not.toHaveBeenCalled(); expect(f.provider.fetchPageInformation).not.toHaveBeenCalled();
});
it.each(['failure', 'wrong-channel', 'wrong-access', 'expired-during-lookup'])('does not write on unverified channel result: %s', async outcome => {
  const f = selection(); f.provider.fetchPageInformation.mockImplementation(async () => {
    if (outcome === 'failure') throw Error('synthetic-private-provider-detail');
    if (outcome === 'expired-during-lookup') f.pending.tokenExpiration = new Date(0);
    return { id: outcome === 'wrong-channel' ? 'other' : 'channel', name: 'Updated', username: '@channel',
      access_token: outcome === 'wrong-access' ? 'synthetic-unbound' : auth.accessToken };
  });
  await expect(f.service.saveProviderPage('org', 'pending', { id: 'channel' })).rejects.toThrow('YouTube channel authorization could not be verified');
  expect(f.cleanup).not.toHaveBeenCalled(); expect(f.model.update).not.toHaveBeenCalled();
});
it('denies foreign organization input before provider or mutation', async () => {
  const f = selection(); await expect(f.service.saveProviderPage('foreign-org', 'pending', { id: 'channel' })).rejects.toThrow('Integration not found');
  expect(f.get).toHaveBeenCalledWith('foreign-org', 'pending'); expect(f.provider.fetchPageInformation).not.toHaveBeenCalled(); expect(f.model.update).not.toHaveBeenCalled();
});
it('preserves Instagram credential transfer', async () => {
  const f = selection(true, 'instagram'); await f.service.saveProviderPage('org', 'pending', { id: 'channel' });
  expect(f.saved).toMatchObject({ id: 'saved-channel', token: auth.accessToken, refreshToken: auth.refreshToken, tokenExpiration: f.expires, refreshNeeded: false });
});
it('does not interpret omitted refresh metadata as a usable replacement', () => {
  expect(hasYoutubeOfflineAuthorization(auth)).toBe(true);
  expect(hasYoutubeOfflineAuthorization({ ...auth, refreshToken: undefined })).toBe(false);
});
