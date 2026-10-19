import { AsyncLocalStorage } from 'async_hooks';
import type { Integration } from '@prisma/client';
import type { AnalyticsData, SocialProvider } from './social/social.integrations.interface';

const readContext = new AsyncLocalStorage<boolean>();
export const isReadOnlyAnalytics = () => readContext.getStore() === true;
type Reason = 'provider_error' | 'incomplete_metrics' | 'query_limit' | 'disabled';
class AnalyticsReadError extends Error {
  constructor(readonly reason: Reason) { super('Analytics unavailable'); }
}
// Existing browser calls keep their behavior. MCP reads must not hide failures
// as empty success, log raw provider errors, or replace absent counts with zero.
export function failAnalyticsRead(cause: unknown = 'provider_error'): void {
  if (isReadOnlyAnalytics()) throw cause instanceof AnalyticsReadError ? cause : new AnalyticsReadError(
    ['incomplete_metrics', 'query_limit', 'disabled'].includes(cause as string) ? cause as Reason : 'provider_error');
}
export function analyticsValue<T>(value: T, fallback: T): T {
  if (isReadOnlyAnalytics()) {
    const numeric = typeof value === 'number' ? Number.isFinite(value) :
      typeof value === 'string' && /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(value) && Number.isFinite(Number(value));
    if (!numeric) failAnalyticsRead('incomplete_metrics');
    return (typeof fallback === 'number' ? Number(value) : value) as T;
  }
  return value || fallback;
}
export type AnalyticsReadResult = {
  status: 'available' | 'empty' | 'unsupported' | 'unavailable';
  reason?: string;
  metrics: AnalyticsData[];
  account: { id: string; displayName: string; platform: string };
  post?: { id: string; publishedAt: string };
};
export async function readAnalytics(
  integration: Integration, provider: SocialProvider, period: number, postId?: string
): Promise<AnalyticsReadResult> {
  const account = { id: integration.id, displayName: integration.name, platform: integration.providerIdentifier };
  const result = (status: AnalyticsReadResult['status'], reason?: string, metrics: AnalyticsData[] = []): AnalyticsReadResult =>
    ({ status, ...(reason ? { reason } : {}), account, metrics });
  if (integration.deletedAt || integration.disabled || integration.refreshNeeded || integration.inBetweenSteps ||
      (integration.tokenExpiration && new Date(integration.tokenExpiration).getTime() <= Date.now())) {
    return result('unavailable', 'reconnect_required');
  }
  if (integration.type !== 'social' || provider?.identifier === 'dribbble' ||
      (postId ? !provider?.postAnalytics || provider.identifier === 'gmb' : !provider?.analytics)) {
    return result('unsupported');
  }
  try {
    // No credential refresh, disconnect, Redis read/write, or snapshot writes.
    // Bypass legacy caches which may contain imputed zero values/hidden errors.
    const metrics = await readContext.run(true, () => postId
      ? provider.postAnalytics(integration.internalId, integration.token, postId, period)
      : provider.analytics(integration.internalId, integration.token, period));
    if (!Array.isArray(metrics)) return result('unavailable', 'provider_error');
    return result(metrics.length ? 'available' : 'empty', undefined, metrics);
  } catch (error) {
    return result('unavailable', error instanceof AnalyticsReadError ? error.reason : 'provider_error');
  }
}
