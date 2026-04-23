jest.mock('@gitroom/nestjs-libraries/upload/upload.factory', () => ({
  UploadFactory: {
    createStorage: jest.fn(() => ({
      uploadFile: jest.fn(),
    })),
  },
}));

jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: {
    get: jest.fn(),
    set: jest.fn(),
  },
}));

jest.mock('@sentry/nestjs', () => ({
  metrics: {
    count: jest.fn(),
  },
}));

jest.mock('@gitroom/helpers/utils/strip.html.validation', () => ({
  stripHtmlValidation: jest.fn(
    (
      _editor: string,
      content: string
    ) => content
  ),
}));

jest.mock('sharp', () => {
  const sharp = jest.fn(() => ({
    jpeg: jest.fn().mockReturnThis(),
    toBuffer: jest.fn(),
  }));

  return {
    __esModule: true,
    default: sharp,
  };
});

jest.mock('bcrypt', () => ({
  compareSync: jest.fn(),
  hashSync: jest.fn(),
}));

jest.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({
  IntegrationManager: class IntegrationManager {},
}));

import { BadRequestException } from '@nestjs/common';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { RefreshToken } from '@gitroom/nestjs-libraries/integrations/social.abstract';

const createProvider = (overrides: Record<string, any> = {}) => ({
  identifier: 'x',
  name: 'X',
  editor: 'normal',
  isBetweenSteps: false,
  scopes: [],
  refreshWait: false,
  maxLength: () => 280,
  getPublishedCapabilities: jest.fn(() => ({
    editMode: 'metadata',
    canDeletePublished: true,
    requiresReconnect: false,
    constraints: [],
  })),
  update: jest.fn(),
  deletePublished: jest.fn(),
  ...overrides,
});

const createService = (providerOverrides: Record<string, any> = {}) => {
  const provider = createProvider(providerOverrides);

  const postRepository = {
    changeState: jest.fn(),
    createOrUpdatePost: jest.fn(),
    deletePost: jest.fn(),
    getPostUrls: jest.fn().mockResolvedValue([]),
    getPostsByGroup: jest.fn(),
    markPostsRemoteDeleted: jest.fn(),
    updateImages: jest.fn(),
    updatePost: jest.fn(),
  };

  const integrationManager = {
    getSocialIntegration: jest.fn(() => provider),
  };

  const integrationService = {
    disconnectChannel: jest.fn(),
    getIntegrationById: jest.fn(),
    getPlugs: jest.fn().mockResolvedValue([]),
  };

  const mediaService = {
    getMediaById: jest.fn(),
  };

  const shortLinkService = {
    convertTextToShortLinks: jest.fn(),
  };

  const openaiService = {
    separatePosts: jest.fn(),
  };

  const temporalService = {
    client: {
      getRawClient: jest.fn(() => ({
        workflow: {
          list: jest.fn(),
        },
      })),
      getWorkflowHandle: jest.fn(),
    },
  };

  const refreshIntegrationService = {
    refresh: jest.fn(),
  };

  return {
    provider,
    postRepository,
    integrationService,
    refreshIntegrationService,
    service: new PostsService(
      postRepository as any,
      integrationManager as any,
      integrationService as any,
      mediaService as any,
      shortLinkService as any,
      openaiService as any,
      temporalService as any,
      refreshIntegrationService as any
    ),
  };
};

const publishedIntegration = {
  id: 'integration-db-id',
  providerIdentifier: 'x',
  internalId: 'provider-internal-id',
  token: 'token-1',
  tokenExpiration: null,
  refreshNeeded: false,
  additionalSettings: '[]',
};

