import { INestApplication } from '@nestjs/common';
import { Request, Response } from 'express';
import { MastraService } from '@gitroom/nestjs-libraries/chat/mastra.service';
import { MCPServer } from '@mastra/mcp';
import { randomUUID } from 'crypto';
import { OrganizationService } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';
import { OAUTH_SCOPES, parseOAuthScopes, getMcpResource, getOAuthIssuer, OAuthService } from '@gitroom/nestjs-libraries/database/prisma/oauth/oauth.service';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { runWithContext } from './async.storage';
import { createOAuthMiddleware } from './oauth-middleware';
import { createOAuthPublishingTools } from './oauth-publishing.tools';
import { MediaService } from '../database/prisma/media/media.service';
import { PostsService } from '../database/prisma/posts/posts.service';
import { ioRedis } from '../redis/redis.service';
import { PermissionsService } from '@gitroom/backend/services/auth/permissions/permissions.service';
const fixAcceptHeader = (req: Request) => {
  const value = 'application/json, text/event-stream';
  req.headers.accept = value;
  const idx = req.rawHeaders.findIndex((h) => h.toLowerCase() === 'accept');
  if (idx !== -1) {
    req.rawHeaders[idx + 1] = value;
  } else {
    req.rawHeaders.push('Accept', value);
  }
};

