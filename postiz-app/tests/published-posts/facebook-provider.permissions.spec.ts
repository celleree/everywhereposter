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

import { FacebookProvider } from '@gitroom/nestjs-libraries/integrations/social/facebook.provider';

describe('FacebookProvider permissions upgrade', () => {
  const originalFetch = global.fetch;
  const originalAppId = process.env.FACEBOOK_APP_ID;
  const originalAppSecret = process.env.FACEBOOK_APP_SECRET;
  const originalFrontendUrl = process.env.FRONTEND_URL;

  beforeEach(() => {
    process.env.FACEBOOK_APP_ID = 'fb-app-id';
    process.env.FACEBOOK_APP_SECRET = 'fb-app-secret';
    process.env.FRONTEND_URL = 'https://example.com';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env.FACEBOOK_APP_ID = originalAppId;
    process.env.FACEBOOK_APP_SECRET = originalAppSecret;
    process.env.FRONTEND_URL = originalFrontendUrl;
    jest.restoreAllMocks();
  });

  it('includes pages_read_user_content in the Facebook scope list in the expected order', () => {
    expect(new FacebookProvider().scopes).toEqual([
      'pages_show_list',
      'business_management',
      'pages_manage_posts',
      'pages_manage_engagement',
      'pages_read_user_content',
      'pages_read_engagement',
      'read_insights',
    ]);
  });

  it('requests pages_read_user_content in the generated OAuth URL', async () => {
    const provider = new FacebookProvider();

    const { url } = await provider.generateAuthUrl();
    const parsedUrl = new URL(url);

    expect(parsedUrl.searchParams.get('scope')).toBe(
      provider.scopes.join(',')
    );
    expect(parsedUrl.searchParams.get('scope')).toContain(
      'pages_read_user_content'
    );
  });

  it('rejects authentication when pages_read_user_content was not granted', async () => {
    const provider = new FacebookProvider();
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        json: async () => ({
          access_token: 'short-token',
        }),
      } as Response)
      .mockResolvedValueOnce({
        json: async () => ({
          access_token: 'long-token',
        }),
      } as Response)
      .mockResolvedValueOnce({
        json: async () => ({
          data: [
            { permission: 'pages_show_list', status: 'granted' },
            { permission: 'business_management', status: 'granted' },
            { permission: 'pages_manage_posts', status: 'granted' },
            { permission: 'pages_manage_engagement', status: 'granted' },
            { permission: 'pages_read_engagement', status: 'granted' },
            { permission: 'read_insights', status: 'granted' },
          ],
        }),
      } as Response);

    global.fetch = fetchMock as typeof fetch;

    await expect(
      provider.authenticate({
        code: 'oauth-code',
        codeVerifier: 'ignored',
      })
    ).rejects.toThrow(
      'Missing required permissions: pages_read_user_content'
    );
  });

  it('stores the Facebook page content read marker on successful auth', async () => {
    const provider = new FacebookProvider();
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        json: async () => ({
          access_token: 'short-token',
        }),
      } as Response)
      .mockResolvedValueOnce({
        json: async () => ({
          access_token: 'long-token',
        }),
      } as Response)
      .mockResolvedValueOnce({
        json: async () => ({
          data: provider.scopes.map((permission) => ({
            permission,
            status: 'granted',
          })),
        }),
      } as Response)
      .mockResolvedValueOnce({
        json: async () => ({
          id: 'user-1',
          name: 'Publish Everywhere',
          picture: {
            data: {
              url: 'https://example.com/picture.jpg',
            },
          },
        }),
      } as Response);

    global.fetch = fetchMock as typeof fetch;

    await expect(
      provider.authenticate({
        code: 'oauth-code',
        codeVerifier: 'ignored',
      })
    ).resolves.toMatchObject({
      id: 'user-1',
      accessToken: 'long-token',
      additionalSettings: [
        expect.objectContaining({
          title: 'Facebook page content read enabled',
          value: true,
        }),
      ],
    });
  });

  it('stores the same marker when reconnecting an existing Facebook Page', async () => {
    const provider = new FacebookProvider();
    jest.spyOn(provider, 'fetchPageInformation').mockResolvedValue({
      id: 'page-1',
      name: 'Publish Everywhere',
      access_token: 'page-token',
      picture: 'https://example.com/page.jpg',
      username: 'publish-everywhere',
    });

    await expect(
      provider.reConnect('root-page', 'page-1', 'user-token')
    ).resolves.toMatchObject({
      id: 'page-1',
      accessToken: 'page-token',
      additionalSettings: [
        expect.objectContaining({
          title: 'Facebook page content read enabled',
          value: true,
        }),
      ],
    });
  });
});
