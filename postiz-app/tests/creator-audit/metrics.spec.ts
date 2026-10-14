import { collectInstagramAudit } from '../../apps/backend/src/api/routes/creator-audit.collector';
import { runInstagramCapabilityProbe } from '../../apps/backend/src/api/routes/creator-audit.probe';
import { FacebookAdsApi } from 'facebook-nodejs-business-sdk';

const connection = { id: 'fixture', organizationId: 'org', internalId: '123', providerIdentifier: 'instagram', token: 'FIXTURE_SECRET' };
const now = () => new Date('2026-10-14T12:00:00Z');
const row = { id: '456', owner: { id: '123' }, media_product_type: 'REELS', timestamp: '2026-10-01T12:00:00Z',
  permalink: 'https://www.instagram.com/reel/FIXTURE456/' };
function transport(response: (name: string) => any = () => ({ data: [] }), followers: unknown = 0) {
  return jest.fn(async (url: string) => {
    const u = new URL(url), name = u.searchParams.get('metric');
    const body = name ? response(name) : u.pathname.endsWith('/media') ? { data: [row] } :
      u.pathname.endsWith('/456') ? row : { id: '123', username: 'fixture', followers_count: followers };
    return Response.json(body);
  });
}
const measurement = (name: string, value: number, extra: object = {}) => ({ data: [{ name, period: 'lifetime',
  values: [{ value }], ...extra }] });

it('keeps empty optional insights unknown and preserves a real zero follower count', async () => {
  const fetcher = transport(name => name === 'views' ? measurement(name, 5) : { data: [] });
  const result = await collectInstagramAudit(connection, 'run', { fetcher, now });
  expect(result.snapshot.records[0].metrics.ig_reels_avg_watch_time).toMatchObject({ status: 'not_returned', value: null, unit: null });
  expect(result.snapshot.account_metrics.followers_count).toMatchObject({ status: 'available', value: 0, source: 'instagram_account_metadata', period: 'snapshot' });
  expect(JSON.stringify(result.snapshot)).not.toContain(connection.token);
  const calls = fetcher.mock.calls.map(([url]) => new URL(url).searchParams.get('metric')).filter(Boolean);
  expect(calls.slice(0, 6)).toEqual(['views', 'reach', 'shares', 'saved', 'likes', 'comments']);
  expect(calls).toContain('facebook_views'); expect(calls).toContain('profile_activity');
});

it('rejects a contradictory follower account without losing verified Reel measurements', async () => {
  const base = transport(name => measurement(name, 5));
  const fetcher = jest.fn(async (url: string) => new URL(url).searchParams.get('fields') === 'id,followers_count' ?
    Response.json({ id: '999', followers_count: 900 }) : base(url));
  const result = await collectInstagramAudit(connection, 'run', { fetcher, now });
  expect(result.snapshot.account_metrics.followers_count).toMatchObject({ status: 'error', value: null });
  expect(result.snapshot.records[0].metrics.views).toMatchObject({ status: 'available', value: 5 });
});

it('retains provider definitions and resolves watch/skip units without SDK network or global initialization', async () => {
  const init = jest.spyOn(FacebookAdsApi, 'init');
  const fetcher = transport(name => measurement(name, name === 'reels_skip_rate' ? .25 : 2500,
    name.includes('watch_time') || name.includes('view_total_time') ? { description: 'Watch time in milliseconds.' } :
      name === 'reels_skip_rate' ? { unit: 'ratio', description: 'The ratio of skipped Reels.' } : {}));
  const result = await collectInstagramAudit(connection, 'run', { fetcher, now });
  expect(result.snapshot.records[0].metrics.ig_reels_avg_watch_time).toMatchObject({ unit: 'milliseconds', value: 2500, provider_definition: 'Watch time in milliseconds.' });
  expect(result.snapshot.records[0].metrics.reels_skip_rate).toMatchObject({ unit: 'ratio', value: .25 });
  expect(init).not.toHaveBeenCalled(); init.mockRestore();
});

it.each([{ value: 100, fields: {} }, { value: 100, fields: { unit: 'count' } }])('fails closed for watch numbers without verified time units: %j', async ({ value, fields }) => {
  const result = await collectInstagramAudit(connection, 'run', { now, fetcher: transport(name => measurement(name, value, fields)) });
  expect(result.snapshot.records[0].metrics.ig_reels_avg_watch_time).toMatchObject({ status: 'error', value: null, unit: null });
});

it.each([{ unit: 'ratio', value: 1.1 }, { unit: 'percent', value: 101 }])('rejects out-of-range skip rates: %j', async ({ unit, value }) => {
  const result = await collectInstagramAudit(connection, 'run', { now, fetcher: transport(name => measurement(name, value, { unit })) });
  expect(result.snapshot.records[0].metrics.reels_skip_rate.status).toBe('error');
});

it('allows a bounded optional-metric probe using the same eight-request ceiling', async () => {
  const fetcher = transport(name => measurement(name, 0, { unit: 'milliseconds' }));
  const result = await runInstagramCapabilityProbe(connection, 'run', { fetcher, targetMediaId: '456',
    metrics: ['ig_reels_avg_watch_time', 'ig_reels_video_view_total_time'] });
  expect(result.request_count).toBeLessThanOrEqual(8);
  expect(result.metrics.ig_reels_avg_watch_time).toMatchObject({ value: 0, status: 'available', collector_unit_label: 'milliseconds' });
  const unused = transport();
  await expect(collectInstagramAudit(connection, 'run', { fetcher: unused, capabilityProbe: { metrics: Array(7).fill('views') } })).rejects.toThrow();
  expect(unused).not.toHaveBeenCalled();
});