export const startMcp = async (app: INestApplication) => {
  const mastraService = app.get(MastraService, { strict: false });
  const organizationService = app.get(OrganizationService, { strict: false });
  const oauthService = app.get(OAuthService, { strict: false });
  const integrationService = app.get(IntegrationService, { strict: false });

  const resolveAuth = async (token: string) => {
    if (token.startsWith('pos_')) return null;
    return organizationService.getOrgByApiKey(token);
  };

  const mastra = await mastraService.mastra();
  const agent = mastra.getAgent('postiz');
  const tools = await agent.listTools();

  const serverConfig = {
    name: 'EverywherePoster MCP',
    version: '1.0.0',
    tools,
    agents: { postiz: agent },
  };

  const server = new MCPServer(serverConfig);
  // Explicit registries: OAuth never inherits legacy agents or their tools.
  const { readTools, writeTools } = createOAuthPublishingTools({
    integrations: integrationService,
    media: app.get(MediaService, { strict: false }),
    posts: app.get(PostsService, { strict: false }),
    permissions: app.get(PermissionsService, { strict: false }),
    redis: process.env.REDIS_URL ? ioRedis : {
      get: async () => { throw new Error('OAuth publishing requires Redis'); },
      set: async () => { throw new Error('OAuth publishing requires Redis'); },
    } as Pick<typeof ioRedis, 'get' | 'set'>,
  });
  const oauthServers = new Map<string, MCPServer>();
  for (const scopes of [['accounts:read'], ['posts:write'], ['accounts:read', 'posts:write']]) {
    oauthServers.set(scopes.join(' '), new MCPServer({
      name: 'EverywherePoster OAuth', version: '1.0.0',
      tools: { ...(scopes.includes('accounts:read') ? readTools : {}),
        ...(scopes.includes('posts:write') ? writeTools : {}) },
    }));
  }
  const resource = getMcpResource();
  const issuer = getOAuthIssuer();
  const resourceMetadataPath = `/.well-known/oauth-protected-resource${new URL(resource).pathname}`;
  const issuerMetadataPath = `/.well-known/oauth-authorization-server${new URL(issuer).pathname.replace(/\/$/, '')}`;

  const oauthMiddleware = createOAuthMiddleware({
    oauth: {
      resource,
      scopesSupported: OAUTH_SCOPES,
      authorizationServers: [issuer],
      validateToken: async (token: string) => {
        const org = await oauthService.getOrgByOAuthToken(token, resource);
        if (!org) {
          return { valid: false, error: 'invalid_token', errorDescription: 'Invalid OAuth token' };
        }
        return { valid: true, subject: token };
      },
    },
    mcpPath: new URL(resource).pathname,
  });

  if (process.env.OPENAI_APP_CHALLANGE) {
    app.use('/.well-known/openai-apps-challenge', (req: Request, res: Response) => {
      res.setHeader('Content-Type', 'text/plain');
      res.send(process.env.OPENAI_APP_CHALLANGE);
    });
  }

  // Keep the legacy metadata aliases while serving RFC 9728 path-based discovery.
  for (const path of new Set([resourceMetadataPath, '/.well-known/oauth-protected-resource'])) {
    app.use(path, async (req: Request, res: Response) => {
      await oauthMiddleware(req, res, new URL(resourceMetadataPath, resource));
    });
  }

  const authorizationMetadata = async (req: Request, res: Response) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.writeHead(204);
      res.end();
      return;
    }
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'max-age=3600');
    res.json({
      issuer,
      authorization_response_iss_parameter_supported: true,
      authorization_endpoint: `${process.env.FRONTEND_URL}/oauth/authorize`,
      token_endpoint: `${issuer}/oauth/token`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code'],
      code_challenge_methods_supported: ['S256'],
      scopes_supported: OAUTH_SCOPES,
      token_endpoint_auth_methods_supported: ['client_secret_post'],
    });
  };
  for (const path of new Set([issuerMetadataPath, '/.well-known/oauth-authorization-server'])) {
    app.use(path, authorizationMetadata);
  }

  app.use('/mcp-oauth', async (req: Request, res: Response, next: () => void) => {
    // Skip if this is the /mcp/:id route
    if (req.path !== '/' && req.path !== '') {
      next();
      return;
    }

    const url = new URL('/mcp-oauth', resource);

    const result = await oauthMiddleware(req, res, new URL(resource));
    if (!result.proceed) return;

    const token = result.tokenValidation?.subject;
    const authorization = await oauthService.getOrgByOAuthToken(token!, resource);
    const auth = authorization?.organization;
    if (!auth) {
      res.status(401).json({ error: 'invalid_token', error_description: 'Could not resolve organization' });
      return;
    }

    fixAcceptHeader(req);
    const scopes = parseOAuthScopes(authorization.scope).sort();
    const oauthServer = oauthServers.get(scopes.join(' '));
    if (!oauthServer) { res.status(403).json({ error: 'insufficient_scope' }); return; }
    await runWithContext({ requestId: token!, auth, oauth: { id: authorization.id, scopes } }, async () => {
      await oauthServer.startHTTP({
        url: url,
        httpPath: url.pathname,
        options: {
          sessionIdGenerator: () => {
            return randomUUID();
          },
          enableJsonResponse: true,
        },
        req,
        res,
      });
    });
  });

  app.use('/mcp', async (req: Request, res: Response, next: () => void) => {
    // Skip if this is the /mcp/:id route
    if (req.path !== '/' && req.path !== '') {
      next();
      return;
    }

    // @ts-ignore
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Expose-Headers', '*');

    if (req.method === 'OPTIONS') {
      res.sendStatus(200);
      return;
    }

    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      res.status(401).send('Missing Authorization header');
      return;
    }

    // @ts-ignore
    req.auth = await resolveAuth(token);
    // @ts-ignore
    if (!req.auth) {
      res.status(401).send('Invalid API Key or OAuth token');
      return;
    }

    const url = new URL('/mcp', process.env.NEXT_PUBLIC_BACKEND_URL);

    fixAcceptHeader(req);
    // @ts-ignore
    await runWithContext({ requestId: token, auth: req.auth }, async () => {
      await server.startHTTP({
        url,
        httpPath: url.pathname,
        options: {
          sessionIdGenerator: () => {
            return randomUUID();
          },
          enableJsonResponse: true,
        },
        req,
        res,
      });
    });
  });

  app.use('/mcp/:id', async (req: Request, res: Response) => {
    // @ts-ignore
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Expose-Headers', '*');

    if (req.method === 'OPTIONS') {
      res.sendStatus(200);
      return;
    }

    // @ts-ignore
    req.auth = await organizationService.getOrgByApiKey(req.params.id);
    // @ts-ignore
    if (!req.auth) {
      res.status(400).send('Invalid API Key');
      return;
    }

    const url = new URL(
      `/mcp/${req.params.id}`,
      process.env.NEXT_PUBLIC_BACKEND_URL
    );

    fixAcceptHeader(req);
    await runWithContext(
      // @ts-ignore
      { requestId: req.params.id, auth: req.auth },
      async () => {
        await server.startHTTP({
          url,
          httpPath: url.pathname,
          options: {
            sessionIdGenerator: () => {
              return randomUUID();
            },
            enableJsonResponse: true,
          },
          req,
          res,
        });
      }
    );
  });

  app.use(['/sse/:id', '/message/:id'], async (req: Request, res: Response) => {
    // @ts-ignore
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Expose-Headers', '*');

    if (req.method === 'OPTIONS') {
      res.sendStatus(200);
      return;
    }

    // @ts-ignore
    req.auth = await organizationService.getOrgByApiKey(req.params.id);
    // @ts-ignore
    if (!req.auth) {
      res.status(400).send('Invalid API Key');
      return;
    }

    const url = new URL(req.originalUrl, process.env.NEXT_PUBLIC_BACKEND_URL);

    await runWithContext(
      // @ts-ignore
      { requestId: req.params.id, auth: req.auth },
      async () => {
        await new MCPServer(serverConfig).startSSE({
          url,
          ssePath: `/sse/${req.params.id}`,
          messagePath: `/message/${req.params.id}`,
          req,
          res,
        });
      }
    );
  });
};
