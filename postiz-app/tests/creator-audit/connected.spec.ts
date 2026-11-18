import { ConnectedAuditJobs } from '../../apps/backend/src/api/routes/creator-audit.connected';
import { createHash } from 'crypto';
import { verify } from 'jsonwebtoken';

const org = '00000000-0000-4000-8000-000000000011';
const foreign = '00000000-0000-4000-8000-000000000012';
const actor = '00000000-0000-4000-8000-000000000021';
const otherActor = '00000000-0000-4000-8000-000000000022';
const secret = 'fixture-only-connected-audit-secret-'.repeat(3);
const origin = 'http://receiver.example.test';
const connection = { id: 'fixture-connection', organizationId: org, internalId: '12345',
  providerIdentifier: 'instagram-standalone', token: 'PRIVATE_FIXTURE_TOKEN' };
const input = { integration_id: connection.id, analysis_cap: 3 };
const env = { ...process.env };
const originalFetch = global.fetch;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
let lookup: jest.Mock, upstream: jest.Mock, jobs: ConnectedAuditJobs;

function transport(override?: (url: URL, init: RequestInit) => Response | Promise<Response> | undefined) {
  return jest.fn(async (value: string, init: RequestInit) => {
    const url = new URL(value);
    const custom = await override?.(url, init);
    if (custom) return custom;
    if (url.origin === origin) return json({ id: 'untrusted-receiver-id' }, 202);
    if (url.origin !== 'https://graph.instagram.com' && url.origin !== 'https://graph.facebook.com') {
      throw new Error('Unexpected offline endpoint');
    }
    if (url.pathname.endsWith('/me') || url.pathname === '/v25.0/12345') {
      return json({ user_id: '12345', id: '12345', username: 'fixture_creator', account_type: 'BUSINESS' });
    }
    if (url.pathname.endsWith('/media')) return json({ data: [{ id: '100', owner: { id: '12345' },
      media_product_type: 'REELS', timestamp: new Date(Date.now() - 86400000).toISOString(),
      permalink: 'https://www.instagram.com/reel/FIXTURE100/',
      media_url: 'https://scontent.cdninstagram.com/fixture.mp4?signature=PRIVATE_CDN_SIGNATURE', caption: 'Fixture caption' }] });
    if (!url.pathname.endsWith('/insights')) throw new Error('Unexpected offline Meta path');
    return json({ data: [{ name: url.searchParams.get('metric'), period: 'lifetime', values: [{ value: 0 }] }] });
  });
}
const receiverCalls = () => upstream.mock.calls.filter(([url]) => new URL(url).origin === origin);
const metaCalls = () => upstream.mock.calls.filter(([url]) => new URL(url).origin !== origin);
async function settled(id: string, organization = org) {
  for (let i = 0; i < 100; i++) {
    const view = jobs.view(id, organization);
    if (view.status !== 'running') return view;
    await new Promise(resolve => setImmediate(resolve));
  }
  throw new Error('Offline audit did not settle');
}
function safePublic(value: unknown) {
  expect(JSON.stringify(value)).not.toMatch(/PRIVATE_FIXTURE_TOKEN|PRIVATE_CDN_SIGNATURE|checkpoint|assets|fixture_creator|access_token/);
}
async function startAndSettle(body = input) {
  const started = await jobs.start(org, actor, body);
  const view = await settled(started.id);
  return { started, view };
}

beforeEach(() => {
  process.env = { ...env, CREATOR_AUDIT_ENABLED: 'true', CREATOR_AUDIT_SERVICE_SECRET: secret,
    CREATOR_AUDIT_SERVICE_URL: origin, JWT_SECRET: 'fixture-browser-secret'.repeat(3) };
  lookup = jest.fn(async () => ({ ...connection }));
  jobs = new ConnectedAuditJobs(lookup);
  upstream = transport(); global.fetch = upstream;
});
afterEach(() => { global.fetch = originalFetch; process.env = env; });

it('scopes both connection lookups to server organization and exposes only job identity', async () => {
  const { started } = await startAndSettle();
  expect(lookup.mock.calls).toEqual([[org, connection.id], [org, connection.id]]);
  expect(started).toEqual({ id: expect.stringMatching(/^[a-f0-9]{32}$/), kind: 'connected', status: 'running' });
  expect(jobs.identity(started.id, org)).toEqual(input);
  expect(jobs.identity(started.id, foreign)).toEqual({});
  expect(jobs.owns(started.id, foreign)).toBe(false);
  expect(jobs.submitted(started.id, org)).toBe(true);
  expect(jobs.submitted(started.id, foreign)).toBe(false);
  expect(() => jobs.view(started.id, foreign)).toThrow('Audit task unavailable.');
  expect(jobs.current(foreign)).toBeNull();
  safePublic(started); safePublic(jobs.view(started.id, org));
});

