jest.mock('@gitroom/nestjs-libraries/agent/agent.graph.service', () => ({
  AgentGraphService: class {},
}));
jest.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({
  IntegrationManager: class {},
}));
jest.mock('@gitroom/nestjs-libraries/upload/upload.factory', () => ({
  UploadFactory: { createStorage: jest.fn(() => ({})) },
}));
jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: {},
}));
jest.mock('sharp', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('bcrypt', () => ({ compareSync: jest.fn(), hashSync: jest.fn() }));
import { PostsController } from '../../apps/backend/src/api/routes/posts.controller';
import { IntegrationsController } from '../../apps/backend/src/api/routes/integrations.controller';
import { isExposedProviderFunction } from '../../libraries/nestjs-libraries/src/integrations/provider-function-exposure';

describe('Facebook management authorization and dispatch boundaries', () => {
  it.each(['USER', 'unknown', undefined])(
    'rejects unauthorized role %s even without Stripe',
    (role) => {
      const mutate = jest.fn();
      const controller = new PostsController(
        { mutateFacebookPublished: mutate } as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any
      );
      expect(() =>
        controller.mutateFacebookPublished(
          { id: 'org', users: [{ role }] } as any,
          'post',
          { action: 'delete', revision: 0 }
        )
      ).toThrow('administrator');
      expect(mutate).not.toHaveBeenCalled();
    }
  );
  it.each(['ADMIN', 'SUPERADMIN'])(
    'uses authenticated organization for %s',
    (role) => {
      const mutate = jest.fn();
      const controller = new PostsController(
        { mutateFacebookPublished: mutate } as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any
      );
      controller.mutateFacebookPublished(
        { id: 'org', users: [{ role }] } as any,
        'post',
        { action: 'delete', revision: 0 }
      );
      expect(mutate).toHaveBeenCalledWith('org', 'post', {
        action: 'delete',
        revision: 0,
      });
    }
  );
  it.each([
    'update',
    'deletePublished',
    'post',
    'readPublishedText',
    'publishedRequest',
    'constructor',
    '__proto__',
    'authenticate',
  ])(
    'rejects arbitrary provider method %s before loading credentials',
    async (name) => {
      const controller: any = Object.create(IntegrationsController.prototype);
      controller._integrationService = { getIntegrationById: jest.fn() };
      await expect(
        controller.functionIntegration(
          { id: 'org' },
          { id: 'integration', name }
        )
      ).rejects.toThrow('not exposed');
      expect(
        controller._integrationService.getIntegrationById
      ).not.toHaveBeenCalled();
    }
  );
  it.each([
    'listMedia',
    'mention',
    'company',
    'companies',
    'pages',
    'groups',
    'label',
    'channels',
    'boards',
    'creatorInfo',
    'organizations',
    'tags',
    'publications',
    'teams',
    'postTypes',
    'list',
    'templates',
    'experiences',
    'restrictions',
    'subreddits',
  ])('preserves existing read helper %s', async (name) => {
    expect(isExposedProviderFunction(name)).toBe(true);
    const method = jest.fn().mockResolvedValue([]);
    const controller: any = Object.create(IntegrationsController.prototype);
    controller._integrationService = {
      getIntegrationById: jest
        .fn()
        .mockResolvedValue({
          id: 'integration',
          internalId: 'page',
          token: 'private',
          providerIdentifier: 'fixture',
        }),
    };
    controller._integrationManager = {
      getSocialIntegration: () => ({ [name]: method }),
    };
    await controller.functionIntegration(
      { id: 'org' },
      { id: 'integration', name, data: {} }
    );
    expect(method).toHaveBeenCalledTimes(1);
  });
});
