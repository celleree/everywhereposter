import { INestApplication, MiddlewareConsumer, Module } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { createServer, Server } from 'http';
import { AddressInfo, Socket } from 'net';
import { createHash } from 'crypto';
import { verify } from 'jsonwebtoken';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { OrganizationRepository } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.repository';
import { OrganizationService } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';
import { UsersService } from '@gitroom/nestjs-libraries/database/prisma/users/users.service';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { HttpExceptionFilter } from '@gitroom/nestjs-libraries/services/exception.filter';
import { AuthMiddleware } from '../../apps/backend/src/services/auth/auth.middleware';
import { PoliciesGuard } from '../../apps/backend/src/services/auth/permissions/permissions.guard';
import { PermissionsService } from '../../apps/backend/src/services/auth/permissions/permissions.service';
import { SubscriptionExceptionFilter } from '../../apps/backend/src/services/auth/permissions/subscription.exception';
import { CreatorAuditController } from '../../apps/backend/src/api/routes/creator-audit.controller';

jest.mock('@gitroom/nestjs-libraries/database/prisma/prisma.service', () => ({ PrismaRepository: class {}, PrismaTransaction: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/organizations/organization.service', () => ({ OrganizationService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/users/users.service', () => ({ UsersService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/integrations/integration.service', () => ({ IntegrationService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service', () => ({ SubscriptionService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/posts/posts.service', () => ({ PostsService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/webhooks/webhooks.service', () => ({ WebhooksService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/ai-wallet/ai-wallet.service', () => ({ AiWalletService: class {} }));

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const orgA = uuid(1), orgB = uuid(2), launchOrg = uuid(3);
const members = [
  { userId: uuid(11), org: orgA, role: 'ADMIN', disabled: false },
  { userId: uuid(12), org: orgA, role: 'USER', disabled: false },
  { userId: uuid(13), org: orgB, role: 'ADMIN', disabled: false },
  { userId: uuid(14), org: orgA, role: 'ADMIN', disabled: true },
  { userId: uuid(15), org: launchOrg, role: 'ADMIN', disabled: false },
];
// Seeded receiver responses prove repeated reads and tenant selection, not
// persistence or rendering in the separate Python/PGlite Creator Audit service.
const reports = new Map([[orgA, 'Saved fixture report A'], [orgB, 'Saved fixture report B']]);
const secret = 'synthetic-private-receiver-secret-'.repeat(3);
const originalEnv = process.env;
const nativeFetch = global.fetch;
const nativeConnect = Socket.prototype.connect;
const ownedPorts = new Set<number>();
const receiverCalls: any[] = [], receiverErrors: string[] = [], blockedConnections: string[] = [];
const lookup = jest.fn(() => { throw new Error('Provider lookup is forbidden in read-only HTTP fixtures'); });
let app: INestApplication, receiver: Server, origin: string;
let fetchGuard: jest.SpyInstance, socketGuard: jest.SpyInstance;

beforeAll(async () => {
  process.env = { ...originalEnv, JWT_SECRET: 'synthetic-browser-session-secret-'.repeat(3),
    CREATOR_AUDIT_ENABLED: 'true', CREATOR_AUDIT_SERVICE_SECRET: secret, NOT_SECURED: 'true' };
  socketGuard = jest.spyOn(Socket.prototype, 'connect').mockImplementation(function (...args: any[]) {
    const options = Array.isArray(args[0]) ? args[0][0] : args[0];
    const host = typeof options === 'object' ? options.host : args[1];
    const port = Number(typeof options === 'object' ? options.port : options);
    if (host !== '127.0.0.1' || !ownedPorts.has(port) || options?.path) {
      blockedConnections.push(`${host}:${port}`); throw new Error('HTTP fixture blocked an unowned destination');
    }
    return nativeConnect.apply(this, args as any);
  });
  receiver = createServer(async (req, res) => {
    try {
      let body = ''; for await (const chunk of req) body += chunk;
      const claims: any = verify((req.headers.authorization || '').replace(/^Bearer /, ''), secret,
        { algorithms: ['HS256'], issuer: 'everywhereposter', audience: 'creator-audit' });
      const member = members.find(entry => entry.userId === claims.sub && entry.org === claims.org && !entry.disabled);
      if (!member || claims.method !== req.method || claims.path !== req.url || claims.exp - claims.iat !== 30 ||
        claims.body_sha256 !== createHash('sha256').update(body).digest('hex') ||
        claims.writable !== (member.role === 'ADMIN') || req.headers.cookie || req.headers.auth) throw new Error('Invalid synthetic receiver assertion');
      receiverCalls.push(claims);
      const report = reports.get(claims.org);
      if (!report || !['/audit', '/api/me'].includes(req.url!)) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': req.url === '/audit' ? 'text/html' : 'application/json' });
      res.end(req.url === '/audit' ? `<html><body>${report}</body></html>` : JSON.stringify({ organization: claims.org, report }));
    } catch (error) {
      receiverErrors.push(String(error)); res.writeHead(401); res.end();
    }
  });
  await new Promise<void>(resolve => receiver.listen(0, '127.0.0.1', resolve));
  const receiverPort = (receiver.address() as AddressInfo).port;
  ownedPorts.add(receiverPort);
  process.env.CREATOR_AUDIT_SERVICE_URL = `http://127.0.0.1:${receiverPort}`;
  const findMany = async (query: any) => [orgA, orgB, launchOrg]
    .filter(id => members.some(member => member.org === id && member.userId === query.where.users.some.userId))
    .map(id => ({ id, apiKey: 'synthetic-key', createdAt: new Date('2026-01-01'),
      users: members.filter(member => member.org === id && member.userId === query.include.users.where.userId)
        .map(member => Object.fromEntries(Object.entries(query.include.users.select).filter(([, selected]) => selected)
          .map(([key]) => [key, member[key as keyof typeof member]]))),
    }));
  const repository = new OrganizationRepository({ model: { organization: { findMany } } } as any, {} as any, {} as any, {} as any);
  class FixtureModule {
    configure(consumer: MiddlewareConsumer) { consumer.apply(AuthMiddleware).forRoutes(CreatorAuditController); }
  }
  Module({ controllers: [CreatorAuditController], providers: [AuthMiddleware,
    { provide: OrganizationService, useValue: { getOrgsByUserId: (id: string) => repository.getOrgsByUserId(id) } },
    { provide: UsersService, useValue: {} }, { provide: IntegrationService, useValue: { getIntegrationById: lookup } },
  ] })(FixtureModule);
  const module = await Test.createTestingModule({ imports: [FixtureModule] }).compile();
  app = module.createNestApplication({ logger: false });
  app.use(cookieParser());
  app.useGlobalFilters(new SubscriptionExceptionFilter(), new HttpExceptionFilter());
  const permissions = new PermissionsService({ getSubscriptionByOrganizationId: async (id: string) =>
    ({ subscriptionTier: id === launchOrg ? 'LAUNCH_V1' : 'STANDARD' }) } as any, {} as any, {} as any, {} as any);
  app.useGlobalGuards(new PoliciesGuard(new Reflector(), permissions));
  await app.listen(0, '127.0.0.1'); origin = await app.getUrl();
  ownedPorts.add(Number(new URL(origin).port)); process.env.FRONTEND_URL = origin;
  fetchGuard = jest.spyOn(global, 'fetch').mockImplementation((input, init) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !ownedPorts.has(Number(url.port))) {
      blockedConnections.push(url.origin); throw new Error('HTTP fixture blocked an unowned fetch');
    }
    return nativeFetch(input, init);
  });
});
beforeEach(() => {
  process.env.BILLING_ENABLED = 'true'; receiverCalls.length = 0; receiverErrors.length = 0;
  blockedConnections.length = 0; lookup.mockClear();
});
afterEach(() => {
  expect(receiverErrors).toEqual([]); expect(blockedConnections).toEqual([]); expect(lookup).not.toHaveBeenCalled();
});
afterAll(async () => {
  fetchGuard?.mockRestore(); socketGuard?.mockRestore();
  await app?.close();
  if (receiver?.listening) await new Promise<void>(resolve => receiver.close(() => resolve()));
  process.env = originalEnv;
});

function credentials(userId: string, transport = 'cookie') {
  const token = AuthService.signJWT({ id: userId, activated: true });
  return transport === 'cookie' ? { cookie: `auth=${token}` } : { auth: token };
}
const request = (path: string, headers: Record<string, string> = {}, init: RequestInit = {}) =>
  fetch(origin + '/creator-audit' + path, { ...init, headers, redirect: 'manual' });

it.each(['cookie', 'header'])('opens and rereads tenant-specific reports with real JWT %s sessions', async transport => {
  for (const member of members.slice(0, 3)) {
    for (let reload = 0; reload < 2; reload++) {
      const headers = { ...credentials(member.userId, transport), 'x-audit-organization': member.org };
      const document = await request('/audit', headers);
      expect(document.status).toBe(200); expect(document.headers.get('cache-control')).toBe('no-store');
      expect(await document.text()).toBe(`<html><body>${reports.get(member.org)}</body></html>`);
      const api = await request('/api/me', headers);
      expect(api.status).toBe(200); expect(await api.json()).toEqual({ organization: member.org, report: reports.get(member.org) });
      expect(receiverCalls.slice(-2)).toEqual([
        expect.objectContaining({ sub: member.userId, org: member.org, path: '/audit', writable: member.role === 'ADMIN' }),
        expect.objectContaining({ sub: member.userId, org: member.org, path: '/api/me', writable: member.role === 'ADMIN' }),
      ]);
    }
  }
  expect(receiverCalls).toHaveLength(12);
});

it('selects the authenticated document organization and denies a stale API pin before forwarding', async () => {
  const headers = { ...credentials(members[0].userId), showorg: orgB, 'x-audit-organization': orgB };
  const document = await request('/audit', headers);
  expect(document.status).toBe(200); expect(await document.text()).toContain(reports.get(orgA));
  expect(receiverCalls).toHaveLength(1); expect(receiverCalls[0].org).toBe(orgA);
  receiverCalls.length = 0;
  expect((await request('/api/me', headers)).status).toBe(409);
  expect(receiverCalls).toHaveLength(0);
});

it.each(['missing', 'invalid', 'foreign', 'disabled'])('denies %s authentication through the real HTTP filter', async state => {
  const headers = state === 'missing' ? {} : state === 'invalid' ? { cookie: 'auth=invalid-session' } :
    credentials(state === 'disabled' ? members[3].userId : uuid(99));
  const response = await request('/audit', headers);
  expect(response.status).toBe(401); expect(response.headers.get('logout')).toBe('true');
  expect(receiverCalls).toHaveLength(0);
});

it.each([['true', 402], ['false', 403]])('denies USER writes with billing=%s before receiver or provider work', async (billing, status) => {
  process.env.BILLING_ENABLED = String(billing);
  for (const path of ['/api/audit/tasks', '/connected']) {
    const response = await request(path, { ...credentials(members[1].userId), origin,
      'x-audit-organization': orgA, 'content-type': 'application/json' },
    { method: 'POST', body: JSON.stringify(path === '/connected' ? { integration_id: 'synthetic-connection' } : { kind: 'report' }) });
    expect(response.status).toBe(status);
  }
  expect(receiverCalls).toHaveLength(0);
});

it.each(['true', 'false'])('preserves Launch AI denial and configuration-only status with billing=%s', async billing => {
  process.env.BILLING_ENABLED = billing;
  const headers = { ...credentials(members[4].userId), 'x-audit-organization': launchOrg };
  for (const path of ['/audit', '/api/me']) expect((await request(path, headers)).status).toBe(402);
  const status = await request('/status', headers);
  expect(status.status).toBe(200); expect(await status.json()).toEqual({ enabled: true });
  expect(receiverCalls).toHaveLength(0);
});
