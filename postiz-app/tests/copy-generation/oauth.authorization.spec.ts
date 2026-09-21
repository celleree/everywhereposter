// Password hashing is outside this OAuth credential boundary. Keep AES/PKCE real.
jest.mock('bcrypt', () => ({ hashSync: jest.fn(), compareSync: jest.fn() }));
import { createHash } from 'crypto';
import { OAuthService, getMcpResource } from '@gitroom/nestjs-libraries/database/prisma/oauth/oauth.service';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { createOAuthMiddleware } from '@gitroom/nestjs-libraries/chat/oauth-middleware';
import { PublicAuthMiddleware } from '../../apps/backend/src/services/auth/public.auth.middleware';

jest.mock('@mastra/mcp', () => ({ MCPServer: jest.fn().mockImplementation(() => ({ startHTTP: jest.fn() })) }));
jest.mock('@gitroom/nestjs-libraries/chat/mastra.service', () => ({ MastraService: class MastraService {} }));
import { MCPServer } from '@mastra/mcp';
import { startMcp } from '@gitroom/nestjs-libraries/chat/start.mcp';

const verifier = 'a'.repeat(43);
const challenge = createHash('sha256').update(verifier).digest('base64url');
const request = () => ({
  client_id: 'client', response_type: 'code', redirect_uri: 'https://client.test/callback',
  resource: getMcpResource(), scope: 'accounts:read', code_challenge: challenge,
  code_challenge_method: 'S256',
});
const exchange = () => ({ ...request(), code: 'code', client_secret: 'secret',
  grant_type: 'authorization_code', code_verifier: verifier });
const grant = () => ({
  id: 'grant', oauthAppId: 'app', organizationId: 'org', revokedAt: null,
  scope: 'accounts:read', resource: getMcpResource(), redirectUri: request().redirect_uri,
  codeChallenge: challenge, codeExpiresAt: new Date(Date.now() + 60000),
  tokenExpiresAt: new Date(Date.now() + 60000), oauthApp: { deletedAt: null },
  user: { activated: true, organizations: [{ organizationId: 'org', disabled: false }] },
});

