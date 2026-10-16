import { IGUser, InstagramInsightsResult } from 'facebook-nodejs-business-sdk';

export const CORE_METRICS = ['views', 'reach', 'shares', 'saved', 'likes', 'comments'] as const;
export const EXTRA_METRICS = ['ig_reels_avg_watch_time', 'ig_reels_video_view_total_time', 'reels_skip_rate',
  'reposts', 'total_interactions', 'follows', 'profile_visits', 'profile_activity', 'facebook_views', 'crossposted_views'] as const;
export const METRICS = [...CORE_METRICS, ...EXTRA_METRICS];
export type MetricName = typeof METRICS[number];
export type MetricUnit = 'count' | 'milliseconds' | 'seconds' | 'percent' | 'ratio';
export const FOLLOWER_FIELD = IGUser.Fields.followers_count;

// Reuse the installed official SDK without changing its global API version,
// default credentials, crash reporting, or transport. Newer names are an
// explicit v25 candidate allowlist, not evidence that the account supports them.
export function metricName(name: MetricName): string {
  return (InstagramInsightsResult.Metric as Record<string, string>)[name] || name;
}

export function metricUnit(name: string, row: any): MetricUnit | null {
  const unit = typeof row?.unit === 'string' ? row.unit.toLowerCase() : null;
  const description = typeof row?.description === 'string' ? row.description : '';
  if (name === 'reels_skip_rate') {
    if (unit) return unit === 'percent' || unit === 'percentage' ? 'percent' : unit === 'ratio' ? 'ratio' : null;
    return /\bpercent(?:age)?\b|%/.test(description.toLowerCase()) ? 'percent' : null;
  }
  if (name === 'ig_reels_avg_watch_time' || name === 'ig_reels_video_view_total_time') {
    if (unit) return unit === 'milliseconds' || unit === 'ms' ? 'milliseconds' : unit === 'seconds' || unit === 's' ? 'seconds' : null;
    if (/\bmilliseconds?\b/i.test(description)) return 'milliseconds';
    if (/\bseconds?\b/i.test(description)) return 'seconds';
    return null;
  }
  return !unit || unit === 'count' ? 'count' : null;
}
