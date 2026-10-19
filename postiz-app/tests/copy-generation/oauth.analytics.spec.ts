jest.mock('bcrypt', () => ({ hashSync: jest.fn(), compareSync: jest.fn() }));
jest.mock('@mastra/core/tools', () => ({ createTool: (definition: unknown) => definition }));
jest.mock('@gitroom/nestjs-libraries/upload/upload.factory', () => ({ UploadFactory: { createStorage: jest.fn() } }));
jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({ ioRedis: { get: jest.fn(), set: jest.fn() } }));
jest.mock('twitter-api-v2', () => ({ TwitterApi: jest.fn() }));
import { createOAuthAnalyticsTools, projectAnalytics, analyticsPeriod } from '../../libraries/nestjs-libraries/src/chat/oauth-analytics.tools';
import { createOAuthPublishingTools } from '../../libraries/nestjs-libraries/src/chat/oauth-publishing.tools';
import { runWithContext } from '../../libraries/nestjs-libraries/src/chat/async.storage';
import { IntegrationService } from '../../libraries/nestjs-libraries/src/database/prisma/integrations/integration.service';
import { PostsService } from '../../libraries/nestjs-libraries/src/database/prisma/posts/posts.service';
import { PostsRepository } from '../../libraries/nestjs-libraries/src/database/prisma/posts/posts.repository';
import { readAnalytics, failAnalyticsRead, analyticsValue } from '../../libraries/nestjs-libraries/src/integrations/analytics-read';
import { ioRedis } from '../../libraries/nestjs-libraries/src/redis/redis.service';
import { RefreshToken } from '../../libraries/nestjs-libraries/src/integrations/social.abstract';
import { FacebookProvider } from '../../libraries/nestjs-libraries/src/integrations/social/facebook.provider';
import { InstagramProvider } from '../../libraries/nestjs-libraries/src/integrations/social/instagram.provider';
import { ThreadsProvider } from '../../libraries/nestjs-libraries/src/integrations/social/threads.provider';
import { TiktokProvider } from '../../libraries/nestjs-libraries/src/integrations/social/tiktok.provider';
import { GmbProvider } from '../../libraries/nestjs-libraries/src/integrations/social/gmb.provider';
import { PinterestProvider } from '../../libraries/nestjs-libraries/src/integrations/social/pinterest.provider';
import { XProvider } from '../../libraries/nestjs-libraries/src/integrations/social/x.provider';
import { YoutubeProvider } from '../../libraries/nestjs-libraries/src/integrations/social/youtube.provider';
import { TwitterApi } from 'twitter-api-v2';
import { google } from 'googleapis';

const integration: any = { id: 'account', organizationId: 'org', name: 'Account', providerIdentifier: 'instagram',
  type: 'social', internalId: 'remote', token: 'provider-secret', refreshToken: 'refresh-secret' };
const metric = { label: 'Views', seriesType: 'total_value' as const, summaryType: 'latest' as const,
  data: [{ total: 0, date: '2026-10-19' }] };