describe('PostsService published post management', () => {
  it('updates a published post through the provider when edit support is enabled', async () => {
    const { service, provider, postRepository } = createService();

    postRepository.getPostsByGroup.mockResolvedValue([
      {
        id: 'old-root-post',
        group: 'group-1',
        parentPostId: null,
        state: 'PUBLISHED',
        releaseId: 'release-1',
        releaseURL: 'https://example.com/original',
        integration: { ...publishedIntegration },
      },
    ]);

    postRepository.createOrUpdatePost.mockResolvedValue({
      posts: [
        {
          id: 'new-root-post',
          content: 'Updated post copy',
          settings: '{}',
          image: '[]',
        },
      ],
    });

    provider.update.mockResolvedValue([
      {
        id: 'new-root-post',
        postId: 'release-2',
        releaseURL: 'https://example.com/updated',
        status: 'success',
      },
    ]);

    const result = await service.createPost('org-1', {
      type: 'update',
      shortLink: false,
      date: '2026-04-21T15:00:00.000Z',
      tags: [],
      posts: [
        {
          integration: { id: 'integration-db-id' },
          group: 'group-1',
          settings: { __type: 'x' },
          value: [
            {
              id: 'new-root-post',
              content: 'Updated post copy',
              image: [],
            },
          ],
        },
      ],
    } as any);

    expect(result).toEqual([
      {
        postId: 'new-root-post',
        integration: 'integration-db-id',
      },
    ]);

    expect(provider.update).toHaveBeenCalledWith(
      'provider-internal-id',
      'token-1',
      'release-1',
      [
        {
          id: 'new-root-post',
          message: 'Updated post copy',
          settings: {},
          media: [],
        },
      ],
      expect.objectContaining({
        id: 'integration-db-id',
        providerIdentifier: 'x',
      })
    );

    expect(postRepository.updatePost).toHaveBeenCalledWith(
      'new-root-post',
      'release-2',
      'https://example.com/updated'
    );
  });

  it('deletes a published post on-platform when delete support is enabled', async () => {
    const { service, provider, postRepository } = createService();

    postRepository.getPostsByGroup.mockResolvedValue([
      {
        id: 'published-root-post',
        group: 'group-1',
        parentPostId: null,
        state: 'PUBLISHED',
        releaseId: 'release-1',
        integration: { ...publishedIntegration },
      },
    ]);

    provider.deletePublished.mockResolvedValue({
      status: 'deleted',
    });

    const result = await service.deletePublishedPost('org-1', 'group-1');

    expect(result).toEqual({
      success: true,
      status: 'deleted',
    });
    expect(provider.deletePublished).toHaveBeenCalledWith(
      'provider-internal-id',
      'token-1',
      'release-1',
      expect.objectContaining({
        id: 'integration-db-id',
      })
    );
    expect(postRepository.markPostsRemoteDeleted).toHaveBeenCalledWith(
      'org-1',
      'group-1'
    );
  });

  it('refreshes the integration token and retries platform delete after a refresh-token error', async () => {
    const { service, provider, postRepository, refreshIntegrationService } =
      createService();

    postRepository.getPostsByGroup.mockResolvedValue([
      {
        id: 'published-root-post',
        group: 'group-1',
        parentPostId: null,
        state: 'PUBLISHED',
        releaseId: 'release-1',
        integration: { ...publishedIntegration },
      },
    ]);

    provider.deletePublished
      .mockRejectedValueOnce(
        new RefreshToken('x', '{}', {} as any, 'refresh me')
      )
      .mockResolvedValueOnce({
        status: 'deleted',
      });

    refreshIntegrationService.refresh.mockResolvedValue({
      accessToken: 'token-2',
    });

    const result = await service.deletePublishedPost('org-1', 'group-1');

    expect(result).toEqual({
      success: true,
      status: 'deleted',
    });
    expect(refreshIntegrationService.refresh).toHaveBeenCalledTimes(1);
    expect(provider.deletePublished).toHaveBeenNthCalledWith(
      2,
      'provider-internal-id',
      'token-2',
      'release-1',
      expect.any(Object)
    );
  });

  it('blocks platform deletes when the connected provider still advertises delete as unavailable', async () => {
    const { service, postRepository } = createService({
      getPublishedCapabilities: jest.fn(() => ({
        editMode: 'none',
        canDeletePublished: false,
        requiresReconnect: false,
        reason: 'Delete unavailable for this connection.',
        constraints: [],
      })),
    });

    postRepository.getPostsByGroup.mockResolvedValue([
      {
        id: 'published-root-post',
        group: 'group-1',
        parentPostId: null,
        state: 'PUBLISHED',
        releaseId: 'release-1',
        integration: { ...publishedIntegration },
      },
    ]);

    await expect(
      service.deletePublishedPost('org-1', 'group-1')
    ).rejects.toThrow(new BadRequestException('Delete unavailable for this connection.'));
  });

  it('returns a success payload after removing a post from Publish Everywhere', async () => {
    const { service, postRepository } = createService();

    postRepository.deletePost.mockResolvedValue(undefined);

    await expect(service.deletePost('org-1', 'group-1')).resolves.toEqual({
      success: true,
    });
  });
});
