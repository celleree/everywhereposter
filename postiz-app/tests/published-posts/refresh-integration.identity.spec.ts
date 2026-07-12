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

jest.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({
  IntegrationManager: class IntegrationManager {},
}));

import { RefreshIntegrationService } from '@gitroom/nestjs-libraries/integrations/refresh.integration.service';

describe('RefreshIntegrationService identity persistence', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('persists refreshed Instagram usernames as the integration name and profile', async () => {
    const provider = {
      oneTimeToken: false,
      refreshToken: jest.fn().mockResolvedValue({
        id: 'ig-1',
        name: 'publisheverywhere',
        username: 'publisheverywhere',
        picture: 'https://example.com/new-profile.jpg',
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
        expiresIn: 5184000,
      }),
    };

    const integrationService = {
      createOrUpdateIntegration: jest.fn().mockResolvedValue({}),
      refreshNeeded: jest.fn(),
      informAboutRefreshError: jest.fn(),
      disconnectChannel: jest.fn(),
    };

    const service = new RefreshIntegrationService(
      {
        getSocialIntegration: jest.fn().mockReturnValue(provider),
      } as any,
      integrationService as any,
      {} as any
    );

    await expect(
      service.refresh({
        id: 'integration-1',
        organizationId: 'org-1',
        internalId: 'ig-1',
        rootInternalId: 'ig-1',
        providerIdentifier: 'instagram-standalone',
        name: 'Arundel Kramer',
        profile: null,
        picture: 'https://example.com/old-profile.jpg',
        refreshToken: 'old-refresh-token',
      } as any)
    ).resolves.toMatchObject({
      name: 'publisheverywhere',
      username: 'publisheverywhere',
    });

    expect(integrationService.createOrUpdateIntegration).toHaveBeenCalledWith(
      undefined,
      false,
      'org-1',
      'publisheverywhere',
      'https://example.com/new-profile.jpg',
      'social',
      'ig-1',
      'instagram-standalone',
      'new-access-token',
      'new-refresh-token',
      5184000,
      'publisheverywhere'
    );
  });
});
