import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { getContext } from './async.storage';
import { oauthToolMeta, requireOAuthScope } from './oauth-publishing.tools';
import type { IntegrationService } from '../database/prisma/integrations/integration.service';
import type { PostsService } from '../database/prisma/posts/posts.service';
import type { AnalyticsReadResult } from '../integrations/analytics-read';
import type { AnalyticsData } from '../integrations/social/social.integrations.interface';

const id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/);
const period = z.union([z.literal(7), z.literal(30), z.literal(90)]).default(30);
const accountInput = z.object({ integrationId: id, period }).strict();
const postInput = z.object({ postId: id, period }).strict();
const listInput = accountInput.extend({ cursor: id.optional() });
export const analyticsInputSchemas = { get_analytics: accountInput, get_post_analytics: postInput, list_published_posts: listInput };
async function safeRead<T>(read: () => Promise<T>): Promise<T> {
  try { return await read(); } catch { throw new Error('Analytics resource unavailable in this organization'); }
}
const text = (value: unknown, limit = 120) => typeof value === 'string' ? value.slice(0, limit) : null;
const date = (value: unknown) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value ? value : null;
const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value :
  typeof value === 'string' && value.length <= 64 && /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(value) &&
    Number.isFinite(Number(value)) ? value : null;
export function analyticsPeriod(days: number) {
  const end = new Date();
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - days + 1);
  start.setUTCHours(0, 0, 0, 0);
  return { days, startDate: start.toISOString(), endDate: end.toISOString() };
}

// Allowlisted fields only. No derived totals, percentage changes, or rates:
// provider placeholders and unweighted averages are not trustworthy summaries.
export function projectAnalytics(result: AnalyticsReadResult, requestedPeriod: ReturnType<typeof analyticsPeriod>, post = false) {
  const platform = result.account.platform;
  const metrics = result.metrics.slice(0, 20).map((entry) => {
    const metric = (entry && typeof entry === 'object' ? entry : {}) as AnalyticsData;
    const average = metric.average === true || (platform === 'linkedin-page' && metric.label === 'Engagement');
    const declaredSeries = ['time_series', 'total_value', 'range_total_snapshot'].includes(metric.seriesType) ? metric.seriesType : null;
    const seriesType = declaredSeries || (post && platform !== 'linkedin-page' ? 'total_value' :
      ['facebook', 'youtube', 'pinterest', 'gmb', 'linkedin-page'].includes(platform) ? 'time_series' :
        ['tiktok', 'x'].includes(platform) ? 'total_value' : null);
    const points = Array.isArray(metric.data) ? metric.data : [];
    const data = points.slice(0, 100).map((point) => ({ date: date(point?.date), total: number(point?.total) }));
    const usable = data.some((point) => point.total !== null && point.date !== null);
    const incomplete = data.some((point) => point.total === null || point.date === null) || !Array.isArray(metric.data);
    const status = incomplete ? (usable ? 'partial' : 'unavailable') : usable ? 'available' : 'empty';
    const window = seriesType === 'range_total_snapshot' ? 'rolling_period_snapshots' :
      post ? (seriesType === 'time_series' ? 'provider_period' : 'provider_total') :
        platform === 'tiktok' ? (['Views', 'Recent Likes', 'Recent Comments', 'Recent Shares'].includes(metric.label) ? 'recent_20_posts' : 'latest') :
          platform === 'x' ? 'posts_published_in_requested_period' : seriesType ? 'provider_period' : 'provider_unspecified';
    return { label: text(metric.label), metricName: text(metric.metricName), seriesType,
      summaryType: average ? null : ['sum', 'latest'].includes(metric.summaryType) ? metric.summaryType :
        seriesType === 'time_series' ? 'sum' : ['total_value', 'range_total_snapshot'].includes(seriesType) ? 'latest' : null,
      average, window, status, data, truncated: points.length > 100 };
  });
  const status = result.status !== 'available' ? result.status :
    metrics.some((metric) => ['available', 'partial'].includes(metric.status)) ?
      (metrics.some((metric) => ['partial', 'unavailable'].includes(metric.status)) ? 'partial' : 'available') :
      metrics.some((metric) => metric.status === 'unavailable') ? 'unavailable' : 'empty';
  return { status, ...(result.reason ? { reason: result.reason } : {}),
    account: { id: text(result.account.id, 100), platform: text(platform, 60), displayName: text(result.account.displayName, 200) },
    ...(result.post ? { post: { id: text(result.post.id, 100), publishedAt: text(result.post.publishedAt, 40) } } : {}),
    requestedPeriod, metrics, truncated: result.metrics.length > 20 || metrics.some((metric) => metric.truncated) };
}

