jest.mock('@sentry/nestjs', () => ({
  suppressTracing: jest.fn((callback) => callback()),
}));
jest.mock('@gitroom/nestjs-libraries/upload/upload.factory', () => ({
  UploadFactory: {
    createStorage: jest.fn(() => ({
      uploadSimple: jest.fn(async (value) => value),
    })),
  },
}));
jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: { get: jest.fn(), del: jest.fn(), set: jest.fn() },
}));
jest.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({
  IntegrationManager: class {},
}));
jest.mock('sharp', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('bcrypt', () => ({ compareSync: jest.fn(), hashSync: jest.fn() }));
import { NoAuthIntegrationsController } from '@gitroom/backend/api/routes/no.auth.integrations.controller';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { IntegrationRepository } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.repository';
import { InstagramProvider } from '@gitroom/nestjs-libraries/integrations/social/instagram.provider';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';

const auth = {
  id: '789',
  name: 'User',
  username: 'user',
  picture: '',
  accessToken: 'CURRENT_USER_SECRET',
  refreshToken: 'CURRENT_USER_SECRET',
  expiresIn: 5000,
};
describe('Facebook Login Instagram User credential lifecycle', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });
  it('initial authenticate returns the exchanged User token separately for Page selection', async () => {
    const provider = new InstagramProvider();
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        json: async () => ({ access_token: 'SHORT_TOKEN' }),
      })
      .mockResolvedValueOnce({
        json: async () => ({
          access_token: 'CURRENT_USER_SECRET',
          expires_in: 5000,
        }),
      })
      .mockResolvedValueOnce({
        json: async () => ({
          data: provider.scopes.map((permission) => ({
            permission,
            status: 'granted',
          })),
        }),
      })
      .mockResolvedValueOnce({
        json: async () => ({ id: '789', name: 'User' }),
      });
    expect(
      await provider.authenticate({
        code: 'code',
        codeVerifier: 'verifier',
        refresh: '',
      })
    ).toMatchObject({
      accessToken: 'CURRENT_USER_SECRET',
      refreshToken: 'CURRENT_USER_SECRET',
      expiresIn: expect.any(Number),
    });
  });
  it.each([false, true])(
    'persists first/reconnect credentials and never returns either token (reconnect=%s)',
    async (reconnect) => {
      (ioRedis.get as jest.Mock).mockImplementation(async (key) =>
        key.startsWith('login:')
          ? 'verifier'
          : key.startsWith('organization:')
          ? 'org'
          : key.startsWith('refresh:') && reconnect
          ? '123'
          : null
      );
      const provider = {
        authenticate: jest.fn().mockResolvedValue(auth),
        reConnect: jest.fn().mockResolvedValue({
          id: '123',
          name: 'Acting',
          username: 'acting',
          accessToken: 'PAGE_SECRET',
          picture: '',
        }),
        isBetweenSteps: true,
        pages: jest
          .fn()
          .mockResolvedValue([{ id: '123', pageId: '999', name: 'Acting' }]),
      };
      const persistence = {
        createOrUpdateIntegration: jest
          .fn()
          .mockImplementation(async (...args) => ({
            id: 'integration',
            name: args[3],
            token: args[8],
            refreshToken: args[9],
            customInstanceDetails: 'SECRET_CONFIG',
          })),
      };
      const controller = new NoAuthIntegrationsController(
        {
          getAllowedSocialsIntegrations: () => ['instagram'],
          getSocialIntegration: () => provider,
        } as any,
        persistence as any,
        { startRefreshWorkflow: jest.fn().mockResolvedValue(undefined) } as any,
        { getOrgById: jest.fn().mockResolvedValue({ id: 'org' }) } as any
      );
      const result = await controller.connectSocialMedia('instagram', {
        state: 'state',
        code: 'code',
        refresh: reconnect ? '123' : '',
        timezone: '0',
      } as any);
      expect(
        persistence.createOrUpdateIntegration.mock.calls[0].slice(8, 11)
      ).toEqual([
        reconnect ? 'PAGE_SECRET' : 'CURRENT_USER_SECRET',
        'CURRENT_USER_SECRET',
        5000,
      ]);
      expect(JSON.stringify(result)).not.toMatch(
        /SECRET|refreshToken|"token"|customInstanceDetails/
      );
      if (reconnect)
        expect(provider.reConnect).toHaveBeenCalledWith(
          '789',
          '123',
          'CURRENT_USER_SECRET'
        );
    }
  );
  it('retains other provider reconnect behavior', async () => {
    (ioRedis.get as jest.Mock).mockImplementation(async (key) =>
      key.startsWith('login:')
        ? 'verifier'
        : key.startsWith('organization:')
        ? 'org'
        : key.startsWith('refresh:')
        ? '123'
        : null
    );
    const provider = {
      authenticate: jest.fn().mockResolvedValue(auth),
      reConnect: jest.fn().mockResolvedValue({
        id: '123',
        name: 'Other',
        accessToken: 'OTHER_TOKEN',
      }),
    };
    const persistence = {
      createOrUpdateIntegration: jest
        .fn()
        .mockResolvedValue({ id: 'integration' }),
    };
    const controller = new NoAuthIntegrationsController(
      {
        getAllowedSocialsIntegrations: () => ['facebook'],
        getSocialIntegration: () => provider,
      } as any,
      persistence as any,
      { startRefreshWorkflow: jest.fn().mockResolvedValue(undefined) } as any,
      { getOrgById: jest.fn().mockResolvedValue({ id: 'org' }) } as any
    );
    await controller.connectSocialMedia('facebook', {
      state: 'state',
      code: 'code',
      refresh: '123',
    } as any);
    expect(
      persistence.createOrUpdateIntegration.mock.calls[0].slice(8, 11)
    ).toEqual(['OTHER_TOKEN', '123', undefined]);
  });
  it.each([false, true])(
    'Page selection carries current User metadata into new/existing integration (existing=%s)',
    async (existing) => {
      const expires = new Date(Date.now() + 5000000);
      const model = {
        findUnique: jest
          .fn()
          .mockResolvedValue(existing ? { id: 'existing' } : null),
        update: jest.fn().mockImplementation(async (value) => value.data),
      };
      const repository = new IntegrationRepository(
        { model: { integration: model } } as any,
        { model: { post: { updateMany: jest.fn() } } } as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any
      );
      jest.spyOn(repository, 'getIntegrationById').mockResolvedValue({
        id: 'pending',
        organizationId: 'org',
        providerIdentifier: 'instagram',
        inBetweenSteps: true,
        token: 'CURRENT_USER_SECRET',
        refreshToken: 'CURRENT_USER_SECRET',
        tokenExpiration: expires,
      } as any);
      jest
        .spyOn(repository, 'checkForDeletedOnceAndUpdate')
        .mockResolvedValue(undefined as any);
      const provider = {
        fetchPageInformation: jest.fn().mockResolvedValue({
          id: '123',
          name: 'Acting',
          username: 'acting',
          access_token: 'PAGE_SECRET',
        }),
      };
      const service = new IntegrationService(
        repository,
        {} as any,
        { getSocialIntegration: () => provider } as any,
        {} as any,
        {} as any,
        {} as any
      );
      expect(
        await service.saveProviderPage('org', 'pending', {
          pageId: '999',
          id: '123',
        })
      ).toEqual({ success: true });
      expect(provider.fetchPageInformation).toHaveBeenCalledWith(
        'CURRENT_USER_SECRET',
        { pageId: '999', id: '123' }
      );
      expect(model.update).toHaveBeenLastCalledWith({
        where: { id: existing ? 'existing' : 'pending' },
        data: expect.objectContaining({
          token: 'PAGE_SECRET',
          refreshToken: 'CURRENT_USER_SECRET',
          tokenExpiration: expires,
          refreshNeeded: false,
        }),
      });
    }
  );
  it.each(['authenticate', 'reConnect'])(
    'sanitizes %s failure without logging credentials',
    async (failedMethod) => {
      (ioRedis.get as jest.Mock).mockImplementation(async (key) =>
        key.startsWith('login:')
          ? 'verifier'
          : key.startsWith('organization:')
          ? 'org'
          : key.startsWith('refresh:')
          ? '123'
          : null
      );
      const provider = {
        authenticate: jest.fn().mockResolvedValue(auth),
        reConnect: jest.fn().mockResolvedValue({ id: '123' }),
      };
      provider[failedMethod].mockRejectedValue(
        new Error('https://graph.facebook.com?access_token=USER_SECRET')
      );
      const log = jest.spyOn(console, 'error');
      const controller = new NoAuthIntegrationsController(
        {
          getAllowedSocialsIntegrations: () => ['instagram'],
          getSocialIntegration: () => provider,
        } as any,
        {} as any,
        {} as any,
        { getOrgById: jest.fn().mockResolvedValue({ id: 'org' }) } as any
      );
      try {
        await controller.connectSocialMedia('instagram', {
          state: 'state',
          code: 'code',
          refresh: '123',
        } as any);
        throw new Error('unexpected success');
      } catch (error) {
        expect((error as Error).message).not.toContain('USER_SECRET');
        expect((error as Error).message).toContain('Instagram');
      }
      expect(log).not.toHaveBeenCalled();
    }
  );
});
