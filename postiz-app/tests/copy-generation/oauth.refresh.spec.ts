jest.mock('bcrypt', () => ({ hashSync: jest.fn(), compareSync: jest.fn() }));
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { TokenExchangeDto } from '../../libraries/nestjs-libraries/src/dtos/oauth/token-exchange.dto';
import { OAuthController } from '../../apps/backend/src/api/routes/oauth.controller';

const refresh = () => ({ grant_type: 'refresh_token', client_id: 'client', client_secret: 'secret', refresh_token: 'por_' + 'x'.repeat(43) });
describe('OAuth refresh endpoint validation', () => {
  it('accepts form-style refresh fields without code/redirect/PKCE or resource', async () => {
    expect(await validate(plainToInstance(TokenExchangeDto, refresh()))).toEqual([]);
  });
  it.each([{ refresh_token: undefined }, { refresh_token: [] }, { refresh_token: 'pos_access' },
    { client_secret: undefined }, { resource: null }, { scope: [] }, { resource: ['https://a', 'https://b'] }])('rejects malformed refresh fields %p', async (change) => {
    expect((await validate(plainToInstance(TokenExchangeDto, { ...refresh(), ...change }))).length).toBeGreaterThan(0);
  });
  it('still requires PKCE, redirect, code and resource for code redemption', async () => {
    const errors = await validate(plainToInstance(TokenExchangeDto, { ...refresh(), grant_type: 'authorization_code' }));
    expect(errors.map((e) => e.property)).toEqual(expect.arrayContaining(['code', 'code_verifier', 'resource', 'redirect_uri']));
  });
  it('routes refresh and rejects unsupported grants', async () => {
    const service: any = { refreshToken: jest.fn().mockResolvedValue({ access_token: 'test' }), exchangeCodeForToken: jest.fn() };
    const controller = new OAuthController(service);
    await expect(controller.token(refresh() as any)).resolves.toEqual({ access_token: 'test' });
    await expect(controller.token({ ...refresh(), grant_type: 'client_credentials' } as any)).rejects.toThrow();
    expect(service.exchangeCodeForToken).not.toHaveBeenCalled();
  });
});

describe('OAuth HTTP transport', () => {
  let app: any, url: string;
  const service = { refreshToken: jest.fn().mockResolvedValue({ access_token: 'pos_test', refresh_token: 'por_test', expires_in: 3600 }), revokeToken: jest.fn() };
  beforeAll(async () => {
    const { Test } = await import('@nestjs/testing');
    const { ValidationPipe } = await import('@nestjs/common');
    const { OAuthService } = await import('../../libraries/nestjs-libraries/src/database/prisma/oauth/oauth.service');
    const module = await Test.createTestingModule({ controllers: [OAuthController], providers: [{ provide: OAuthService, useValue: service }] }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true }));
    await app.listen(0, '127.0.0.1');
    url = await app.getUrl();
  });
  afterAll(async () => app?.close());
  it('accepts form-encoded refresh and returns non-cacheable tokens', async () => {
    const response = await fetch(`${url}/oauth/token`, { method: 'POST', body: new URLSearchParams(refresh()) });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('pragma')).toBe('no-cache');
    expect(await response.json()).toHaveProperty('refresh_token');
  });
  it('returns standard errors without leaking malformed credentials', async () => {
    const response = await fetch(`${url}/oauth/token`, { method: 'POST', body: new URLSearchParams({ ...refresh(), refresh_token: 'private-malformed-token' }) });
    expect(response.status).toBe(400);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ error: 'invalid_request' });
  });
  it('returns an empty successful revocation response', async () => {
    const response = await fetch(`${url}/oauth/revoke`, { method: 'POST', body: new URLSearchParams({ client_id: 'client', client_secret: 'secret', token: 'unknown', token_type_hint: 'refresh_token' }) });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('');
  });
});