type Dependencies = {
  integrations: Pick<IntegrationService, 'checkAnalytics' | 'getIntegrationById'>;
  posts: Pick<PostsService, 'checkPostAnalytics' | 'listPublishedPostsForAnalytics'>;
};
export function createOAuthAnalyticsTools(deps: Dependencies) {
  const mcp = oauthToolMeta('analytics:read', true, true);
  return {
    get_analytics: createTool({
      id: 'get_analytics', inputSchema: accountInput, mcp,
      description: 'Read social analytics for one organization-owned account. Period is 7, 30 (default), or 90 days. Preserve each metric window and summary semantics: some providers return latest/lifetime counts or recent-post samples regardless of the requested period. Missing is not zero; never sum snapshots, averages, or truncated series or infer engagement rates.',
      execute: async ({ integrationId, period }) => {
        requireOAuthScope('analytics:read');
        const range = analyticsPeriod(period);
        const result = await safeRead(() => deps.integrations.checkAnalytics(getContext()!.auth, integrationId, String(period), { readOnly: true }));
        return projectAnalytics(result, range);
      },
    }),
    get_post_analytics: createTool({
      id: 'get_post_analytics', inputSchema: postInput, mcp,
      description: 'Read analytics for one owned, published EverywherePoster post ID, optionally discovered with list_published_posts. Most providers return current lifetime/provider totals regardless of period. Compare matching metrics and windows only; missing is not zero. Does not refresh credentials or change connections.',
      execute: async ({ postId, period }) => {
        const { organizationId } = requireOAuthScope('analytics:read');
        const range = analyticsPeriod(period);
        return projectAnalytics(await safeRead(() => deps.posts.checkPostAnalytics(organizationId, postId, period, { readOnly: true })), range, true);
      },
    }),
    list_published_posts: createTool({
      id: 'list_published_posts', inputSchema: listInput,
      mcp: oauthToolMeta('analytics:read', true),
      description: 'Discover up to 20 locally recorded published post IDs and publication dates for one owned account and period, newest first. Use nextCursor for another page. No provider requests or automatic analytics fan-out. Imported posts, drafts, deleted posts and posts without a usable remote ID are excluded. This is a candidate list, not a best/worst ranking.',
      execute: async ({ integrationId, period, cursor }) => {
        const { organizationId } = requireOAuthScope('analytics:read');
        const integration = await safeRead(() => deps.integrations.getIntegrationById(organizationId, integrationId));
        if (!integration || integration.type !== 'social' || integration.deletedAt) throw new Error('Account unavailable in this organization');
        const range = analyticsPeriod(period);
        const rows = await safeRead(() => deps.posts.listPublishedPostsForAnalytics(organizationId, integrationId,
          new Date(range.startDate), new Date(range.endDate), cursor));
        return { account: { id: integration.id, platform: text(integration.providerIdentifier, 60), displayName: text(integration.name, 200) },
          requestedPeriod: range, posts: rows.slice(0, 20).map((row) => ({ postId: row.id, publishedAt: row.publishDate.toISOString() })),
          nextCursor: rows.length > 20 ? rows[19].id : null };
      },
    }),
  };
}