it('refuses disabled service before connection lookup or network work', async () => {
  process.env.CREATOR_AUDIT_ENABLED = 'false';
  await expect(jobs.start(org, actor, input)).rejects.toMatchObject({ status: 404 });
  expect(lookup).not.toHaveBeenCalled(); expect(upstream).not.toHaveBeenCalled();
});

it.each([
  null, { ...connection, organizationId: foreign }, { ...connection, id: 'foreign-connection' },
  { ...connection, disabled: true }, { ...connection, deletedAt: new Date() },
  { ...connection, inBetweenSteps: true }, { ...connection, providerIdentifier: 'youtube' },
])('rejects unavailable or cross-scope connections before collection: %j', async unavailable => {
  lookup.mockResolvedValue(unavailable);
  await expect(jobs.start(org, actor, input)).rejects.toMatchObject({ status: 400 });
  expect(upstream).not.toHaveBeenCalled(); expect(jobs.current(org)).toBeNull();
});

it.each([
  { token: '' }, { refreshNeeded: true }, { tokenExpiration: '2000-01-01' },
  { tokenExpiration: 'invalid-date' },
])('requires reconnect before any provider or receiver calls: %j', async change => {
  lookup.mockResolvedValue({ ...connection, ...change });
  await expect(jobs.start(org, actor, input)).rejects.toMatchObject({ status: 409 });
  expect(upstream).not.toHaveBeenCalled(); expect(jobs.current(org)).toBeNull();
});

it.each([0, 31, -1, 1.5, '3', NaN, Infinity])('rejects invalid analysis budget %s before lookup', async analysis_cap => {
  await expect(jobs.start(org, actor, { ...input, analysis_cap })).rejects.toMatchObject({ status: 400 });
  expect(lookup).not.toHaveBeenCalled(); expect(upstream).not.toHaveBeenCalled();
});

it.each([1, 30, undefined])('preserves bounded analysis cap %s in the receiver request', async analysis_cap => {
  const { started } = await startAndSettle({ ...input, analysis_cap } as any);
  expect(JSON.parse(receiverCalls()[0][1].body).analysis_cap).toBe(analysis_cap ?? 30);
  expect(jobs.identity(started.id, org).analysis_cap).toBe(analysis_cap ?? 30);
});

it.each([null, [], {}, { ...input, org: foreign }, { ...input, access_token: 'CALLER_TOKEN' },
  { ...input, integration_id: '../foreign' }])('rejects malformed or caller-supplied scope/credentials: %j', async body => {
  await expect(jobs.start(org, actor, body)).rejects.toMatchObject({ status: 400 });
  expect(lookup).not.toHaveBeenCalled(); expect(upstream).not.toHaveBeenCalled();
});

it('permits only one active job per organization even when starts race at async lookup', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  lookup.mockImplementation(async () => { await gate; return { ...connection }; });
  const first = jobs.start(org, actor, input), second = jobs.start(org, actor, input);
  release();
  const results = await Promise.allSettled([first, second]);
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  expect(results.find(result => result.status === 'rejected')).toMatchObject({ reason: { status: 409 } });
  const started = (results.find(result => result.status === 'fulfilled') as PromiseFulfilledResult<any>).value;
  await settled(started.id);
  await expect(jobs.start(org, actor, input)).rejects.toMatchObject({ status: 409 });
  expect(receiverCalls()).toHaveLength(1);
  const priorCalls = upstream.mock.calls.length;
  expect(await jobs.start(org, actor, { ...input, resume_task_id: started.id })).toEqual(started);
  expect(upstream).toHaveBeenCalledTimes(priorCalls);
});

it('allows separate organizations to collect independently with distinct signed snapshots', async () => {
  lookup.mockImplementation(async organization => ({ ...connection, organizationId: organization }));
  const first = await jobs.start(org, actor, input); await settled(first.id);
  const second = await jobs.start(foreign, otherActor, input); await settled(second.id, foreign);
  expect(second.id).not.toBe(first.id);
  expect(jobs.current(org)).toBe(first.id); expect(jobs.current(foreign)).toBe(second.id);
  const requests = receiverCalls().map(([, options]) => ({ body: JSON.parse(options.body),
    claims: verify(options.headers.Authorization.slice(7), secret) }));
  expect(requests).toMatchObject([
    { body: { task_id: first.id, snapshot: { organization_id: org } }, claims: { org, sub: actor } },
    { body: { task_id: second.id, snapshot: { organization_id: foreign } }, claims: { org: foreign, sub: otherActor } },
  ]);
});

