jest.mock('@gitroom/backend/services/auth/auth.service', () => ({ AuthService: class AuthService {} }));
jest.mock('@gitroom/nestjs-libraries/services/email.service', () => ({ EmailService: class EmailService {} }));
jest.mock('@sentry/nestjs', () => ({ metrics: { count: jest.fn() } }));
import { Controller, Post } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import { THROTTLER_TTL, THROTTLER_BLOCK_DURATION } from '@nestjs/throttler/dist/throttler.constants';
import { AuthController } from '@gitroom/backend/api/routes/auth.controller';
import { AuthService } from '@gitroom/backend/services/auth/auth.service';
import { EmailService } from '@gitroom/nestjs-libraries/services/email.service';
import { ThrottlerBehindProxyGuard } from '@gitroom/nestjs-libraries/throttler/throttler.provider';
import { authClientIp, authProxyTrust } from '@gitroom/nestjs-libraries/throttler/auth-client-ip';

const peers = '127.0.0.1/32,172.30.60.6/32';
const originalEnv = { ...process.env };
const request = (peer: string, forwarded: any, extra = {}) => ({ socket: { remoteAddress: peer },
  headers: { 'x-forwarded-for': forwarded, 'cf-connecting-ip': '1.2.3.4', ...extra }, ip: '9.9.9.9' } as any);

describe('authentication client identity trust boundary', () => {
  it('ignores spoofed forwarding and Cloudflare headers from direct untrusted clients', () => {
    expect(authClientIp(request('203.0.113.9', '1.1.1.1'), authProxyTrust(peers))).toBe('203.0.113.9');
  });
  it('walks right-to-left and stops before attacker-controlled prefixes', () => {
    expect(authClientIp(request('127.0.0.1', 'spoof.invalid, 198.51.100.9, 172.30.60.6'), authProxyTrust(peers)))
      .toBe('198.51.100.9');
  });
  it('does not trust an adjacent container outside the configured proxy addresses', () => {
    expect(authClientIp(request('172.30.60.7', '198.51.100.9'), authProxyTrust(peers))).toBe('172.30.60.7');
  });
  it.each([
    ['::ffff:192.0.2.1', '192.0.2.1'], ['::ffff:c000:201', '192.0.2.1'],
    ['2001:0DB8:0000::1', '2001:db8::1'],
  ])('canonicalizes %s into one bucket', (peer, expected) => {
    expect(authClientIp(request(peer, ''), authProxyTrust())).toBe(expected);
  });
  it('supports explicitly trusted IPv6 proxies', () => {
    expect(authClientIp(request('2001:db8::1', '2001:db8:1::2'), authProxyTrust('2001:db8::1/128')))
      .toBe('2001:db8:1::2');
  });
  it.each([undefined, [], '', 'not-an-ip', '1.2.3.4, ', 'x'.repeat(2049)])('rejects malformed trusted forwarding chains', (header) => {
    expect(() => authClientIp(request('127.0.0.1', header), authProxyTrust(peers))).toThrow();
  });
  it.each(['0.0.0.0/0', '::/0', 'true', '127.0.0.1/', '127.0.0.1/33', '127.0.0.1/1e1'])
    ('rejects unsafe/malformed proxy configuration %s', (value) => expect(() => authProxyTrust(value)).toThrow());
  it('requires proxy configuration for public deployments while preserving direct localhost development', () => {
    expect(() => authProxyTrust('', 'https://app.example.test')).toThrow('AUTH_TRUSTED_PROXY_CIDRS');
    expect(() => authProxyTrust('', 'http://localhost:4007')).not.toThrow();
  });
});

@Controller('/public/v1/posts')
class PostFixture { @Post() create() { return { created: true }; } }

