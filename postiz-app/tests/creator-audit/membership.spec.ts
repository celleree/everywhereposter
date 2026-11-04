import { OrganizationRepository } from '../../libraries/nestjs-libraries/src/database/prisma/organizations/organization.repository';
import { AuthMiddleware } from '../../apps/backend/src/services/auth/auth.middleware';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { CreatorAuditController } from '../../apps/backend/src/api/routes/creator-audit.controller';
import { verify } from 'jsonwebtoken';
import { createHash } from 'crypto';

jest.mock('@gitroom/nestjs-libraries/database/prisma/prisma.service', () => ({ PrismaRepository: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/organizations/organization.service', () => ({ OrganizationService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/users/users.service', () => ({ UsersService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/integrations/integration.service', () => ({ IntegrationService: class {} }));

const actor = '00000000-0000-4000-8000-000000000021';
const org = '00000000-0000-4000-8000-000000000011';
const foreign = '00000000-0000-4000-8000-000000000012';
const secret = 'fixture-dedicated-audit-secret-'.repeat(3);
const previous = process.env;
type Member = { userId: string; disabled: boolean; role: 'ADMIN' | 'USER' };
let upstream: jest.SpyInstance;

beforeEach(() => {
  process.env = { ...previous, CREATOR_AUDIT_ENABLED: 'true', CREATOR_AUDIT_SERVICE_SECRET: secret,
    CREATOR_AUDIT_SERVICE_URL: 'http://audit.example.test', FRONTEND_URL: 'https://app.example.test',
    JWT_SECRET: 'fixture-browser-secret-'.repeat(3) };
  upstream = jest.spyOn(global, 'fetch').mockImplementation(async () =>
    new Response('<html>Saved report fixture</html>', { headers: { 'Content-Type': 'text/html' } }));
});
afterEach(() => { upstream.mockRestore(); process.env = previous; });

function response() {
  const res: any = { setHeader: jest.fn(), status: jest.fn(), send: jest.fn() };
  res.status.mockReturnValue(res); return res;
}

function session(member: Member) {
  // Apply the real repository query's filters and projection at the Prisma boundary.
  const findMany = jest.fn(async (query: any) => member.userId === query.where.users.some.userId ? [{
    id: org, apiKey: 'fixture-key', users: [member].filter(entry => entry.userId === query.include.users.where.userId)
      .map(entry => Object.fromEntries(Object.entries(query.include.users.select).filter(([, selected]) => selected)
        .map(([key]) => [key, entry[key as keyof Member]]))),
  }] : []);
  const repository = new OrganizationRepository({ model: { organization: { findMany } } } as any, {} as any, {} as any, {} as any);
  const middleware = new AuthMiddleware({ getOrgsByUserId: (id: string) => repository.getOrgsByUserId(id) } as any, {} as any);
  const req: any = { method: 'GET', path: '/creator-audit/audit', url: '/creator-audit/audit', cookies: {},
    headers: { auth: AuthService.signJWT({ id: actor, activated: true }), origin: 'https://app.example.test' } };
  const next = jest.fn();
  return { req, next, findMany, authenticate: () => middleware.use(req, response(), next) };
}

it.each(['ADMIN', 'USER'] as const)('loads an audit document through real membership projection and signed proxy for %s', async role => {
  const member: Member = { userId: actor, disabled: false, role };
  const { req, next, findMany, authenticate } = session(member);
  await authenticate();
  expect(next).toHaveBeenCalledTimes(1);
  const res = response();
  await new CreatorAuditController().read(req, res);
  expect(findMany).toHaveBeenCalledTimes(1);
  expect(findMany.mock.calls[0][0].where.users.some.userId).toBe(actor);
  expect(findMany.mock.calls[0][0].include.users.where.userId).toBe(actor);
  expect(req.org.users).toEqual([member]);
  expect(upstream).toHaveBeenCalledTimes(1);
  const [url, options] = upstream.mock.calls[0];
  expect(url).toBe('http://audit.example.test/audit');
  expect(options.method).toBe('GET');
  expect(Object.keys(options.headers)).toEqual(['Authorization']);
  const claims: any = verify(options.headers.Authorization.slice(7), secret,
    { algorithms: ['HS256'], issuer: 'everywhereposter', audience: 'creator-audit' });
  expect(claims).toMatchObject({ org, sub: actor, method: 'GET', path: '/audit', writable: role === 'ADMIN',
    body_sha256: createHash('sha256').update('').digest('hex') });
  expect(claims.exp - claims.iat).toBe(30);
  expect(res.status).toHaveBeenCalledWith(200);
  expect(res.send).toHaveBeenCalledWith('<html>Saved report fixture</html>');
});

it('preserves read-only membership when the projected user attempts audit work', async () => {
  const { req, authenticate } = session({ userId: actor, disabled: false, role: 'USER' });
  await authenticate();
  req.method = 'POST'; req.path = req.url = '/creator-audit/api/audit/tasks';
  req.headers['x-audit-organization'] = org; req.body = { kind: 'report' };
  await expect(new CreatorAuditController().write(req, response())).rejects.toMatchObject({ status: 403 });
  expect(upstream).not.toHaveBeenCalled();
});

it.each(['foreign', 'disabled'])('rejects a %s membership in the real repository/middleware path', async state => {
  const { next, authenticate } = session({ userId: state === 'foreign' ? foreign : actor,
    role: 'ADMIN', disabled: state === 'disabled' });
  await expect(authenticate()).rejects.toMatchObject({ status: 403 });
  expect(next).not.toHaveBeenCalled();
  expect(upstream).not.toHaveBeenCalled();
});

it('rejects a foreign workspace pin after middleware resolves the actual projected membership', async () => {
  const { req, authenticate } = session({ userId: actor, disabled: false, role: 'ADMIN' });
  req.headers.showorg = req.headers['x-audit-organization'] = foreign;
  req.path = req.url = '/creator-audit/api/me';
  await authenticate();
  expect(req.org.id).toBe(org);
  await expect(new CreatorAuditController().read(req, response())).rejects.toMatchObject({ status: 409 });
  expect(upstream).not.toHaveBeenCalled();
});

it.each(['foreign', 'disabled'])('continues rejecting an audit for a %s membership', async state => {
  const req: any = { method: 'GET', path: '/creator-audit/audit', url: '/creator-audit/audit', headers: {},
    org: { id: org, users: [{ userId: state === 'foreign' ? foreign : actor,
      role: 'ADMIN', disabled: state === 'disabled' }] }, user: { id: actor } };
  await expect(new CreatorAuditController().proxy(req, response())).rejects.toMatchObject({ status: 403 });
  expect(upstream).not.toHaveBeenCalled();
});
