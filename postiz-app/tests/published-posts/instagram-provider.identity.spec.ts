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