describe('OAuth accounts:read boundary', () => {
  let repository: any;
  let service: OAuthService;
  beforeEach(() => {
    process.env.JWT_SECRET = 'oauth-test-only-secret';
    process.env.NEXT_PUBLIC_BACKEND_URL = 'https://server.test/api';
    repository = {
      getAppByClientId: jest.fn().mockResolvedValue({ id: 'app', redirectUrl: request().redirect_uri,
        clientSecret: AuthService.fixedEncryption('secret') }),
      createAuthorization: jest.fn(), findByCode: jest.fn().mockResolvedValue(grant()),
      findByAccessToken: jest.fn().mockResolvedValue(grant()),
      exchangeCodeForToken: jest.fn().mockResolvedValue({ count: 1 }),
    };
    service = new OAuthService(repository);
  });
  const authenticate = (service: OAuthService) =>
    service.getOrgByOAuthToken('pos_token', getMcpResource(), 'accounts:read');

  it('accepts the bound active grant and preserves the external API prefix', async () => {
    expect(getMcpResource()).toBe('https://server.test/api/mcp-oauth');
    await expect(authenticate(service)).resolves.toMatchObject({ organizationId: 'org' });
  });
  it.each([
    ['missing scope', { scope: null }], ['wrong audience', { resource: 'https://other.test' }],
    ['legacy expiration', { tokenExpiresAt: null }], ['expired', { tokenExpiresAt: new Date(0) }],
    ['revoked', { revokedAt: new Date() }], ['deleted client', { oauthApp: { deletedAt: new Date() } }],
    ['removed membership', { user: { activated: true, organizations: [] } }],
    ['disabled membership', { user: { activated: true, organizations: [{ organizationId: 'org', disabled: true }] } }],
    ['other organization', { user: { activated: true, organizations: [{ organizationId: 'other', disabled: false }] } }],
    ['inactive user', { user: { activated: false, organizations: [] } }],
  ])('rejects %s', async (_, change) => {
    repository.findByAccessToken.mockResolvedValue({ ...grant(), ...change });
    await expect(authenticate(service)).resolves.toBeNull();
  });
  it('requires explicit supported resource and scope at the call site', async () => {
    await expect(service.getOrgByOAuthToken('pos_token', 'https://server.test/api/public/v1', 'accounts:read')).resolves.toBeNull();
    await expect(service.getOrgByOAuthToken('pos_token', getMcpResource(), 'posts:write')).resolves.toBeNull();
    expect(repository.findByAccessToken).not.toHaveBeenCalled();
  });
  it('validates authorization and persists the consent/PKCE binding', async () => {
    await service.validateAuthorizationRequest(request());
    await service.createAuthorizationCode('app', 'user', 'org', request());
    expect(repository.createAuthorization).toHaveBeenCalledWith(expect.objectContaining({
      scope: 'accounts:read', resource: getMcpResource(), redirectUri: request().redirect_uri, codeChallenge: challenge,
    }));
  });
  it.each([
    { scope: 'accounts:read posts:write' }, { resource: 'https://other.test' },
    { redirect_uri: 'https://attacker.test' }, { code_challenge_method: 'plain' },
    { code_challenge: '' }, { response_type: 'token' },
  ])('rejects unsafe consent parameters %p', async (change) => {
    await expect(service.validateAuthorizationRequest({ ...request(), ...change })).rejects.toThrow();
  });
  it('exchanges a correct S256 verifier for a bounded token', async () => {
    await expect(service.exchangeCodeForToken(exchange())).resolves.toMatchObject({
      access_token: expect.stringMatching(/^pos_[A-Za-z0-9_-]{43}$/), expires_in: 3600, scope: 'accounts:read',
    });
  });
  it.each([
    { code_verifier: 'b'.repeat(43) }, { code_verifier: 'short' },
    { code_verifier: ' '.repeat(43) }, { resource: 'https://other.test' },
    { redirect_uri: 'https://attacker.test' },
  ])('rejects invalid redemption %p without consuming the code', async (change) => {
    await expect(service.exchangeCodeForToken({ ...exchange(), ...change })).rejects.toThrow();
    expect(repository.exchangeCodeForToken).not.toHaveBeenCalled();
  });
  it('rejects a losing conditional redemption', async () => {
    repository.exchangeCodeForToken.mockResolvedValue({ count: 0 });
    await expect(service.exchangeCodeForToken(exchange())).rejects.toThrow();
  });
  it('challenges missing/invalid OAuth even when the resource has an /api prefix', async () => {
    const validateToken = jest.fn().mockResolvedValue({ valid: false });
    const middleware = createOAuthMiddleware({ oauth: { resource: getMcpResource(), validateToken },
      mcpPath: new URL(getMcpResource()).pathname });
    for (const headers of [{}, { authorization: 'Bearer invalid' }]) {
      const response = { writeHead: jest.fn(), end: jest.fn() };
      expect(await middleware({ headers, method: 'POST' } as any, response as any, new URL(getMcpResource())))
        .toMatchObject({ proceed: false });
      expect(response.writeHead).toHaveBeenCalledWith(401, expect.objectContaining({
        'WWW-Authenticate': expect.stringContaining('https://server.test/api/.well-known/oauth-protected-resource'),
      }));
    }
    expect(validateToken).toHaveBeenCalledTimes(1);
  });
  it('isolates the OAuth transport from broad MCP tools and API keys', async () => {
    const handlers = new Map<string, Function>();
    const agent = { listTools: jest.fn().mockResolvedValue({ publish: {} }) };
    const apiKeys = { getOrgByApiKey: jest.fn().mockResolvedValue({ id: 'api-org' }) };
    const oauth = { getOrgByOAuthToken: jest.fn().mockResolvedValue({ organization: { id: 'org' } }) };
    await startMcp({
      get: (provider: any) => provider.name === 'MastraService'
        ? { mastra: async () => ({ getAgent: () => agent }) }
        : provider.name === 'OAuthService' ? oauth : apiKeys,
      use: (path: string, handler: Function) => handlers.set(path, handler),
    } as any);
    const factory = MCPServer as jest.Mock;
    expect(factory.mock.calls[0][0]).toMatchObject({ tools: { publish: {} }, agents: { postiz: agent } });
    expect(factory.mock.calls[1][0]).toEqual({ name: 'EverywherePoster Accounts', version: '1.0.0', tools: {} });
    const response = { status: jest.fn().mockReturnThis(), send: jest.fn(), setHeader: jest.fn() };
    const req = { path: '/', headers: { authorization: 'Bearer pos_token' }, rawHeaders: [], method: 'POST' };
    await handlers.get('/mcp')!(req, response, jest.fn());
    expect(response.status).toHaveBeenCalledWith(401);
    expect(apiKeys.getOrgByApiKey).not.toHaveBeenCalled();
    await handlers.get('/mcp-oauth')!(req, response, jest.fn());
    expect(oauth.getOrgByOAuthToken).toHaveBeenCalledWith('pos_token', getMcpResource(), 'accounts:read');
    expect(factory.mock.results[1].value.startHTTP).toHaveBeenCalledTimes(1);
    expect(factory.mock.results[0].value.startHTTP).not.toHaveBeenCalled();
  });
  it('denies a read token on the public API while preserving API-key auth', async () => {
    const orgs = { getOrgByApiKey: jest.fn().mockResolvedValue({ id: 'org' }) };
    const middleware = new PublicAuthMiddleware(orgs as any);
    const response = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();
    await middleware.use({ headers: { authorization: 'pos_token' } } as any, response as any, next);
    expect(next).not.toHaveBeenCalled();
    expect(orgs.getOrgByApiKey).not.toHaveBeenCalled();
    await middleware.use({ headers: { authorization: 'api-key' } } as any, response as any, next);
    expect(next).toHaveBeenCalledTimes(1);
  });
});
