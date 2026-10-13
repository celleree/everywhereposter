import { CreatorAuditController } from '../../apps/backend/src/api/routes/creator-audit.controller';
import { auditAssertion, auditRouteAllowed, creatorAuditConfig } from '../../apps/backend/src/api/routes/creator-audit.proxy';
import { AuthMiddleware } from '../../apps/backend/src/services/auth/auth.middleware';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { verify } from 'jsonwebtoken';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { CHECK_POLICIES_KEY } from '../../apps/backend/src/services/auth/permissions/permissions.ability';
import { AuthorizationActions, Sections } from '../../apps/backend/src/services/auth/permissions/permission.exception.class';

jest.mock('@gitroom/nestjs-libraries/database/prisma/organizations/organization.service', () => ({ OrganizationService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/users/users.service', () => ({ UsersService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/integrations/integration.service', () => ({ IntegrationService: class {} }));

const org = '00000000-0000-4000-8000-000000000011';
const foreign = '00000000-0000-4000-8000-000000000012';
const actor = '00000000-0000-4000-8000-000000000021';
const secret = 'fixture-only-dedicated-secret-'.repeat(3);
const controller = new CreatorAuditController();
const env = { ...process.env };
let upstream: jest.Mock;

function request(method = 'GET', path = '/api/me', body?: any) {
  return { method, path: '/creator-audit' + path, url: '/creator-audit' + path, body,
    headers: { 'x-audit-organization': org, origin: 'https://app.example.test' }, cookies: {},
    org: { id: org, users: [{ userId: actor, role: 'ADMIN' }] }, user: { id: actor } } as any;
}
function response() {
  const res: any = { setHeader: jest.fn(), status: jest.fn(), send: jest.fn() };
  res.status.mockReturnValue(res); return res;
}
async function rejected(req: any, status: number) {
  await expect(controller.proxy(req, response())).rejects.toMatchObject({ status });
  expect(upstream).not.toHaveBeenCalled();
}

beforeEach(() => {
  process.env = { ...env, CREATOR_AUDIT_ENABLED: 'true', CREATOR_AUDIT_SERVICE_SECRET: secret,
    CREATOR_AUDIT_SERVICE_URL: 'http://service.example.test', FRONTEND_URL: 'https://app.example.test', JWT_SECRET: 'fixture-browser-secret'.repeat(3) };
  upstream = jest.fn(async () => new Response('{"connected":false}', { headers: { 'Content-Type': 'application/json', 'Set-Cookie': 'SECRET', Location: 'https://evil.test' } }));
  global.fetch = upstream;
});
afterAll(() => { process.env = env; });

it('is disabled unless configured with a dedicated service secret and exact origin', () => {
  expect(controller.status()).toEqual({ enabled: true });
  expect(Reflect.getMetadata(CHECK_POLICIES_KEY, controller.status)).toBeUndefined();
  expect(upstream).not.toHaveBeenCalled();
  for (const overrides of [{ CREATOR_AUDIT_ENABLED: 'false' }, { CREATOR_AUDIT_SERVICE_SECRET: 'short' },
    { CREATOR_AUDIT_SERVICE_SECRET: process.env.JWT_SECRET }, { CREATOR_AUDIT_SERVICE_URL: 'http://service.test/path' },
    { CREATOR_AUDIT_SERVICE_URL: 'http://username:password@service.test' }, { CREATOR_AUDIT_SERVICE_URL: 'file:///tmp/service' }]) {
    const current = process.env; process.env = { ...current, ...overrides };
    expect(creatorAuditConfig()).toBeNull(); process.env = current;
  }
});

it.each(['/api/settings', '/api/instagram-session', '/videos/private.mp4', '/api/me/connect', '/static/other.js',
  '/api/me/../settings', '/api/me%2fsettings', '//evil.test', '/api/audit/tasks/invalid'])('cannot proxy %s', async (path) => {
  expect(auditRouteAllowed('GET', path)).toBe(false);
  await rejected(request('GET', path), 404);
});

it('rejects queries, stale org pins, missing middleware identity and guest writes', async () => {
  const query = request(); query.url += '?user_id=' + foreign; await rejected(query, 404);
  const stale = request(); stale.headers['x-audit-organization'] = foreign; await rejected(stale, 409);
  const missing = request(); delete missing.user; await rejected(missing, 403);
  const guest = request('POST', '/api/audit/tasks', { kind: 'report' }); guest.org.users[0].role = 'USER'; await rejected(guest, 403);
  const disabled = request(); disabled.org.users[0].disabled = true; await rejected(disabled, 403);
});

it.each([undefined, 'https://evil.test', 'null'])('rejects unsafe mutation Origin %s', async (origin) => {
  const req = request('POST', '/api/audit/tasks', { kind: 'report' }); req.headers.origin = origin;
  await rejected(req, 403);
});

it('sends only dedicated signed identity/body and strips all upstream cookies and redirects', async () => {
  const req = request('POST', '/api/audit/tasks', { kind: 'scan', user_id: foreign, org: foreign });
  req.headers.authorization = 'Bearer browser-SECRET'; req.headers.cookie = 'SECRET';
  const res = response(); await controller.proxy(req, res);
  const [url, options] = upstream.mock.calls[0];
  expect(url).toBe('http://service.example.test/api/audit/tasks');
  expect(options.redirect).toBe('manual');
  expect(Object.keys(options.headers).sort()).toEqual(['Authorization', 'Content-Type']);
  const claims: any = verify(options.headers.Authorization.slice(7), secret, { algorithms: ['HS256'], issuer: 'everywhereposter', audience: 'creator-audit' });
  expect(claims).toMatchObject({ org, sub: actor, method: 'POST', path: '/api/audit/tasks', writable: true });
  expect(claims.exp - claims.iat).toBe(30);
  expect(claims.body_sha256).toBe(createHash('sha256').update(options.body).digest('hex'));
  expect(res.setHeader.mock.calls.some(([name]: string[]) => ['set-cookie', 'location'].includes(name.toLowerCase()))).toBe(false);
  expect(res.send).toHaveBeenCalledWith('{"connected":false}');
});

it.each([302, 401, 403, 500])('hides upstream errors/redirects at %s', async (status) => {
  upstream.mockResolvedValue(new Response('SECRET provider detail', { status, headers: { 'Content-Type': 'text/plain', Location: 'http://evil.test' } }));
  await expect(controller.proxy(request(), response())).rejects.toMatchObject({ status: 502 });
});

it('does not issue assertions for malformed identities', () => {
  expect(() => auditAssertion(secret, 'caller-org', actor, 'GET', '/api/me', '', false)).toThrow();
});

it('retains existing AI policy gates for reads and existing AI/admin gates for writes', () => {
  expect(Reflect.getMetadata(CHECK_POLICIES_KEY, controller.read)).toEqual([[AuthorizationActions.Read, Sections.AI]]);
  expect(Reflect.getMetadata(CHECK_POLICIES_KEY, controller.write)).toEqual([[AuthorizationActions.Create, Sections.AI], [AuthorizationActions.Create, Sections.ADMIN]]);
  const module = readFileSync(join(__dirname, '../../apps/backend/src/api/api.module.ts'), 'utf8');
  expect(module).toContain('const authenticatedController = [\n  CreatorAuditController,');
  expect(module).toContain('consumer.apply(AuthMiddleware).forRoutes(...authenticatedController)');
});

it('actual AuthMiddleware rejects missing/invalid authentication and disabled membership before proxy', async () => {
  const memberships = { getOrgsByUserId: jest.fn(async () => [{ id: org, apiKey: 'fixture', users: [{ userId: actor, role: 'ADMIN', disabled: true }] }]) };
  const middleware = new AuthMiddleware(memberships as any, {} as any);
  for (const auth of [undefined, 'invalid', AuthService.signJWT({ id: actor, activated: true })]) {
    const req = request(); delete req.user; delete req.org; req.headers.auth = auth;
    const next = jest.fn();
    await expect(middleware.use(req, response(), next)).rejects.toBeDefined();
    expect(next).not.toHaveBeenCalled();
  }
  expect(upstream).not.toHaveBeenCalled();
});

it('actual AuthMiddleware derives allowed membership even when caller requests foreign org', async () => {
  const memberships = { getOrgsByUserId: jest.fn(async () => [{ id: org, apiKey: 'fixture', users: [{ userId: actor, role: 'ADMIN', disabled: false }] }]) };
  const middleware = new AuthMiddleware(memberships as any, {} as any);
  const req = request(); delete req.user; delete req.org;
  req.headers.auth = AuthService.signJWT({ id: actor, activated: true }); req.headers.showorg = foreign;
  req.headers['x-audit-organization'] = foreign;
  const next = jest.fn(); await middleware.use(req, response(), next);
  expect(next).toHaveBeenCalled(); expect(req.org.id).toBe(org); expect(req.user.id).toBe(actor);
  await rejected(req, 409);
  req.headers['x-audit-organization'] = org;
  await controller.proxy(req, response()); expect(upstream).toHaveBeenCalledTimes(1);
});

it('keeps the private snapshot route outside the browser proxy allowlist', async () => {
  expect(auditRouteAllowed('POST', '/api/audit/connected')).toBe(false);
  await rejected(request('POST', '/api/audit/connected', { snapshot: {} }), 404);
});

it('connected start enforces admin, organization and origin before connection lookup', async () => {
  const lookup = jest.fn();
  const connected = new CreatorAuditController({ getIntegrationById: lookup } as any);
  for (const change of ['guest', 'disabled', 'foreign', 'cross-site', 'missing', 'large']) {
    const req = request('POST', '/connected', { integration_id: 'fixture' });
    let status = 403;
    if (change === 'guest') req.org.users[0].role = 'USER';
    if (change === 'disabled') req.org.users[0].disabled = true;
    if (change === 'foreign') { req.headers['x-audit-organization'] = foreign; status = 409; }
    if (change === 'cross-site') req.headers['sec-fetch-site'] = 'cross-site';
    if (change === 'missing') delete req.user;
    if (change === 'large') { req.body.padding = 'a'.repeat(1025); status = 413; }
    await expect(connected.connected(req, response())).rejects.toMatchObject({ status });
  }
  expect(lookup).not.toHaveBeenCalled();
  expect(upstream).not.toHaveBeenCalled();
  expect(Reflect.getMetadata(CHECK_POLICIES_KEY, connected.connected)).toEqual(
    [[AuthorizationActions.Create, Sections.AI], [AuthorizationActions.Create, Sections.ADMIN]]);
});

it('connected start resolves only the server-derived organization connection', async () => {
  const lookup = jest.fn(async () => null);
  const connected = new CreatorAuditController({ getIntegrationById: lookup } as any);
  await expect(connected.connected(request('POST', '/connected', { integration_id: 'fixture' }), response())).rejects.toMatchObject({ status: 400 });
  expect(lookup).toHaveBeenCalledWith(org, 'fixture');
  expect(upstream).not.toHaveBeenCalled();
});
