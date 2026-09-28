jest.mock('bcrypt', () => ({ hashSync: jest.fn(), compareSync: jest.fn() }));
jest.mock('@mastra/mcp', () => ({ MCPServer: jest.fn().mockImplementation(() => ({ startHTTP: jest.fn() })) }));
jest.mock('@gitroom/nestjs-libraries/chat/mastra.service', () => ({ MastraService: class MastraService {} }));
import express from 'express';
import { Module, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AddressInfo } from 'net';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createHash } from 'crypto';
import { startMcp } from '@gitroom/nestjs-libraries/chat/start.mcp';
import { OAuthService, getOAuthIssuer } from '@gitroom/nestjs-libraries/database/prisma/oauth/oauth.service';
import { OAuthAuthorizedController, OAuthController } from '../../apps/backend/src/api/routes/oauth.controller';

const origin = 'https://server.test';
const issuer = `${origin}/api`;
const resource = `${issuer}/mcp-oauth`;
const metadataPath = '/.well-known/oauth-protected-resource/api/mcp-oauth';
const issuerPath = '/.well-known/oauth-authorization-server/api';

describe('public OAuth discovery and issuer callbacks', () => {
  let server: ReturnType<ReturnType<typeof express>['listen']>;
  let base: string;
  let validateToken: jest.Mock;
  beforeAll(async () => {
    process.env.NEXT_PUBLIC_BACKEND_URL = `${issuer}/`;
    process.env.FRONTEND_URL = origin;
    // Internal/browser proxy overrides must not leak into public metadata.
    process.env.NEXT_PUBLIC_OVERRIDE_BACKEND_URL = 'http://internal.test';
    const app = express();
    validateToken = jest.fn().mockResolvedValue(null);
    await startMcp({
      get: (provider: any) => provider.name === 'MastraService'
        ? { mastra: async () => ({ getAgent: () => ({ listTools: async () => ({ publish: {} }) }) }) }
        : { getOrgByOAuthToken: validateToken },
      use: app.use.bind(app),
    } as any);
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>((done) => server.once('listening', done));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise<void>((done) => server.close(() => done()));
    delete process.env.NEXT_PUBLIC_OVERRIDE_BACKEND_URL;
  });

  it.each([metadataPath, '/.well-known/oauth-protected-resource'])(
    'serves restricted protected-resource metadata without login at %s', async (path) => {
      const response = await fetch(base + path);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        resource, authorization_servers: [issuer], scopes_supported: ['accounts:read', 'posts:write'],
        bearer_methods_supported: ['header'],
      });
    }
  );
  it.each([issuerPath, '/.well-known/oauth-authorization-server'])(
    'serves consistent authorization-server metadata at %s', async (path) => {
      const response = await fetch(base + path);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        issuer, authorization_response_iss_parameter_supported: true,
        authorization_endpoint: `${origin}/oauth/authorize`, token_endpoint: `${issuer}/oauth/token`,
        response_types_supported: ['code'], grant_types_supported: ['authorization_code'],
        code_challenge_methods_supported: ['S256'], scopes_supported: ['accounts:read', 'posts:write'],
        token_endpoint_auth_methods_supported: ['client_secret_post'],
      });
    }
  );
  it.each([undefined, 'Bearer invalid'])('challenges %s with discoverable metadata and restricted scope', async (authorization) => {
    const response = await fetch(`${base}/mcp-oauth`, {
      method: 'POST', headers: authorization ? { authorization } : {},
    });
    expect(response.status).toBe(401);
    const challenge = response.headers.get('www-authenticate');
    expect(challenge).toContain(`resource_metadata="${origin}${metadataPath}"`);
    expect(challenge).toContain('scope="accounts:read posts:write"');
    expect(await (await fetch(base + metadataPath)).json()).toHaveProperty('resource', resource);
  });
  it.each([metadataPath, issuerPath])('supports unauthenticated metadata preflight at %s', async (path) => {
    expect((await fetch(base + path, { method: 'OPTIONS' })).status).toBe(204);
  });
  it.each(['nginx/privacy-site.conf', 'nginx/postiz-frontend-standalone.conf'])(
    'routes path-based public discovery to the backend in %s', (file) => {
      const config = readFileSync(resolve(__dirname, '../../..', file), 'utf8');
      for (const path of [metadataPath, issuerPath]) {
        expect(config).toContain(`location = ${path} {\n    proxy_pass http://postiz:3000${path};`);
      }
    }
  );
  it('accepts form-encoded token requests and returns HTTP 200 without caching', async () => {
    const token = { access_token: 'synthetic-token', token_type: 'bearer', scope: 'accounts:read' };
    const exchangeCodeForToken = jest.fn().mockResolvedValue(token);
    @Module({ controllers: [OAuthController], providers: [
      { provide: OAuthService, useValue: { exchangeCodeForToken } },
    ] })
    class TokenTestModule {}
    const app = await NestFactory.create(TokenTestModule, { logger: false });
    app.useGlobalPipes(new ValidationPipe({ transform: true }));
    try {
      await app.listen(0, '127.0.0.1');
      const body = { grant_type: 'authorization_code', code: 'synthetic-code',
        client_id: 'client', client_secret: 'synthetic-secret',
        redirect_uri: 'https://client.test/callback', resource, code_verifier: 'a'.repeat(43) };
      const response = await fetch(`${await app.getUrl()}/oauth/token`, {
        method: 'POST', body: new URLSearchParams(body),
      });
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(response.headers.get('pragma')).toBe('no-cache');
      expect(await response.json()).toEqual(token);
      expect(exchangeCodeForToken).toHaveBeenCalledWith(expect.objectContaining(body));
    } finally { await app.close(); }
  });
  it.each(['approve', 'deny'] as const)('identifies the issuer in the %s callback and preserves state', async (action) => {
    const redirect = 'https://client.test/callback';
    const repository = {
      getAppByClientId: jest.fn().mockResolvedValue({ id: 'app', redirectUrl: redirect }),
      createAuthorization: jest.fn(),
    };
    process.env.JWT_SECRET = 'oauth-test-only-secret';
    const controller = new OAuthAuthorizedController(new OAuthService(repository as any));
    const body = { client_id: 'client', response_type: 'code', redirect_uri: redirect,
      scope: 'accounts:read', resource, code_challenge_method: 'S256', action, state: 'opaque & state',
      code_challenge: createHash('sha256').update('a'.repeat(43)).digest('base64url') };
    const result = await controller.approveOrDeny(body, { id: 'user' } as any, { id: 'org' } as any);
    const url = new URL(result.redirect);
    expect(url.origin + url.pathname).toBe(redirect);
    expect(url.searchParams.get('iss')).toBe(getOAuthIssuer());
    expect(url.searchParams.get('state')).toBe(body.state);
    expect(url.searchParams.has('code')).toBe(action === 'approve');
    expect(url.searchParams.get('error')).toBe(action === 'deny' ? 'access_denied' : null);
    await expect(controller.approveOrDeny({ ...body, redirect_uri: 'https://attacker.test' },
      { id: 'user' } as any, { id: 'org' } as any)).rejects.toThrow();
  });
});
