import { collectInstagramAudit, InstagramAuditConnection } from '../../apps/backend/src/api/routes/creator-audit.collector';
import { runInstagramCapabilityProbe } from '../../apps/backend/src/api/routes/creator-audit.probe';
const connection: InstagramAuditConnection = { id: 'fixture', organizationId: 'org', internalId: '12345', providerIdentifier: 'instagram-standalone', token: 'FIXTURE_SECRET_TOKEN' };
const profile = { user_id: '12345', username: 'fixture', account_type: 'BUSINESS' };
const reel = { id: '100', owner: { id: '12345' }, media_product_type: 'REELS', media_type: 'VIDEO', timestamp: new Date().toISOString(), permalink: 'https://www.instagram.com/reel/FIXTURE/', media_url: 'https://scontent.cdninstagram.com/a.mp4?signature=PRIVATE', caption: connection.token };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
function transport(override?: (url: URL) => Response | undefined) {
  return jest.fn(async (input: any, init: RequestInit) => {
    const url = new URL(input), custom = override?.(url);
    if (custom) return custom;
    if (url.pathname.endsWith('/me')) return json(profile);
    if (url.pathname.endsWith('/media')) return json({ data: [reel], paging: { next: 'https://evil.test', cursors: { after: connection.token } } });
    if (url.pathname.endsWith('/100')) return json(reel);
    return json({ data: [{ name: url.searchParams.get('metric'), period: 'lifetime', values: [{ value: 0 }] }] });
  });
}
const probe = (fetcher: any, targetMediaId?: string) => runInstagramCapabilityProbe(connection, 'run', { fetcher, targetMediaId });
it('runs the real default transport with eight attempts, limit=1, no redirects or pagination and sanitized evidence', async () => {
  const fetcher = transport(), native = jest.spyOn(globalThis, 'fetch').mockImplementation(fetcher);
  try {
    const result = await runInstagramCapabilityProbe(connection, 'run');
    expect(result).toMatchObject({ request_count: 8, status: 'complete', stop_reason: null, requested_version: 'v25.0', login_verified: true, primary_owned_reel_verified: true, asset_url_present: true });
    expect(result.metrics.views).toEqual({ value: 0, status: 'available', returned_metric_name: 'views', returned_period: 'lifetime', unit: null, definition: null, collector_unit_label: 'count' });
    expect(result.ledger.map(item => item.operation)).toEqual(['profile', 'metadata', ...Array(6).fill('insights')]);
    expect(fetcher).toHaveBeenCalledTimes(8);
    expect(new URL(fetcher.mock.calls[1][0]).searchParams.get('limit')).toBe('1');
    for (const [url, init] of fetcher.mock.calls) {
      expect(url).toMatch(/^https:\/\/graph.instagram.com\/v25.0\//);
      expect(url).not.toMatch(/after=|FIXTURE_SECRET_TOKEN/);
      expect(init.redirect).toBe('manual');
      expect(init.headers).toEqual({ Authorization: `Bearer ${connection.token}` });
      expect(init.signal).toBeInstanceOf(AbortSignal);
    }
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE|FIXTURE_SECRET_TOKEN|cdninstagram|caption|permalink|username|checkpoint/);
    expect(Object.isFrozen(result.metrics.views)).toBe(true);
  } finally { native.mockRestore(); }
});
it('rechecks target object ownership before any Insights', async () => {
  const fetcher = transport(); await probe(fetcher, '100');
  expect(new URL(fetcher.mock.calls[1][0]).pathname).toBe('/v25.0/100');
  expect(new URL(fetcher.mock.calls[1][0]).searchParams.get('fields')).toContain('owner');
  expect(new URL(fetcher.mock.calls[1][0]).searchParams.has('limit')).toBe(false);
  const foreign = transport(url => url.pathname.endsWith('/100') ? json({ ...reel, owner: { id: '999' } }) : undefined);
  expect((await probe(foreign, '100')).stop_reason).toBe('no_owned_reel');
  expect(foreign).toHaveBeenCalledTimes(2);
});
it.each([{ owner: undefined }, { owner: { id: '999' } }, { media_product_type: 'FEED' }])('stops on the first unqualified listing item: %j', async change => {
  const fetcher = transport(url => url.pathname.endsWith('/media') ? json({ data: [{ ...reel, ...change }], paging: { next: 'https://evil.test' } }) : undefined);
  expect((await probe(fetcher)).stop_reason).toBe('no_owned_reel'); expect(fetcher).toHaveBeenCalledTimes(2);
});
it('rejects broad listings and target ID contradictions without Insights', async () => {
  const listing = transport(url => url.pathname.endsWith('/media') ? json({ data: [reel, reel] }) : undefined);
  expect((await probe(listing)).stop_reason).toBe('error'); expect(listing).toHaveBeenCalledTimes(2);
  const target = transport(url => url.pathname.endsWith('/100') ? json({ ...reel, id: '101' }) : undefined);
  expect((await probe(target, '100')).stop_reason).toBe('invalid_response'); expect(target).toHaveBeenCalledTimes(2);
});
it.each([302, 401, 403, 429, 459, 190, 4])('stops redirects, auth, challenge or rate errors immediately: %s', async code => {
  const status = [302, 401, 403, 429].includes(code) ? code : 400;
  const fetcher = transport(url => url.searchParams.get('metric') === 'views' ? json({ error: { code, message: connection.token } }, status) : undefined);
  const result = await probe(fetcher);
  expect(result.stop_reason).toBe(code === 302 ? 'redirect_blocked' : code === 403 ? 'not_authorized' : [401, 190].includes(code) ? 'auth_required' : code === 459 ? 'challenge_required' : 'rate_limited');
  expect(fetcher).toHaveBeenCalledTimes(3); expect(JSON.stringify(result)).not.toContain(connection.token);
});
it.each([503, 400])('never retries failed requests: %s', async status => {
  const fetcher = transport(url => url.searchParams.get('metric') === 'views' ? json({ error: { message: connection.token } }, status) : undefined);
  expect((await probe(fetcher)).stop_reason).toBe('invalid_core_metric'); expect(fetcher).toHaveBeenCalledTimes(3);
});
it.each([{}, { value: '10' }, { value: -1 }, { value: null }])('stops invalid core views before optional metrics: %j', async value => {
  const fetcher = transport(url => url.searchParams.get('metric') === 'views' ? json({ data: [{ name: 'views', period: 'lifetime', values: [value] }] }) : undefined);
  const result = await probe(fetcher); expect(result.stop_reason).toBe('invalid_core_metric');
  expect(result.metrics.views.value).toBeNull(); expect(result.metrics.reach.status).toBe('not_requested'); expect(fetcher).toHaveBeenCalledTimes(3);
});
it('keeps unsupported optional values null and reports only safe returned units and definitions', async () => {
  const fetcher = transport(url => {
    const metric = url.searchParams.get('metric');
    if (metric === 'reach') return json({ error: { code: 100, message: connection.token } }, 400);
    if (metric === 'views') return json({ data: [{ name: 'views', period: 'lifetime', unit: 'count', description: 'Number of views.', total_value: { value: 12 } }] });
    if (metric === 'likes') return json({ data: [{ name: 'likes', unit: connection.token, description: 'https://scontent.cdninstagram.com/SECRET', values: [{ value: 3 }] }] });
    return undefined;
  });
  const result = await probe(fetcher); expect(result.status).toBe('complete');
  expect(result.metrics.reach).toMatchObject({ value: null, status: 'unsupported', unit: null, definition: null });
  expect(result.metrics.views).toMatchObject({ value: 12, unit: 'count', definition: 'Number of views.' });
  expect(result.metrics.likes).toMatchObject({ returned_period: null, unit: null, definition: null }); expect(JSON.stringify(result)).not.toMatch(/SECRET|cdninstagram/);
});
it('enforces five-second timeouts even on injected transport ignoring AbortSignal', async () => {
  jest.useFakeTimers();
  try {
    const fetcher = jest.fn(() => new Promise<Response>(() => {})), pending = probe(fetcher);
    await jest.advanceTimersByTimeAsync(5000); expect((await pending).stop_reason).toBe('timeout');
    expect(fetcher).toHaveBeenCalledTimes(1); expect((fetcher.mock.calls as any)[0][1].signal.aborted).toBe(true);
  } finally { jest.useRealTimers(); }
});
it('rejects resume checkpoints and invalid targets before any outbound attempt', async () => {
  const fetcher = transport();
  await expect(collectInstagramAudit(connection, 'run', { fetcher, capabilityProbe: {}, checkpoint: { version: 1, state: {} } as any })).rejects.toThrow();
  await expect(probe(fetcher, '../me')).rejects.toThrow(); expect(fetcher).not.toHaveBeenCalled();
});
it('keeps response-body parsing within the same five-second timeout', async () => {
  jest.useFakeTimers();
  try {
    const fetcher = jest.fn(async () => ({ status: 200, ok: true, json: () => new Promise(() => {}) } as any));
    const pending = probe(fetcher);
    await jest.advanceTimersByTimeAsync(5000);
    expect((await pending).stop_reason).toBe('timeout');
    expect(fetcher).toHaveBeenCalledTimes(1);
  } finally { jest.useRealTimers(); }
});
it('native fetch does not follow a redirect even when its location names another endpoint', async () => {
  const { createServer } = await import('http');
  let hits = 0;
  const server = createServer((_req, res) => { hits++; res.writeHead(302, { Location: '/unexpected' }); res.end(); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address() as { port: number };
    // Offline loopback fixture exercises native fetch redirect behavior using the collector's actual init.
    const fetcher: typeof fetch = (_input, init) => fetch(`http://127.0.0.1:${address.port}/redirect`, init);
    const result = await runInstagramCapabilityProbe(connection, 'run', { fetcher });
    expect(result.stop_reason).toBe('redirect_blocked'); expect(result.request_count).toBe(1); expect(hits).toBe(1);
  } finally {
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
it('enforces the forty-five-second total deadline before another request', async () => {
  let elapsed = 0;
  const clock = jest.spyOn(Date, 'now').mockImplementation(() => 100000 + elapsed);
  const fetcher = transport(url => {
    if (url.pathname.endsWith('/me')) { elapsed = 45000; return json(profile); }
    return undefined;
  });
  try {
    const result = await probe(fetcher);
    expect(result.stop_reason).toBe('time_budget'); expect(result.request_count).toBe(1); expect(fetcher).toHaveBeenCalledTimes(1);
  } finally { clock.mockRestore(); }
});
it.each(['day', 'ambiguous'])('stops mismatched or ambiguous core views: %s', async kind => {
  const row = { name: 'views', period: kind === 'day' ? 'day' : 'lifetime', values: [{ value: 10 }] };
  const fetcher = transport(url => url.searchParams.get('metric') === 'views' ? json({ data: kind === 'ambiguous' ? [row, row] : [row] }) : undefined);
  const result = await probe(fetcher); expect(result.stop_reason).toBe('invalid_core_metric');
  expect(result.metrics.views).toMatchObject({ status: 'error', value: null }); expect(fetcher).toHaveBeenCalledTimes(3);
});
it('distinguishes unobserved, absent and raw untrusted asset URL presence', async () => {
  const failed = transport(url => url.pathname.endsWith('/me') ? json({ error: { code: 190 } }, 400) : undefined);
  expect((await probe(failed)).asset_url_present).toBeNull();
  const absent = transport(url => url.pathname.endsWith('/media') ? json({ data: [{ ...reel, media_url: '' }] }) : undefined);
  expect((await probe(absent)).asset_url_present).toBe(false);
  const untrusted = transport(url => url.pathname.endsWith('/media') ? json({ data: [{ ...reel, media_url: 'https://evil.test/private-token' }] }) : undefined);
  const result = await probe(untrusted);
  expect(result.asset_url_present).toBe(true); expect(JSON.stringify(result)).not.toMatch(/evil|private-token/);
});
it.each(['v25.0', 'v24.0', 'https://SECRET.test'])('records only strict response version headers and safe HTTP status: %s', async version => {
  const fetcher = transport(url => url.pathname.endsWith('/me') ? new Response(JSON.stringify(profile), {
    status: 200, headers: { 'facebook-api-version': version, 'Authorization': connection.token },
  }) : undefined);
  const result = await probe(fetcher);
  expect(result.ledger[0]).toMatchObject({ http_status: 200, response_version: version.startsWith('v') ? version : null });
  expect(result.requested_version).toBe('v25.0'); expect(JSON.stringify(result)).not.toMatch(/SECRET|Authorization/);
});
it.each(['day', 'week', 'days_28', 'total_over_range'])('preserves safe observed periods despite normalization failure: %s', async period => {
  const fetcher = transport(url => url.searchParams.get('metric') === 'views' ? json({ data: [{ name: 'views', period, values: [{ value: 10 }] }] }) : undefined);
  const result = await probe(fetcher);
  expect(result.metrics.views).toMatchObject({ returned_metric_name: 'views', returned_period: period, value: null, status: 'error' });
});
it('caps native Response bytes before JSON parsing and later network requests', async () => {
  const oversized = new Response(JSON.stringify({ ...profile, ignored: 'x'.repeat(262144) }));
  const parse = jest.spyOn(oversized, 'json');
  const fetcher = transport(url => url.pathname.endsWith('/me') ? oversized : undefined);
  const result = await probe(fetcher);
  expect(result.stop_reason).toBe('response_budget'); expect(result.request_count).toBe(1);
  expect(fetcher).toHaveBeenCalledTimes(1); expect(parse).not.toHaveBeenCalled();
  expect(JSON.stringify(result)).not.toContain('ignored');
});
