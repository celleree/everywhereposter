jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/integrations/integration.repository',
  () => ({ IntegrationRepository: class {} })
);
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service',
  () => ({ IntegrationService: class {} })
);
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/posts/posts.service',
  () => ({ PostsService: class {} })
);
jest.mock('@sentry/nestjs', () => ({
  suppressTracing: jest.fn((callback) => callback()),
}));
import { HttpException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ThrottlerGuard } from '@nestjs/throttler';
import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { suppressTracing } from '@sentry/nestjs';
import { BusinessDiscoveryService } from '@gitroom/nestjs-libraries/analytics/business-discovery.service';
import { AnalyticsController } from '@gitroom/backend/api/routes/analytics.controller';
const connection = () => ({
  id: 'integration',
  organizationId: 'org',
  internalId: '123',
  providerIdentifier: 'instagram',
  type: 'social',
  token: 'PAGE_SECRET',
  refreshToken: 'USER_SECRET',
  tokenExpiration: new Date(Date.now() + 86400000),
  disabled: false,
  inBetweenSteps: false,
  refreshNeeded: false,
  deletedAt: null,
});
const debug = () => ({
  is_valid: true,
  type: 'USER',
  app_id: '456',
  user_id: '789',
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  data_access_expires_at: Math.floor(Date.now() / 1000) + 3600,
  scopes: [
    'instagram_basic',
    'instagram_manage_insights',
    'pages_read_engagement',
    'pages_show_list',
  ],
  granular_scopes: [{ scope: 'pages_read_engagement', target_ids: ['999'] }],
});
const publicResult = (): any => ({
  id: '123',
  business_discovery: {
    id: '321',
    username: 'target',
    biography: '<script>untrusted text</script>',
    website: 'https://target.example/',
    followers_count: 0,
    media_count: 2,
    media: {
      data: [
        {
          id: '987',
          caption: 'Public caption',
          media_type: 'VIDEO',
          like_count: 0,
          comments_count: null,
          media_url: 'https://video.cdninstagram.com/v.mp4',
          permalink: 'https://www.instagram.com/p/public/',
        },
      ],
      paging: {
        cursors: { after: 'NEXT_123' },
        next: 'https://evil.example/?access_token=USER_SECRET',
      },
    },
  },
});
const response = (body: unknown, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => body,
});