describe('actual auth controller and guard over local HTTP (no providers/production data)', () => {
  let app: any, base: string, auth: any;
  beforeEach(async () => {
    process.env.FRONTEND_URL = 'https://app.example.test';
    process.env.AUTH_TRUSTED_PROXY_CIDRS = peers;
    delete process.env.NOT_SECURED;
    auth = { getOrgFromCookie: jest.fn(), routeAuth: jest.fn(async () => ({ jwt: 'fixture-jwt', addedOrg: false })),
      forgot: jest.fn(), forgotReturn: jest.fn(async () => true), activate: jest.fn(async () => false),
      resendActivationEmail: jest.fn(), checkExists: jest.fn(async () => ({ jwt: 'fixture-jwt' })),
      canRegister: jest.fn(async () => true), oauthLink: jest.fn(async () => ({ url: 'https://provider.invalid' })) };
    const module = await Test.createTestingModule({ controllers: [AuthController, PostFixture],
      imports: [ThrottlerModule.forRoot([{ ttl: 3600000, limit: 30 }])], providers: [
        { provide: AuthService, useValue: auth }, { provide: EmailService, useValue: { hasProvider: () => false } },
        { provide: APP_GUARD, useClass: ThrottlerBehindProxyGuard },
      ] }).compile();
    app = module.createNestApplication({ logger: false });
    app.use((req: any, _res: any, next: any) => { req.cookies = {}; req.org = { id: 'fixture-org' }; next(); });
    await app.listen(0, '127.0.0.1'); base = await app.getUrl();
  });
  afterEach(async () => { await app?.close(); process.env = { ...originalEnv }; });
  const post = (url: string, headers: Record<string, string> = {}) => fetch(base + url, { method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '198.51.100.10, 172.30.60.6', ...headers },
    body: JSON.stringify({ email: 'fixture@example.invalid', password: 'test-password', provider: 'LOCAL', code: 'fixture' }) });
  it('allows valid login and preserves secure cookies, then returns 429 and Retry-After on attempt 11', async () => {
    const first = await post('/auth/login'); expect(first.status).toBe(200);
    expect(first.headers.get('set-cookie')).toContain('HttpOnly');
    expect(first.headers.get('set-cookie')).toContain('Secure');
    expect(await first.json()).toEqual({ login: true });
    for (let i = 1; i < 10; i++) expect((await post('/auth/login')).status).toBe(200);
    const blocked = await post('/auth/login'); expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(auth.routeAuth).toHaveBeenCalledTimes(10);
  });
  it('counts failed login attempts before credential verification', async () => {
    auth.routeAuth.mockRejectedValue(new Error('Invalid user name or password'));
    for (let i = 0; i < 10; i++) expect((await post('/auth/login')).status).toBe(400);
    expect((await post('/auth/login')).status).toBe(429);
    expect(auth.routeAuth).toHaveBeenCalledTimes(10);
  });
  it('cannot rotate buckets with spoofed prefix/CF headers, and does not block another real tunnel client', async () => {
    for (let i = 0; i < 10; i++) {
      expect((await post('/auth/login', { 'x-forwarded-for': `${i}.invalid, 198.51.100.10, 172.30.60.6`,
        'cf-connecting-ip': `192.0.2.${i}` })).status).toBe(200);
    }
    expect((await post('/auth/login', { 'x-forwarded-for': 'spoof.invalid, 198.51.100.10, 172.30.60.6' })).status).toBe(429);
    expect((await post('/auth/login', { 'x-forwarded-for': '198.51.100.11, 172.30.60.6' })).status).toBe(200);
  });
  it.each(['register', 'forgot', 'forgot-return', 'activate', 'resend-activation'])
    ('limits %s to five attempts independently of login', async (route) => {
      for (let i = 0; i < 5; i++) expect((await post('/auth/' + route)).status).toBeLessThan(400);
      expect((await post('/auth/' + route)).status).toBe(429);
      expect((await post('/auth/login')).status).toBe(200);
    });
  it('does not bypass the limit with case, trailing slash or query strings', async () => {
    for (let i = 0; i < 10; i++) expect((await post('/AUTH/LOGIN/?next=/public/v1/posts')).status).toBe(200);
    expect((await post('/auth/login')).status).toBe(429);
  });
  it('leaves OAuth callbacks and provider links available after the login bucket is exhausted', async () => {
    for (let i = 0; i < 10; i++) await post('/auth/login');
    expect((await post('/auth/oauth/generic/exists')).status).toBe(200);
    expect((await fetch(base + '/auth/oauth/generic')).status).toBe(200);
    expect(auth.checkExists).toHaveBeenCalledTimes(1);
  });
  it('preserves the organization-scoped public-post quota', async () => {
    for (let i = 0; i < 30; i++) expect((await post('/public/v1/posts')).status).toBe(201);
    expect((await post('/public/v1/posts')).status).toBe(429);
    expect((await post('/auth/login')).status).toBe(200);
  });
  it('releases an exhausted bucket when its configured window expires', async () => {
    const fn = AuthController.prototype.login;
    const ttl = Reflect.getMetadata(THROTTLER_TTL + 'default', fn);
    const block = Reflect.getMetadata(THROTTLER_BLOCK_DURATION + 'default', fn);
    Reflect.defineMetadata(THROTTLER_TTL + 'default', 1000, fn);
    Reflect.defineMetadata(THROTTLER_BLOCK_DURATION + 'default', 1000, fn);
    try {
      for (let i = 0; i < 10; i++) await post('/auth/login');
      expect((await post('/auth/login')).status).toBe(429);
      await new Promise((resolve) => setTimeout(resolve, 1150));
      expect((await post('/auth/login')).status).toBe(200);
    } finally {
      Reflect.defineMetadata(THROTTLER_TTL + 'default', ttl, fn);
      Reflect.defineMetadata(THROTTLER_BLOCK_DURATION + 'default', block, fn);
    }
  });
});