it('submits interrupted collection as signed collect_only with safe public status', async () => {
  upstream = transport(url => url.searchParams.get('metric') === 'shares' ? json({ error: { code: 4,
    message: connection.token + ' PRIVATE_CDN_SIGNATURE' } }, 400) : undefined);
  global.fetch = upstream;
  const { started, view } = await startAndSettle();
  expect(view).toMatchObject({ ...input, id: started.id, kind: 'connected', status: 'error',
    error_code: 'rate_limited', resumable: true });
  expect(jobs.current(org)).toBe(started.id); expect(jobs.submitted(started.id, org)).toBe(false);
  const [url, options] = receiverCalls()[0];
  expect(url).toBe(origin + '/api/audit/connected');
  expect(options).toMatchObject({ method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/json' } });
  const body = JSON.parse(options.body);
  expect(body).toMatchObject({ task_id: started.id, analysis_cap: 3, collect_only: true,
    account: { account_id: '12345', username: 'fixture_creator' },
    snapshot: { organization_id: org, connection_id: connection.id, coverage: { partial_reason: 'rate_limited' } } });
  expect(body.assets[0].url).toContain('PRIVATE_CDN_SIGNATURE');
  expect(options.body).not.toMatch(/PRIVATE_FIXTURE_TOKEN|checkpoint/);
  const claims: any = verify(options.headers.Authorization.slice(7), secret,
    { algorithms: ['HS256'], issuer: 'everywhereposter', audience: 'creator-audit' });
  expect(claims).toMatchObject({ org, sub: actor, method: 'POST', path: '/api/audit/connected',
    purpose: 'connected_snapshot', writable: true, body_sha256: createHash('sha256').update(options.body).digest('hex') });
  expect(claims.exp - claims.iat).toBe(30);
  safePublic(view); safePublic(started);
});

it('retains checkpoint progress and binds resume to cap, connection and organization', async () => {
  let interrupted = true;
  upstream = transport(url => interrupted && url.searchParams.get('metric') === 'shares' ? json({}, 429) : undefined);
  global.fetch = upstream;
  const { started } = await startAndSettle();
  const previousCalls = upstream.mock.calls.length, previousLookups = lookup.mock.calls.length;
  for (const [organization, body] of [[foreign, { ...input, resume_task_id: started.id }],
    [org, { ...input, analysis_cap: 4, resume_task_id: started.id }],
    [org, { ...input, integration_id: 'other-connection', resume_task_id: started.id }]] as const) {
    await expect(jobs.start(organization, actor, body)).rejects.toMatchObject({ status: 404 });
  }
  expect(upstream).toHaveBeenCalledTimes(previousCalls); expect(lookup).toHaveBeenCalledTimes(previousLookups);
  interrupted = false;
  expect(await jobs.start(org, otherActor, { ...input, resume_task_id: started.id })).toEqual(started);
  await settled(started.id);
  const resumedMeta = upstream.mock.calls.slice(previousCalls).filter(([url]) => new URL(url).origin !== origin);
  expect(resumedMeta.map(([url]) => new URL(url).searchParams.get('metric'))).toEqual(['shares', 'saved', 'likes', 'comments',
    'ig_reels_avg_watch_time', 'ig_reels_video_view_total_time', 'reels_skip_rate', 'reposts', 'total_interactions',
    'follows', 'profile_visits', 'profile_activity', 'facebook_views', 'crossposted_views']);
  const options = receiverCalls()[1][1], body = JSON.parse(options.body);
  expect(body.collect_only).toBeUndefined(); expect(body.snapshot.records[0].metrics.views.value).toBe(0);
  expect(body.snapshot.coverage.partial_reason).toBeNull(); expect(jobs.submitted(started.id, org)).toBe(true);
  expect(verify(options.headers.Authorization.slice(7), secret)).toMatchObject({ sub: otherActor });
});

it('rejects account changes on checkpoint resume before another Meta request or submission', async () => {
  upstream = transport(url => url.searchParams.get('metric') === 'shares' ? json({}, 429) : undefined);
  global.fetch = upstream;
  const { started } = await startAndSettle();
  const calls = upstream.mock.calls.length;
  lookup.mockResolvedValue({ ...connection, internalId: '99999' });
  await jobs.start(org, actor, { ...input, resume_task_id: started.id });
  expect(await settled(started.id)).toMatchObject({ status: 'error', error_code: 'connected_audit_interrupted' });
  expect(upstream).toHaveBeenCalledTimes(calls);
});

it('replays a complete cached snapshot after receiver rejection without any new Meta calls', async () => {
  let reject = true;
  upstream = transport(url => url.origin === origin && reject ? json({ error: connection.token }, 400) : undefined);
  global.fetch = upstream;
  const { started, view } = await startAndSettle();
  expect(view.error_code).toBe('connected_audit_interrupted'); safePublic(view);
  const firstBody = receiverCalls()[0][1].body, count = metaCalls().length;
  reject = false;
  await jobs.start(org, actor, { ...input, resume_task_id: started.id }); await settled(started.id);
  expect(metaCalls()).toHaveLength(count); expect(receiverCalls()).toHaveLength(2);
  expect(receiverCalls()[1][1].body).toBe(firstBody); expect(jobs.submitted(started.id, org)).toBe(true);
});

it.each([{ internalId: '99999' }, { providerIdentifier: 'instagram' }])('refuses cached replay for a changed account/provider: %j', async change => {
  upstream = transport(url => url.origin === origin ? json({}, 400) : undefined); global.fetch = upstream;
  const { started } = await startAndSettle();
  const calls = upstream.mock.calls.length;
  lookup.mockResolvedValue({ ...connection, ...change });
  await jobs.start(org, actor, { ...input, resume_task_id: started.id });
  expect((await settled(started.id)).error_code).toBe('connected_audit_interrupted');
  expect(upstream).toHaveBeenCalledTimes(calls);
});

it('hides raw transport errors and pauses missing-profile collection without submitting', async () => {
  upstream = transport(url => url.pathname.endsWith('/me') ? json({ error: { code: 190,
    message: connection.token + ' PRIVATE_CDN_SIGNATURE' } }, 400) : undefined); global.fetch = upstream;
  const { started, view } = await startAndSettle();
  expect(view.error_code).toBe('auth_required'); safePublic(view);
  expect(receiverCalls()).toHaveLength(0); expect(metaCalls()).toHaveLength(1);
  expect(jobs.current(org)).toBe(started.id);
});

it('rechecks connection availability between preflight and collection', async () => {
  lookup.mockResolvedValueOnce({ ...connection }).mockResolvedValue({ ...connection, token: '' });
  const { view } = await startAndSettle();
  expect(view.error_code).toBe('connected_audit_interrupted'); safePublic(view);
  expect(upstream).not.toHaveBeenCalled();
});

it('completion requires task ownership and frees the organization for its next audit', async () => {
  const { started } = await startAndSettle();
  jobs.finished(started.id, foreign);
  await expect(jobs.start(org, actor, input)).rejects.toMatchObject({ status: 409 });
  jobs.finished(started.id, org);
  expect(jobs.current(org)).toBeNull(); expect(jobs.submitted(started.id, org)).toBe(true);
  const next = await jobs.start(org, actor, input); await settled(next.id);
  expect(next.id).not.toBe(started.id); expect(receiverCalls()).toHaveLength(2);
});


it.each(['lost-response', 503, 409])('retains the submission lock and never resends ambiguous acceptance: %s', async failure => {
  upstream = transport(url => {
    if (url.origin !== origin) return undefined;
    if (failure === 'lost-response') throw new Error('Accepted task response lost PRIVATE_FIXTURE_TOKEN');
    return json({}, failure as number);
  });
  global.fetch = upstream;
  const { started, view } = await startAndSettle();
  expect(view).toMatchObject({ error_code: 'submission_unconfirmed', resumable: false });
  safePublic(view);
  expect(jobs.submitted(started.id, org)).toBe(true);
  expect(jobs.current(org)).toBe(started.id);
  const calls = upstream.mock.calls.length;
  expect(await jobs.start(org, actor, { ...input, resume_task_id: started.id })).toEqual(started);
  await expect(jobs.start(org, actor, input)).rejects.toMatchObject({ status: 409 });
  expect(upstream).toHaveBeenCalledTimes(calls);
  expect(receiverCalls()).toHaveLength(1);
  jobs.finished(started.id, org); // Only an observed terminal task permits new work.
  expect(jobs.current(org)).toBeNull();
});