describe('read-only OAuth social analytics', () => {
  let provider: any, integrations: any, posts: any, tools: any, repository: any;
  const call = (name: string, args: any, scopes = ['analytics:read']) =>
    runWithContext({ requestId: 'pos_test', auth: { id: 'org' }, oauth: { id: 'grant', scopes } },
      () => tools[name].execute(tools[name].inputSchema.parse(args)));
  beforeEach(() => {
    provider = { identifier: 'instagram', analytics: jest.fn().mockResolvedValue([metric]), postAnalytics: jest.fn().mockResolvedValue([metric]) };
    integrations = Object.assign(Object.create(IntegrationService.prototype), {
      _integrationRepository: { getIntegrationById: jest.fn(async (org, id) => org === 'org' && id === 'account' ? integration : null) },
      _integrationManager: { getSocialIntegration: jest.fn(() => provider) },
      _refreshIntegrationService: { refresh: jest.fn() }, disconnectChannel: jest.fn(),
    });
    repository = {
      getAnalyticsPost: jest.fn(async (org, id) => org === 'org' && id === 'post' ?
        { id, integration, releaseId: 'remote-post', publishDate: new Date('2026-10-18T10:00:00Z') } : null),
      listPublishedPostsForAnalytics: jest.fn().mockResolvedValue([]),
    };
    posts = Object.assign(Object.create(PostsService.prototype), { _postRepository: repository,
      _integrationManager: { getSocialIntegration: jest.fn(() => provider) }, _integrationService: integrations,
      _refreshIntegrationService: { refresh: jest.fn() } });
    tools = createOAuthAnalyticsTools({ integrations, posts });
  });
  it('uses the authorized organization and existing service, preserves genuine zero and latest totals', async () => {
    const result: any = await call('get_analytics', { integrationId: 'account' });
    expect(integrations._integrationRepository.getIntegrationById).toHaveBeenCalledWith('org', 'account');
    expect(provider.analytics).toHaveBeenCalledWith('remote', 'provider-secret', 30);
    expect(result).toMatchObject({ status: 'available', requestedPeriod: { days: 30 }, account: { id: 'account' },
      metrics: [{ seriesType: 'total_value', summaryType: 'latest', data: [{ total: 0 }] }] });
    expect(JSON.stringify(result)).not.toMatch(/secret|organizationId|internalId|token/);
    expect(ioRedis.get).not.toHaveBeenCalled(); expect(ioRedis.set).not.toHaveBeenCalled();
    expect(integrations._refreshIntegrationService.refresh).not.toHaveBeenCalled();
    expect(integrations.disconnectChannel).not.toHaveBeenCalled();
  });
  it('enforces post ownership before provider calls and reports safe post identity', async () => {
    await expect(call('get_post_analytics', { postId: 'foreign' })).rejects.toThrow('organization');
    expect(provider.postAnalytics).not.toHaveBeenCalled();
    const result: any = await call('get_post_analytics', { postId: 'post', period: 7 });
    expect(repository.getAnalyticsPost).toHaveBeenCalledWith('org', 'post');
    expect(provider.postAnalytics).toHaveBeenCalledWith('remote', 'provider-secret', 'remote-post', 7);
    expect(result).toMatchObject({ post: { id: 'post' }, metrics: [{ window: 'provider_total' }] });
    expect(ioRedis.set).not.toHaveBeenCalled(); expect(posts._refreshIntegrationService.refresh).not.toHaveBeenCalled();
  });
  it.each(['get_analytics', 'list_published_posts'])('rejects cross-organization IDs in %s', async (name) => {
    await expect(call(name, { integrationId: 'foreign' })).rejects.toThrow('organization');
    expect(provider.analytics).not.toHaveBeenCalled(); expect(repository.listPublishedPostsForAnalytics).not.toHaveBeenCalled();
  });
  it('does not expose non-social integration identity through analytics', async () => {
    integrations._integrationRepository.getIntegrationById.mockResolvedValue({ ...integration, type: 'article', name: 'unrelated' });
    for (const name of ['get_analytics', 'list_published_posts']) await expect(call(name, { integrationId: 'account' })).rejects.toThrow('organization');
    expect(provider.analytics).not.toHaveBeenCalled(); expect(repository.listPublishedPostsForAnalytics).not.toHaveBeenCalled();
  });
  it.each([0, 6, 31, 91, '30', null, 7.5])('rejects invalid period %p before reads', (period) => {
    for (const name of Object.keys(tools)) expect(() => call(name, { ...(name === 'get_post_analytics' ? { postId: 'post' } : { integrationId: 'account' }), period })).toThrow();
    expect(provider.analytics).not.toHaveBeenCalled();
  });
  it.each([['accounts:read'], ['posts:write'], ['accounts:read', 'posts:write'], []])('denies analytics to existing grant %p', async (...scopes) => {
    for (const [name, args] of [['get_analytics', { integrationId: 'account' }], ['get_post_analytics', { postId: 'post' }], ['list_published_posts', { integrationId: 'account' }]] as const) {
      await expect(call(name, args, scopes as string[])).rejects.toThrow('scope');
    }
    expect(provider.analytics).not.toHaveBeenCalled();
  });
  it('analytics-only grants cannot list accounts or use publishing tools, even by direct invocation', async () => {
    const publishing: any = createOAuthPublishingTools({ integrations, posts, media: {}, redis: {}, permissions: {} } as any);
    const other = { ...publishing.readTools, ...publishing.writeTools };
    for (const name of Object.keys(other)) await expect(runWithContext({ auth: { id: 'org' }, oauth: { id: 'grant', scopes: ['analytics:read'] } },
      () => other[name].execute({}))).rejects.toThrow('scope');
  });
  it('rejects tenant selectors and invalid IDs', () => {
    for (const args of [{ integrationId: '' }, { integrationId: '../account' }, { integrationId: 'account', organizationId: 'foreign' }]) {
      expect(() => call('get_analytics', args)).toThrow();
    }
  });
  it.each([{ tokenExpiration: new Date(0) }, { refreshNeeded: true }, { disabled: true }, { inBetweenSteps: true }])('never refreshes or disconnects unavailable accounts %p', async (change) => {
    integrations._integrationRepository.getIntegrationById.mockResolvedValue({ ...integration, ...change });
    expect(await call('get_analytics', { integrationId: 'account' })).toMatchObject({ status: 'unavailable', reason: 'reconnect_required', metrics: [] });
    expect(provider.analytics).not.toHaveBeenCalled(); expect(integrations.disconnectChannel).not.toHaveBeenCalled();
    expect(integrations._refreshIntegrationService.refresh).not.toHaveBeenCalled();
  });
  it('keeps unsupported, failed, empty and true zero distinguishable, without retry or leaked errors', async () => {
    delete provider.analytics;
    expect(await call('get_analytics', { integrationId: 'account' })).toMatchObject({ status: 'unsupported' });
    provider.analytics = jest.fn().mockRejectedValue(new RefreshToken('', 'provider-secret', 'refresh-secret'));
    expect(await call('get_analytics', { integrationId: 'account' })).toMatchObject({ status: 'unavailable', reason: 'provider_error', metrics: [] });
    expect(provider.analytics).toHaveBeenCalledTimes(1);
    expect(integrations._refreshIntegrationService.refresh).not.toHaveBeenCalled();
    provider.analytics.mockResolvedValue([]);
    expect(await call('get_analytics', { integrationId: 'account' })).toMatchObject({ status: 'empty', metrics: [] });
    provider.analytics.mockResolvedValue([metric]);
    expect(await call('get_analytics', { integrationId: 'account' })).toMatchObject({ status: 'available', metrics: [{ data: [{ total: 0 }] }] });
    integrations._integrationRepository.getIntegrationById.mockRejectedValue(new Error('postgres://secret'));
    await expect(call('get_analytics', { integrationId: 'account' })).rejects.toThrow('Analytics resource unavailable in this organization');
  });
  it('lists at most 20 local post IDs, with a cursor and no analytics calls or content/secret leakage', async () => {
    repository.listPublishedPostsForAnalytics.mockResolvedValue(Array.from({ length: 21 }, (_, n) => ({ id: `post${n}`, publishDate: new Date(), token: 'secret', content: 'unrelated' })));
    const result: any = await call('list_published_posts', { integrationId: 'account', period: 90, cursor: 'previous' });
    expect(result.posts).toHaveLength(20); expect(result.nextCursor).toBe('post19');
    expect(repository.listPublishedPostsForAnalytics).toHaveBeenCalledWith('org', 'account', expect.any(Date), expect.any(Date), 'previous');
    expect(JSON.stringify(result)).not.toMatch(/secret|content|unrelated/);
    expect(provider.analytics).not.toHaveBeenCalled(); expect(provider.postAnalytics).not.toHaveBeenCalled();
    expect(tools.list_published_posts.mcp.annotations).toMatchObject({ readOnlyHint: true, openWorldHint: false });
  });
  it('preserves time series, rolling snapshots and averages without deriving totals or rates, and bounds output', async () => {
    provider.analytics.mockResolvedValue([
      { ...metric, seriesType: 'range_total_snapshot', summaryType: 'latest', data: [{ total: 7, date: '2026-10-18' }, { total: 9, date: '2026-10-19' }] },
      { label: 'Average View Duration', average: true, data: [{ total: '2.5', date: '2026-10-19' }], token: 'secret' },
      { label: 'Missing', data: [{ total: null, date: '2026-10-19' }] },
    ]);
    const result: any = await call('get_analytics', { integrationId: 'account' });
    expect(result).toMatchObject({ status: 'partial', metrics: [{ summaryType: 'latest', window: 'rolling_period_snapshots' }, { average: true, summaryType: null }, { status: 'unavailable', data: [{ total: null }] }] });
    expect(result.metrics[0].data.map((p) => p.total)).toEqual([7, 9]);
    expect(JSON.stringify(result)).not.toMatch(/percentageChange|engagementRate|secret/);
    provider.analytics.mockResolvedValue(Array.from({ length: 21 }, () => ({ label: 'v'.repeat(1000), data: Array.from({ length: 101 }, () => ({ total: 'not-a-number', date: 'not-a-date' })) })));
    const bounded: any = await call('get_analytics', { integrationId: 'account' });
    expect(bounded.metrics).toHaveLength(20); expect(bounded.metrics[0].data).toHaveLength(100);
    expect(bounded.metrics[0].label).toHaveLength(120); expect(bounded.truncated).toBe(true);
    expect(bounded.metrics[0].data[0]).toEqual({ total: null, date: null });
  });
  it('keeps strict provider failures isolated from ordinary concurrent analytics calls', async () => {
    const strict = readAnalytics(integration, { ...provider, analytics: async () => { await Promise.resolve(); failAnalyticsRead(); return []; } }, 30);
    expect(analyticsValue(undefined, 0)).toBe(0); expect(() => failAnalyticsRead()).not.toThrow();
    expect(await strict).toMatchObject({ status: 'unavailable' });
  });
});

