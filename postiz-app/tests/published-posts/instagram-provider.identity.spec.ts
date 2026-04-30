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

import { InstagramProvider } from '@gitroom/nestjs-libraries/integrations/social/instagram.provider';
import { InstagramStandaloneProvider } from '@gitroom/nestjs-libraries/integrations/social/instagram.standalone.provider';

describe('InstagramProvider identity mapping', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('uses the Instagram username as the selectable account label', async () => {
    const provider = new InstagramProvider();
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        json: async () => ({
          data: [
            {
              id: 'page-1',
              instagram_business_account: {
                id: 'ig-1',
              },
            },
          ],
        }),
      } as Response)
      .mockResolvedValueOnce({
        json: async () => ({
          data: [],
        }),
      } as Response)
      .mockResolvedValueOnce({
        json: async () => ({
          id: 'ig-1',
          name: 'Arundel Kramer',
          username: 'publisheverywhere',
          profile_picture_url: 'https://example.com/profile.jpg',
        }),
      } as Response);

    global.fetch = fetchMock as typeof fetch;

    await expect(provider.pages('token')).resolves.toEqual([
      {
        pageId: 'page-1',
        id: 'ig-1',
        name: 'publisheverywhere',
        username: 'publisheverywhere',
        picture: {
          data: {
            url: 'https://example.com/profile.jpg',
          },
        },
      },
    ]);
  });

  it('stores the Instagram username as the integration name when available', async () => {
    const provider = new InstagramProvider();
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        json: async () => ({
          access_token: 'page-token',
          name: 'Publish Everywhere Page',
        }),
      } as Response)
      .mockResolvedValueOnce({
        json: async () => ({
          id: 'ig-1',
          name: 'Arundel Kramer',
          username: 'publisheverywhere',
          profile_picture_url: 'https://example.com/ig-profile.jpg',
        }),
      } as Response);

    global.fetch = fetchMock as typeof fetch;

    await expect(
      provider.fetchPageInformation('token', {
        pageId: 'page-1',
        id: 'ig-1',
      })
    ).resolves.toEqual({
      id: 'ig-1',
      name: 'publisheverywhere',
      picture: 'https://example.com/ig-profile.jpg',
      access_token: 'page-token',
      username: 'publisheverywhere',
    });
  });
});

describe('InstagramStandaloneProvider identity mapping', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env.INSTAGRAM_APP_ID = 'instagram-app-id';
    process.env.INSTAGRAM_APP_SECRET = 'instagram-app-secret';
    process.env.FRONTEND_URL = 'https://example.com';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('uses the Instagram username as the saved channel name during authentication', async () => {
    const provider = new InstagramStandaloneProvider();
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        json: async () => ({
          access_token: 'short-lived-token',
          permissions: provider.scopes,
        }),
      } as Response)
      .mockResolvedValueOnce({
        json: async () => ({
          access_token: 'long-lived-token',
          expires_in: 5184000,
        }),
      } as Response)
      .mockResolvedValueOnce({
        json: async () => ({
          user_id: 'ig-1',
          name: 'Arundel Kramer',
          username: 'publisheverywhere',
          profile_picture_url: 'https://example.com/profile.jpg',
        }),
      } as Response);

    global.fetch = fetchMock as typeof fetch;

    await expect(
      provider.authenticate({
        code: 'auth-code',
        codeVerifier: 'verifier',
        refresh: '',
      })
    ).resolves.toMatchObject({
      id: 'ig-1',
      name: 'publisheverywhere',
      accessToken: 'long-lived-token',
      refreshToken: 'long-lived-token',
      picture: 'https://example.com/profile.jpg',
      username: 'publisheverywhere',
    });
  });

  it('uses the Instagram username as the refreshed channel name when available', async () => {
    const provider = new InstagramStandaloneProvider();
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        json: async () => ({
          access_token: 'refreshed-token',
        }),
      } as Response)
      .mockResolvedValueOnce({
        json: async () => ({
          user_id: 'ig-1',
          name: 'Arundel Kramer',
          username: 'publisheverywhere',
          profile_picture_url: 'https://example.com/profile.jpg',
        }),
      } as Response);

    global.fetch = fetchMock as typeof fetch;

    await expect(provider.refreshToken('existing-refresh-token')).resolves.toMatchObject({
      id: 'ig-1',
      name: 'publisheverywhere',
      accessToken: 'refreshed-token',
      refreshToken: 'refreshed-token',
      picture: 'https://example.com/profile.jpg',
      username: 'publisheverywhere',
    });
  });
});