describe('Business Discovery public boundary', () => {
  let repo: any, service: BusinessDiscoveryService, fetchMock: jest.Mock;
  const oldFetch = global.fetch,
    oldEnv = { ...process.env };
  beforeEach(() => {
    process.env.FACEBOOK_APP_ID = '456';
    process.env.FACEBOOK_APP_SECRET = 'APP_SECRET';
    process.env.JWT_SECRET = 'CURSOR_SECRET';
    repo = { getIntegrationById: jest.fn().mockResolvedValue(connection()) };
    service = new BusinessDiscoveryService(repo);
    fetchMock = jest.fn();
    global.fetch = fetchMock;
  });
  afterEach(() => {
    global.fetch = oldFetch;
    process.env = { ...oldEnv };
    jest.restoreAllMocks();
  });
  function queue(result = publicResult(), tokenDebug = debug()) {
    fetchMock
      .mockResolvedValueOnce(response({ data: tokenDebug }))
      .mockResolvedValueOnce(response({ id: '789' }))
      .mockResolvedValueOnce(
        response({
          data: [{ id: '999', instagram_business_account: { id: '123' } }],
        })
      )
      .mockResolvedValueOnce(
        response({
          data: {
            is_valid: true,
            app_id: '456',
            type: 'PAGE',
            profile_id: '999',
            expires_at: 0,
          },
        })
      )
      .mockResolvedValueOnce(
        response({ id: '999', instagram_business_account: { id: '123' } })
      )
      .mockResolvedValueOnce(response({ id: '123', username: 'acting' }))
      .mockResolvedValueOnce(response(result));
  }
  const search = (
    query: any = { username: 'target' },
    org = 'org',
    actor = 'user',
    session = 'session',
    integration = 'integration'
  ) => service.search(org, actor, session, integration, query);
  async function rejected(promise: Promise<any>, code: string) {
    await expect(promise).rejects.toMatchObject({
      response: expect.objectContaining({ code }),
    });
  }
  it('uses the organization-selected acting account and verified credentials, returns only public fields', async () => {
    queue();
    const result = await search({ username: ' @TaRgEt ' });
    expect(repo.getIntegrationById).toHaveBeenCalledWith('org', 'integration');
    expect(result).toMatchObject({
      acting: { id: '123', username: 'acting' },
      target: { followers: 0 },
      media: [{ likes: 0, comments: null, previewUrl: null }],
    });
    expect(JSON.stringify(result)).not.toMatch(
      /USER_SECRET|PAGE_SECRET|APP_SECRET|access_token|paging|private/
    );
    expect(fetchMock).toHaveBeenCalledTimes(7);
    expect(suppressTracing).toHaveBeenCalledTimes(7);
    for (const [index, [url, options]] of fetchMock.mock.calls.entries()) {
      expect(url.origin).toBe('https://graph.facebook.com');
      expect(url.pathname).toMatch(/^\/v25\.0\//);
      expect(options.headers.Authorization).toBe(
        index === 0 || index === 3
          ? 'Bearer 456|APP_SECRET'
          : index === 4
          ? 'Bearer PAGE_SECRET'
          : 'Bearer USER_SECRET'
      );
      expect(options.signal).toBeInstanceOf(AbortSignal);
      expect(url.href).not.toContain('/insights');
    }
    const url = fetchMock.mock.calls[6][0];
    expect(url.pathname).toBe('/v25.0/123');
    expect(url.searchParams.get('fields')).toContain(
      'business_discovery.username(target)'
    );
    expect(url.searchParams.get('fields')).not.toMatch(
      /profile_picture_url|reach|saved|demographics/
    );
    expect(url.searchParams.get('fields')).toContain('media.limit(12)');
  });
  it.each([
    'a){insights}',
    'https://example.com',
    'a..b',
    '.target',
    'a'.repeat(31),
    '',
    '@@target',
  ])('rejects invalid username %s before remote access', async (username) => {
    await rejected(search({ username }), 'INVALID_USERNAME');
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each([
    { username: 'target', fields: 'token' },
    { username: ['target'] },
    { username: 'target', cursor: ['bad'] },
    { username: 'target', cursor: 'x'.repeat(4097) },
  ])('rejects query injection %j', async (query) => {
    await expect(search(query)).rejects.toBeInstanceOf(HttpException);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each(['disabled', 'inBetweenSteps', 'refreshNeeded'])(
    'requires complete connection: %s',
    async (field) => {
      repo.getIntegrationById.mockResolvedValue({
        ...connection(),
        [field]: true,
      });
      await rejected(search(), 'RECONNECT_REQUIRED');
      expect(fetchMock).not.toHaveBeenCalled();
    }
  );
  it.each([
    null,
    { ...connection(), organizationId: 'other' },
    { ...connection(), deletedAt: new Date() },
  ])('rejects inaccessible/deleted tenant records', async (record) => {
    repo.getIntegrationById.mockResolvedValue(record);
    await rejected(search(), 'NOT_FOUND');
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each(['instagram-standalone', 'facebook', 'threads'])(
    'rejects provider %s',
    async (providerIdentifier) => {
      repo.getIntegrationById.mockResolvedValue({
        ...connection(),
        providerIdentifier,
      });
      await rejected(search(), 'UNSUPPORTED_PROVIDER');
    }
  );
  it.each([
    { refreshToken: null },
    { tokenExpiration: null },
    { tokenExpiration: new Date(0) },
    { internalId: '123/insights' },
  ])('requires local metadata %j', async (patch) => {
    repo.getIntegrationById.mockResolvedValue({ ...connection(), ...patch });
    await rejected(search(), 'RECONNECT_REQUIRED');
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each([
    { type: 'PAGE' },
    { app_id: 'wrong' },
    { is_valid: false },
    { expires_at: 0 },
    { data_access_expires_at: 0 },
    { user_id: null },
  ])('rejects unsuitable debug metadata %j', async (patch) => {
    queue(publicResult(), { ...debug(), ...patch } as any);
    await rejected(search(), 'RECONNECT_REQUIRED');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('rejects missing scope and Page-specific granular denial', async () => {
    queue(publicResult(), { ...debug(), scopes: ['instagram_basic'] });
    await rejected(search(), 'MISSING_PERMISSIONS');
    fetchMock.mockReset();
    queue(publicResult(), {
      ...debug(),
      granular_scopes: [
        { scope: 'pages_read_engagement', target_ids: ['different'] },
      ],
    });
    await rejected(search(), 'MISSING_PERMISSIONS');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it.each([1, 2, 4, 5])(
    'requires matching User, linked Page and acting identities (stage %i)',
    async (stage) => {
      // Replace one queued response while preserving normal route sequence.
      fetchMock.mockReset();
      const bodies = [
        { data: debug() },
        { id: '789' },
        { data: [{ id: '999', instagram_business_account: { id: '123' } }] },
        {
          data: {
            is_valid: true,
            app_id: '456',
            type: 'PAGE',
            profile_id: '999',
            expires_at: 0,
          },
        },
        { id: '999', instagram_business_account: { id: '123' } },
        { id: '123', username: 'acting' },
      ];
      bodies[stage] =
        stage === 2 ? ({ data: [] } as any) : ({ id: 'wrong' } as any);
      for (const body of bodies)
        fetchMock.mockResolvedValueOnce(response(body));
      await rejected(search(), 'RECONNECT_REQUIRED');
      expect(fetchMock).toHaveBeenCalledTimes(stage + 1);
    }
  );
  it('rejects owner search and incomplete provider data', async () => {
    queue();
    await rejected(search({ username: 'acting' }), 'INVALID_TARGET');
    fetchMock.mockReset();
    queue({ id: '123', business_discovery: { id: '321', username: 'target' } });
    await rejected(search(), 'UPSTREAM_ERROR');
  });
  it('accepts empty media, preserves unknown counts, and caps media at twelve', async () => {
    const empty = publicResult();
    empty.business_discovery.media.data = [];
    delete empty.business_discovery.followers_count;
    queue(empty);
    expect(await search()).toMatchObject({
      target: { followers: null },
      media: [],
      nextCursor: null,
    });
    fetchMock.mockReset();
    const big = publicResult();
    big.business_discovery.media.data = Array.from({ length: 40 }, (_, i) => ({
      ...big.business_discovery.media.data[0],
      id: String(i),
    }));
    queue(big);
    expect((await search()).media).toHaveLength(12);
  });
  it('filters dangerous links, secret-bearing URLs and unsupported previews', async () => {
    const data = publicResult(),
      item = data.business_discovery.media.data[0];
    data.business_discovery.website = 'javascript:alert(1)';
    item.permalink = 'https://example.com/?access_token=USER_SECRET';
    item.media_type = 'IMAGE';
    item.media_url = 'https://evil.example/image.jpg';
    queue(data);
    expect(await search()).toMatchObject({
      target: { website: null },
      media: [{ previewUrl: null, permalink: null }],
    });
  });
  it('binds signed cursors to organization/user/session/integration/credentials/target and never follows URLs', async () => {
    queue();
    const cursor = (await search()).nextCursor!;
    fetchMock.mockReset();
    queue();
    await search({ username: 'target', cursor });
    expect(fetchMock.mock.calls[6][0].searchParams.get('fields')).toContain(
      '.after(NEXT_123)'
    );
    for (const [actor, session, integration, username] of [
      ['other', 'session', 'integration', 'target'],
      ['user', 'other', 'integration', 'target'],
      ['user', 'session', 'other', 'target'],
      ['user', 'session', 'integration', 'other'],
    ]) {
      fetchMock.mockReset();
      await rejected(
        search({ username, cursor }, 'org', actor, session, integration),
        'INVALID_CURSOR'
      );
      expect(fetchMock).not.toHaveBeenCalled();
    }
    for (const patch of [
      { refreshToken: 'NEW_USER' },
      { token: 'NEW_PAGE' },
      { organizationId: 'other' },
    ]) {
      repo.getIntegrationById.mockResolvedValue({ ...connection(), ...patch });
      await rejected(
        search({ username: 'target', cursor }, patch.organizationId || 'org'),
        'INVALID_CURSOR'
      );
    }
    repo.getIntegrationById.mockResolvedValue(connection());
    await rejected(
      search({ username: 'target', cursor: `${cursor}x` }),
      'INVALID_CURSOR'
    );
  });
  it.each([
    [429, 4, 'RATE_LIMITED'],
    [400, 190, 'RECONNECT_REQUIRED'],
    [403, 200, 'MISSING_PERMISSIONS'],
    [400, 100, 'RECONNECT_REQUIRED'],
    [500, 2, 'UPSTREAM_ERROR'],
  ])(
    'sanitizes early error %s/%s without retries',
    async (status, code, expected) => {
      fetchMock.mockResolvedValue(
        response(
          { error: { code, message: 'USER_SECRET APP_SECRET PAGE_SECRET' } },
          status as number
        )
      );
      try {
        await search();
        throw new Error('unexpected success');
      } catch (error) {
        expect((error as HttpException).getResponse()).toMatchObject({
          code: expected,
        });
        expect(
          JSON.stringify((error as HttpException).getResponse())
        ).not.toMatch(/SECRET/);
      }
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  );
  it('labels code 100 target-unavailable only at discovery stage', async () => {
    queue({ error: { code: 100 } });
    await rejected(search(), 'TARGET_UNAVAILABLE');
  });
  it('sanitizes network errors without logging/retrying', async () => {
    const log = jest.spyOn(console, 'error');
    fetchMock.mockRejectedValue(new Error('USER_SECRET request failed'));
    await rejected(search(), 'UPSTREAM_ERROR');
    expect(log).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('takes controller context from auth and throttles the dedicated route', async () => {
    const discovery = { search: jest.fn().mockResolvedValue({}) },
      controller = new AnalyticsController(
        {} as any,
        {} as any,
        discovery as any
      );
    await controller.businessDiscovery(
      { id: 'org' } as any,
      { id: 'user' } as any,
      'integration',
      { username: 'target' },
      { cookies: { auth: 'session' }, headers: {} } as any
    );
    expect(discovery.search).toHaveBeenCalledWith(
      'org',
      'user',
      'session',
      'integration',
      { username: 'target' }
    );
    expect(
      Reflect.getMetadata(PATH_METADATA, controller.businessDiscovery)
    ).toBe('/:integration/business-discovery');
    expect(
      Reflect.getMetadata(GUARDS_METADATA, controller.businessDiscovery)
    ).toContain(ThrottlerGuard);
  });
  it('rejects expired cursors and missing authenticated sessions before Meta', async () => {
    queue();
    const cursor = (await search()).nextCursor!;
    fetchMock.mockReset();
    jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 16 * 60000);
    await rejected(search({ username: 'target', cursor }), 'INVALID_CURSOR');
    await rejected(
      search({ username: 'target' }, 'org', 'user', ''),
      'UNAUTHORIZED'
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('enforces the route limit through the actual shared-storage throttler guard', async () => {
    let hits = 0;
    const storage = {
      increment: jest.fn(async () => ({
        totalHits: ++hits,
        timeToExpire: 60,
        isBlocked: hits > 10,
        timeToBlockExpire: 60,
      })),
    };
    const guard = new ThrottlerGuard(
      [{ ttl: 60000, limit: 30 }],
      storage as any,
      new Reflector()
    );
    await guard.onModuleInit();
    const context = {
      getHandler: () => AnalyticsController.prototype.businessDiscovery,
      getClass: () => AnalyticsController,
      switchToHttp: () => ({
        getRequest: () => ({ ip: '127.0.0.1', headers: {} }),
        getResponse: () => ({ header: jest.fn() }),
      }),
    } as any;
    for (let i = 0; i < 10; i++)
      await expect(guard.canActivate(context)).resolves.toBe(true);
    await expect(guard.canActivate(context)).rejects.toMatchObject({
      status: 429,
    });
    expect(storage.increment.mock.calls[0][2]).toBe(10);
  });
  it.each([
    { app_id: 'wrong' },
    { type: 'USER' },
    { profile_id: 'wrong' },
    { is_valid: false },
    { expires_at: 1 },
  ])('rejects unsuitable Page credential metadata %j', async (patch) => {
    fetchMock
      .mockResolvedValueOnce(response({ data: debug() }))
      .mockResolvedValueOnce(response({ id: '789' }))
      .mockResolvedValueOnce(
        response({
          data: [{ id: '999', instagram_business_account: { id: '123' } }],
        })
      )
      .mockResolvedValueOnce(
        response({
          data: {
            is_valid: true,
            app_id: '456',
            type: 'PAGE',
            profile_id: '999',
            expires_at: 0,
            ...patch,
          },
        })
      );
    await rejected(search(), 'RECONNECT_REQUIRED');
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});