describe('analytics database boundary', () => {
  it('filters ownership, published/deleted state and remote IDs at the database, with a hard page limit', async () => {
    const model = { findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) };
    const repository = new PostsRepository({ model: { post: model } } as any, null, null, null, null, null);
    await repository.getAnalyticsPost('org', 'post');
    expect(model.findFirst.mock.calls[0][0].where).toMatchObject({ organizationId: 'org', id: 'post', deletedAt: null, state: 'PUBLISHED', releaseId: { notIn: ['', 'missing'] }, integration: { organizationId: 'org', deletedAt: null, type: 'social' } });
    await repository.listPublishedPostsForAnalytics('org', 'account', new Date(0), new Date());
    expect(model.findMany.mock.calls[0][0]).toMatchObject({ where: { organizationId: 'org', integrationId: 'account', parentPostId: null, state: 'PUBLISHED', deletedAt: null }, take: 21 });
    await expect(repository.listPublishedPostsForAnalytics('org', 'account', new Date(0), new Date(), 'foreign')).rejects.toThrow('cursor');
    expect(model.findMany).toHaveBeenCalledTimes(1);
  });
});

describe('real provider error and missing-value behavior', () => {
  afterEach(() => jest.restoreAllMocks());
  it('does not classify TikTok publication-status error envelopes as successful empty analytics', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({ status: 200, json: async () => ({ error: { code: 'access_token_invalid', message: 'provider-secret' } }) } as any);
    expect(await readAnalytics({ ...integration, providerIdentifier: 'tiktok' }, new TiktokProvider(), 30, 'v_pub_url-receipt'))
      .toMatchObject({ status: 'unavailable', reason: 'provider_error', metrics: [] });
  });
  it.each([{}, { like: null }])('does not manufacture Facebook reaction totals from missing breakdown counts: %p', async (value) => {
    jest.spyOn(global, 'fetch').mockResolvedValue({ status: 200, json: async () => ({ data: [{ name: 'post_reactions_by_type_total', values: [{ value }] }] }) } as any);
    const provider = new FacebookProvider();
    expect(await readAnalytics({ ...integration, providerIdentifier: 'facebook' }, provider, 30, 'remote-post'))
      .toMatchObject({ status: 'unavailable', reason: 'incomplete_metrics', metrics: [] });
  });
  it('bounds X timeline calls without returning incomplete sums or interpreting a successful empty timeline as a failure', async () => {
    const timeline = jest.fn().mockResolvedValue({ data: { data: Array.from({ length: 100 }, (_, i) => ({ id: `${i}` })) }, meta: { next_token: 'more' } });
    const tweets = jest.fn();
    (TwitterApi as jest.Mock).mockImplementation(() => ({ v2: { userTimeline: timeline, tweets } }));
    const provider = new XProvider();
    expect(await readAnalytics({ ...integration, providerIdentifier: 'x' }, provider, 90)).toMatchObject({ status: 'unavailable', reason: 'query_limit' });
    expect(timeline).toHaveBeenCalledTimes(1); expect(tweets).not.toHaveBeenCalled();
    timeline.mockResolvedValue({ data: {}, meta: { result_count: 0 } });
    expect(await readAnalytics({ ...integration, providerIdentifier: 'x' }, provider, 30)).toMatchObject({ status: 'empty' });
  });
  it('preserves YouTube daily average values without computing a range average, and distinguishes empty/error reports', async () => {
    const query = jest.fn().mockResolvedValue({ data: { columnHeaders: [{ name: 'day' }, { name: 'averageViewDuration' }], rows: [['2026-10-19', 2.5]] } });
    jest.spyOn(google, 'youtubeAnalytics').mockReturnValue({ reports: { query } } as any);
    const provider = new YoutubeProvider();
    const account = { ...integration, providerIdentifier: 'youtube' };
    const result = await readAnalytics(account, provider, 7);
    const projected = projectAnalytics(result, analyticsPeriod(7));
    expect(projected.metrics.find((metric) => metric.label === 'Average View Duration')).toMatchObject({ average: true, summaryType: null, seriesType: 'time_series', data: [{ total: 2.5 }] });
    query.mockResolvedValue({ data: { rows: [] } });
    expect(await readAnalytics(account, provider, 7)).toMatchObject({ status: 'empty' });
    query.mockRejectedValue(new Error('provider-secret'));
    expect(await readAnalytics(account, provider, 7)).toMatchObject({ status: 'unavailable', reason: 'provider_error' });
  });
  it.each([new FacebookProvider(), new InstagramProvider(), new ThreadsProvider(), new TiktokProvider(), new GmbProvider(), new PinterestProvider()])('distinguishes provider failures from empty metrics for $identifier', async (provider) => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('https://provider.test?token=secret'));
    const result = await readAnalytics({ ...integration, providerIdentifier: provider.identifier }, provider, 30);
    expect(result).toMatchObject({ status: 'unavailable', reason: 'provider_error', metrics: [] });
    expect(JSON.stringify(result)).not.toContain('secret');
  });
  it('does not turn absent TikTok counts into zero, and describes bounded recent-post samples honestly', async () => {
    const responses = [{ data: { user: { follower_count: 0 } } }, { data: { videos: [{ id: 'video' }] } }, { data: { videos: [{ view_count: 5 }] } }];
    jest.spyOn(global, 'fetch').mockImplementation(async () => ({ status: 200, json: async () => responses.shift() }) as any);
    const provider = new TiktokProvider();
    const result = await readAnalytics({ ...integration, providerIdentifier: 'tiktok' }, provider, 30);
    expect(result).toMatchObject({ status: 'unavailable', reason: 'incomplete_metrics', metrics: [] });
    const projected = projectAnalytics({ status: 'available', account: { id: 'account', displayName: 'a', platform: 'tiktok' }, metrics: [metric] }, analyticsPeriod(30));
    expect(projected.metrics[0].window).toBe('recent_20_posts');
  });
  it('distinguishes successful empty Instagram metrics from error envelopes and preserves range-total metadata', async () => {
    const fetch = jest.spyOn(global, 'fetch').mockResolvedValue({ json: async () => ({ data: [] }) } as any);
    const provider = new InstagramProvider();
    expect(await readAnalytics(integration, provider, 30)).toMatchObject({ status: 'empty' });
    fetch.mockResolvedValue({ json: async () => ({ error: { message: 'provider-secret' } }) } as any);
    expect(await readAnalytics(integration, provider, 30)).toMatchObject({ status: 'unavailable' });
    fetch.mockResolvedValueOnce({ json: async () => ({ data: [{ name: 'reach', values: [{ value: 0, end_time: '2026-10-19' }] }] }) } as any)
      .mockResolvedValueOnce({ json: async () => ({ data: [{ name: 'likes', total_value: { value: 10 } }] }) } as any);
    const result = await readAnalytics(integration, provider, 30);
    expect(result).toMatchObject({ status: 'available', metrics: [{ seriesType: 'time_series', summaryType: 'sum' }, { seriesType: 'total_value', summaryType: 'latest' }] });
  });
});
