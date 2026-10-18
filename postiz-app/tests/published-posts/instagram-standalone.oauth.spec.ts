jest.mock('sharp', () => ({ __esModule: true, default: jest.fn() }));

import { InstagramStandaloneProvider } from '@gitroom/nestjs-libraries/integrations/social/instagram.standalone.provider';

describe('Instagram standalone OAuth authorization', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it.each([
    [
      'https://app.example.test',
      'https://app.example.test/integrations/social/instagram-standalone',
    ],
    [
      'http://localhost:4200',
      'https://redirectmeto.com/http://localhost:4200/integrations/social/instagram-standalone',
    ],
  ])(
    'requests reauthentication and preserves OAuth settings for %s',
    async (frontendUrl, redirectUri) => {
      jest.replaceProperty(process, 'env', {
        ...process.env,
        FRONTEND_URL: frontendUrl,
        INSTAGRAM_APP_ID: '123456789',
      });
      const fetchMock = jest.spyOn(global, 'fetch').mockImplementation(() => {
        throw new Error('Unexpected external OAuth request');
      });

      const result = await new InstagramStandaloneProvider().generateAuthUrl();
      const url = new URL(result.url);

      expect(url.origin).toBe('https://www.instagram.com');
      expect(url.pathname).toBe('/oauth/authorize');
      expect(url.searchParams.getAll('force_reauth')).toEqual(['true']);
      expect(Object.fromEntries(url.searchParams)).toEqual({
        enable_fb_login: '0',
        force_reauth: 'true',
        client_id: '123456789',
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: [
          'instagram_business_basic',
          'instagram_business_content_publish',
          'instagram_business_manage_comments',
          'instagram_business_manage_insights',
        ].join(','),
        state: result.state,
      });
      expect(result.state).toEqual(expect.any(String));
      expect(result.state.length).toBeGreaterThan(0);
      expect(result.codeVerifier).toEqual(expect.any(String));
      expect(result.codeVerifier.length).toBeGreaterThan(0);
      expect(fetchMock).not.toHaveBeenCalled();
    }
  );
});
