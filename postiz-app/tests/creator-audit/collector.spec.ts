import { collectInstagramAudit, InstagramAuditConnection } from '../../apps/backend/src/api/routes/creator-audit.collector';
import { writeFileSync } from 'fs';

const connection: InstagramAuditConnection = { id: 'connection-fixture', organizationId: 'org-fixture',
  internalId: '12345', providerIdentifier: 'instagram-standalone', token: 'FIXTURE_SECRET_TOKEN' };
const now = () => new Date('2026-10-07T12:00:00Z');
const profile = { user_id: '12345', id: '12345', username: 'fixture_creator', account_type: 'BUSINESS' };
const reel = (id = '100', overrides: any = {}) => ({ id, owner: { id: '12345' },
  media_product_type: 'REELS', media_type: 'VIDEO', timestamp: '2026-09-01T12:00:00Z',
  permalink: `https://www.instagram.com/reel/FIXTURE${id}/`,
  media_url: `https://scontent.cdninstagram.com/video-${id}.mp4?signature=transient`, caption: 'Fixture caption', ...overrides });
const json = (body: any, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
function transport(reels = [reel()], override?: (url: URL, init: RequestInit) => Response | undefined | Promise<Response>) {
  return jest.fn(async (input: any, init: any) => {
    const url = new URL(input);
    const custom = await override?.(url, init);
    if (custom) return custom;
    if (url.pathname.endsWith('/me') || url.pathname === '/v25.0/12345') return json(profile);
    if (url.pathname.endsWith('/media')) return json({ data: reels });
    const metric = url.searchParams.get('metric');
    return json({ data: [{ name: metric, period: 'lifetime', values: [{ value: metric === 'views' ? 0 : 10 }] }] });
  });
}
const collect = (fetcher: any, extra: any = {}, conn = connection, run = 'run-fixture') => collectInstagramAudit(conn, run, { fetcher, now, ...extra });
const calls = (fetcher: any, name: string) => fetcher.mock.calls.filter(([url]: any[]) => new URL(url).searchParams.get('metric') === name);

it('exports immutable sanitized official measurements including real zero and transient assets separately', async () => {
  const fetcher = transport();
  const result = await collect(fetcher);
  expect(result.snapshot).toMatchObject({ organization_id: 'org-fixture', account_id: '12345', run_id: 'run-fixture', api_version: 'v25.0',
    coverage: { discovered: 1, partial_reason: null, truncated: false } });
  expect(result.snapshot.records[0]).toMatchObject({ relationship: 'primary_owned', paid: null, trial: null, duration_seconds: null,
    metrics: { views: { value: 0, status: 'available', unit: 'count', source: 'instagram_media_insights',
      definition: 'instagram-views-lifetime-v25.0', api_version: 'v25.0', observed_at: now().toISOString(), period: 'lifetime', since: null, until: null } } });
  expect(result.snapshot.records[0].metrics.ig_reels_avg_watch_time).toBeUndefined();
  expect(result.snapshot.capabilities.ig_reels_avg_watch_time).toBe('not_requested');
  expect(Object.isFrozen(result.snapshot.records[0].metrics.views)).toBe(true);
  expect(result.assets[0].url).toContain('signature=transient');
  expect(JSON.stringify(result.snapshot)).not.toMatch(/FIXTURE_SECRET_TOKEN|signature=transient|media_url/);
  expect(fetcher).toHaveBeenCalledTimes(8);
  for (const [url, init] of fetcher.mock.calls) {
    expect(url).toMatch(/^https:\/\/graph.instagram.com\/v25.0\//);
    expect(url).not.toContain(connection.token);
    expect(init.headers).toEqual({ Authorization: `Bearer ${connection.token}` });
    expect(init.redirect).toBe('error');
  }
  if (process.env.AUDIT_COLLECTOR_FIXTURE) writeFileSync(process.env.AUDIT_COLLECTOR_FIXTURE, JSON.stringify(result.snapshot, null, 2));
});

it.each([
  ['instagram', 'graph.facebook.com', '12345', 'id,username', { id: '12345', username: 'fixture_creator' }],
  ['instagram-standalone', 'graph.instagram.com', 'me', 'user_id,username', { user_id: '12345', username: 'fixture_creator' }],
])('uses existing %s profile fields without requiring an account type', async (provider, host, path, fields, response) => {
  const fetcher = transport([reel()], url => url.pathname === `/v25.0/${path}` ? json(response) : undefined);
  const result = await collect(fetcher, {}, { ...connection, providerIdentifier: provider as string });
  const requested = new URL(fetcher.mock.calls[0][0]);
  expect(requested.origin + requested.pathname).toBe(`https://${host}/v25.0/${path}`);
  expect(requested.searchParams.get('fields')).toBe(fields);
  expect(result.account).toEqual({ account_id: '12345', username: 'fixture_creator' });
});

it('ignores arbitrary paging.next URLs, uses opaque after on its fixed endpoint, and deduplicates pages', async () => {
  const fetcher = transport([], url => url.pathname.endsWith('/media') ? json(url.searchParams.has('after') ?
    { data: [reel('100'), reel('101')] } : { data: [reel()], paging: { next: 'http://127.0.0.1/secrets?access_token=LEAK', cursors: { after: 'SAFE_CURSOR' } } }) : undefined);
  const result = await collect(fetcher);
  expect(result.snapshot.records).toHaveLength(2);
  expect(calls(fetcher, 'views')).toHaveLength(2);
  const listing = fetcher.mock.calls.filter(([url]) => new URL(url).pathname.endsWith('/media'));
  expect(new URL(listing[1][0]).searchParams.get('after')).toBe('SAFE_CURSOR');
  expect(JSON.stringify(result)).not.toContain('127.0.0.1');
});

it.each([
  { user_id: '999' }, { username: 'bad/name' }, { account_type: 'PERSONAL' }, { account_type: null },
])('fails profile contradiction/professional probe before metadata or metrics: %j', async change => {
  const fetcher = transport([], url => url.pathname.endsWith('/me') ? json({ ...profile, ...change }) : undefined);
  await expect(collect(fetcher)).rejects.toThrow('instagram_audit_invalid_identity_or_response');
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('fails explicit record account contradictions across the entire discovered listing before Insights', async () => {
  const fetcher = transport([reel(), reel('101', { account_id: '999' })]);
  await expect(collect(fetcher)).rejects.toThrow('instagram_audit_invalid_identity_or_response');
  expect(calls(fetcher, 'views')).toHaveLength(0);
});

it('retains foreign/missing ownership as unknown without private Insights or inferred collaboration', async () => {
  const fetcher = transport([reel(), reel('101', { owner: undefined }), reel('102', { owner: { id: '999' } })]);
  const result = await collect(fetcher);
  expect(result.snapshot.records.map(record => record.relationship)).toEqual(['primary_owned', 'unknown', 'unknown']);
  expect(result.snapshot.records[2].owner_id).toBe('999');
  expect(calls(fetcher, 'views')).toHaveLength(1);
  expect(result.snapshot.records[1].metrics.views.status).toBe('not_requested');
});

it.each([
  reel('101', { permalink: 'https://www.instagram.com/reel/FIXTURE100/' }),
  reel('100', { permalink: 'https://www.instagram.com/reel/CONTRADICTORY/' }),
  reel('100', { owner: { id: '999' } }),
])('rejects ambiguous official ID/shortcode joins: %j', async conflicting => {
  const fetcher = transport([reel(), conflicting]);
  await expect(collect(fetcher)).rejects.toThrow('instagram_audit_invalid_identity_or_response');
  expect(calls(fetcher, 'views')).toHaveLength(0);
});

it('filters non-Reels and the 180-day window without turning public counts into Insights', async () => {
  const result = await collect(transport([reel(), reel('101', { media_product_type: 'FEED' }),
    reel('102', { timestamp: '2026-01-01T00:00:00Z' }), reel('103', { timestamp: '2026-10-08T00:00:00Z' })]));
  expect(result.snapshot.records).toHaveLength(1);
  expect(result.snapshot.window).toEqual({ since: '2026-04-10T12:00:00.000Z', until: now().toISOString() });
});

it.each([
  'http://scontent.cdninstagram.com/video.mp4', 'https://cdninstagram.com.evil.test/video.mp4',
  'https://scontent.cdninstagram.com@evil.test/video.mp4', 'https://127.0.0.1/video.mp4',
  'https://scontent.cdninstagram.com:444/video.mp4', 'https://scontent.cdninstagram.com/video.mp4#fragment',
  'https://scontent.cdninstagram.com/\nvideo.mp4', 'https://user:pass@scontent.fbcdn.net/video.mp4',
  'https://scontent.cdninstagram.com/%0avideo.mp4',
  `https://scontent.cdninstagram.com/video.mp4?access_token=${connection.token}`,
])('rejects untrusted asset URL without fetching it: %s', async url => {
  const fetcher = transport([reel('100', { media_url: url })]);
  const result = await collect(fetcher);
  expect(result.assets).toEqual([]);
  expect(result.snapshot.records[0].asset_status).toBe('unavailable');
  expect(fetcher).toHaveBeenCalledTimes(8);
});

it('accepts Meta fbcdn URLs only as server assets and redacts credential text from captions', async () => {
  const result = await collect(transport([reel('100', { media_url: 'https://scontent.fbcdn.net/a.mp4', caption: connection.token })]));
  expect(result.assets).toEqual([{ media_id: '100', url: 'https://scontent.fbcdn.net/a.mp4', caption: '[redacted]' }]);
});

it.each(['unsupported', 'not_authorized'])('preserves %s metric failures without erasing views', async status => {
  const fetcher = transport([reel(), reel('101')], url => url.searchParams.get('metric') === 'reach' ?
    json({ error: { code: status === 'unsupported' ? 100 : 200, message: `secret=${connection.token}` } }, 400) : undefined);
  const result = await collect(fetcher);
  expect(calls(fetcher, 'reach')).toHaveLength(status === 'unsupported' ? 2 : 1);
  for (const record of result.snapshot.records) {
    expect(record.metrics.views).toMatchObject({ value: 0, status: 'available' });
    expect(record.metrics.reach).toMatchObject({ value: null, status });
  }
  expect(JSON.stringify(result)).not.toContain(connection.token);
});

it.each(['100', '101'])('keeps unsupported reach on media %s from suppressing supported media', async failingId => {
  const fetcher = transport([reel(), reel('101')], url => url.pathname === `/v25.0/${failingId}/insights` &&
    url.searchParams.get('metric') === 'reach' ? json({ error: { code: 100 } }, 400) : undefined);
  const result = await collect(fetcher);
  expect(calls(fetcher, 'reach')).toHaveLength(2);
  for (const record of result.snapshot.records) {
    expect(record.metrics.reach).toMatchObject(record.media_id === failingId ?
      { value: null, status: 'unsupported' } : { value: 10, status: 'available' });
  }
  expect(result.snapshot.capabilities.reach).toBe('available');
});

it.each([{}, { value: -1 }, { value: '10' }, { value: null }])('keeps missing/invalid values null instead of assuming zero: %j', async value => {
  const fetcher = transport([reel()], url => url.searchParams.get('metric') === 'views' ?
    json({ data: [{ name: 'views', period: 'lifetime', values: [value] }] }) : undefined);
  const result = await collect(fetcher);
  expect(result.snapshot.records[0].metrics.views).toMatchObject({ value: null, status: 'not_returned' });
});

it('rejects mismatched period/ambiguous rows and bounds transient HTTP retries without erasing other metrics', async () => {
  let attempts = 0;
  const fetcher = transport([reel()], url => {
    const name = url.searchParams.get('metric');
    if (name === 'views') return json({ data: [{ name, period: 'day', values: [{ value: 10 }] }] });
    if (name === 'reach') return json({ data: [{ name, values: [{ value: 10 }] }, { name, values: [{ value: 20 }] }] });
    if (name === 'shares') { attempts++; return json({ error: { message: connection.token } }, 503); }
    return undefined;
  });
  const result = await collect(fetcher);
  expect(attempts).toBe(2);
  expect(result.snapshot.records[0].metrics.views.status).toBe('error');
  expect(result.snapshot.records[0].metrics.reach.status).toBe('error');
  expect(result.snapshot.records[0].metrics.shares.status).toBe('error');
  expect(result.snapshot.records[0].metrics.saved.status).toBe('available');
});

it.each([429, 4, 17, 32, 613, 190, 401])('stops rate/auth %s immediately and resumes completed metrics without duplicate calls', async code => {
  const fetcher = transport([reel()], url => url.searchParams.get('metric') === 'shares' ?
    json({ error: { code, message: connection.token } }, code === 429 || code === 401 ? code : 400) : undefined);
  const partial = await collect(fetcher);
  expect(partial.snapshot.coverage.partial_reason).toBe(code === 190 || code === 401 ? 'auth_required' : 'rate_limited');
  expect(partial.snapshot.records[0].metrics.views.value).toBe(0);
  expect(partial.snapshot.records[0].metrics.shares.status).toBe('not_requested');
  expect(calls(fetcher, 'saved')).toHaveLength(0);
  const resume = transport();
  const result = await collect(resume, { checkpoint: partial.checkpoint }, connection, 'run-resumed');
  expect(calls(resume, 'views')).toHaveLength(0);
  expect(resume).toHaveBeenCalledTimes(4);
  expect(result.snapshot.coverage.partial_reason).toBeNull();
  expect(result.snapshot.run_id).toBe('run-resumed');
  expect(partial.snapshot.coverage.partial_reason).not.toBeNull();
  const completed = transport();
  await collect(completed, { checkpoint: result.checkpoint }, connection, 'run-complete-reuse');
  expect(completed).not.toHaveBeenCalled();
});

it('resumes a stopped metadata page on the same fixed endpoint with no repeated discovery or metrics', async () => {
  const fetcher = transport([], url => url.pathname.endsWith('/media') ? json(url.searchParams.has('after') ?
    { error: { code: 4 } } : { data: [reel()], paging: { next: 'https://evil.test', cursors: { after: 'AFTER_ONE' } } }, url.searchParams.has('after') ? 400 : 200) : undefined);
  const partial = await collect(fetcher);
  expect(calls(fetcher, 'views')).toHaveLength(0);
  const resume = transport([reel('101')]);
  const result = await collect(resume, { checkpoint: partial.checkpoint });
  expect(new URL(resume.mock.calls[0][0]).searchParams.get('after')).toBe('AFTER_ONE');
  expect(result.snapshot.records).toHaveLength(2);
});

it('binds resume checkpoints to organization, connection, account, provider and version', async () => {
  const result = await collect(transport());
  for (const change of [{ organizationId: 'foreign' }, { id: 'foreign' }, { internalId: '999' }, { providerIdentifier: 'instagram' }]) {
    const fetcher = transport();
    await expect(collect(fetcher, { checkpoint: result.checkpoint }, { ...connection, ...change })).rejects.toThrow('instagram_audit_invalid_identity_or_response');
    expect(fetcher).not.toHaveBeenCalled();
  }
});

it('keeps final snapshot time at least as late as all cached observations when the clock moves backwards', async () => {
  const first = await collect(transport());
  const replay = await collect(transport(), { checkpoint: first.checkpoint, now: () => new Date('2026-10-07T11:00:00Z') });
  expect(replay.snapshot.collected_at).toBe(first.snapshot.collected_at);
  expect(replay.snapshot.records[0].metrics.views.observed_at).toBe(first.snapshot.records[0].metrics.views.observed_at);
});

it('caps metadata at 300 with a disclosed partial reason and bounds pagination at ten pages', async () => {
  let page = 0;
  const fetcher = transport([], url => url.pathname.endsWith('/media') ? json({
    data: Array.from({ length: 50 }, (_, index) => reel(String(1000 + page * 50 + index))),
    paging: { next: 'https://ignored.test', cursors: { after: `PAGE_${++page}` } },
  }) : undefined);
  const result = await collect(fetcher);
  expect(page).toBe(6);
  expect(result.snapshot.coverage).toEqual({ discovered: 300, truncated: true, partial_reason: 'metadata_limit' });
  let emptyPage = 0;
  const empty = transport([], url => url.pathname.endsWith('/media') ? json({ data: [],
    paging: { next: 'https://ignored.test', cursors: { after: `PAGE_${++emptyPage}` } } }) : undefined);
  expect((await collect(empty)).snapshot.coverage.partial_reason).toBe('page_limit');
  expect(emptyPage).toBe(10);
});

it('does not repeat a cursor or trust malformed permalink identity', async () => {
  const repeated = transport([], url => url.pathname.endsWith('/media') ? json({ data: [], paging: { next: 'https://ignored.test', cursors: { after: 'SAME' } } }) : undefined);
  await expect(collect(repeated)).rejects.toThrow('instagram_audit_invalid_identity_or_response');
  await expect(collect(transport([reel('100', { permalink: 'https://evil.test/reel/FIXTURE100/' })]))).rejects.toThrow('instagram_audit_invalid_identity_or_response');
});

it('does not reflect a credential echoed into permalink identity or paging cursors', async () => {
  await expect(collect(transport([reel('100', { permalink: `https://www.instagram.com/reel/${connection.token}/` })]))).rejects.toThrow('instagram_audit_invalid_identity_or_response');
  const echoed = transport([], url => url.pathname.endsWith('/media') ? json({ data: [],
    paging: { next: 'https://ignored.test', cursors: { after: connection.token } } }) : undefined);
  await expect(collect(echoed)).rejects.toThrow('instagram_audit_invalid_identity_or_response');
  expect(echoed).toHaveBeenCalledTimes(2);
});

it('enforces the fixed total request budget even when every metric needs its bounded retry', async () => {
  let page = 0;
  const fetcher = transport([], url => {
    if (url.pathname.endsWith('/media')) return json({ data: Array.from({ length: 50 }, (_, index) => reel(String(1000 + page * 50 + index))),
      paging: { next: 'https://ignored.test', cursors: { after: `PAGE_${++page}` } } });
    if (url.pathname.endsWith('/insights')) return json({ error: { message: connection.token } }, 503);
    return undefined;
  });
  const result = await collect(fetcher);
  expect(fetcher).toHaveBeenCalledTimes(1900);
  expect(result.snapshot.coverage.partial_reason).toBe('request_budget');
  expect(result.snapshot.records[0].metrics.views.status).toBe('error');
  expect(result.snapshot.records[299].metrics.views.status).toBe('not_requested');
});

it('stops on a fixed timeout and strips raw transport errors from partial evidence', async () => {
  jest.useFakeTimers();
  try {
    const fetcher = jest.fn(() => new Promise<Response>(() => {}));
    const resultPromise = collect(fetcher);
    await jest.advanceTimersByTimeAsync(15000);
    const result = await resultPromise;
    expect(result.snapshot.coverage.partial_reason).toBe('timeout');
    expect(fetcher).toHaveBeenCalledTimes(1);
  } finally { jest.useRealTimers(); }
  const fetcher = jest.fn(async () => { throw new Error(`raw URL secret ${connection.token}`); });
  const result = await collect(fetcher);
  expect(result.snapshot.coverage.partial_reason).toBe('error');
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(JSON.stringify(result)).not.toContain(connection.token);
});
