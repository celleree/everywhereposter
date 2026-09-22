import { INestApplication } from '@nestjs/common';
import { Request, Response } from 'express';
import { MastraService } from '@gitroom/nestjs-libraries/chat/mastra.service';
import { MCPServer } from '@mastra/mcp';
import { randomUUID } from 'crypto';
import { OrganizationService } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';
import { ACCOUNTS_READ_SCOPE, getMcpResource, OAuthService } from '@gitroom/nestjs-libraries/database/prisma/oauth/oauth.service';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { runWithContext } from './async.storage';
import { createOAuthMiddleware } from './oauth-middleware';
import { createListConnectedAccountsTool } from './tools/list.connected.accounts.tool';
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
  // Read grants must never inherit the agent or its publishing/generation tools.
  const readServer = new MCPServer({
    name: 'EverywherePoster Accounts',
    version: '1.0.0',
    tools: {
      list_connected_accounts: createListConnectedAccountsTool(integrationService),
    },
  });
  const resource = getMcpResource();

  const oauthMiddleware = createOAuthMiddleware({
    oauth: {
      resource,
      scopesSupported: [ACCOUNTS_READ_SCOPE],
      authorizationServers: [process.env.NEXT_PUBLIC_BACKEND_URL!],
      validateToken: async (token: string) => {
        const org = await oauthService.getOrgByOAuthToken(token, resource, ACCOUNTS_READ_SCOPE);
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

  app.use('/.well-known/oauth-protected-resource', async (req: Request, res: Response) => {
    const url = new URL('./.well-known/oauth-protected-resource', resource);
    await oauthMiddleware(req, res, url);
  });

  app.use('/.well-known/oauth-authorization-server', async (req: Request, res: Response) => {
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
      issuer: process.env.NEXT_PUBLIC_BACKEND_URL,
      authorization_endpoint: `${process.env.FRONTEND_URL}/oauth/authorize`,
      token_endpoint: `${process.env.NEXT_PUBLIC_OVERRIDE_BACKEND_URL || process.env.NEXT_PUBLIC_BACKEND_URL}/oauth/token`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code'],
      code_challenge_methods_supported: ['S256'],
      scopes_supported: [ACCOUNTS_READ_SCOPE],
      token_endpoint_auth_methods_supported: ['client_secret_post'],
    });
  });

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
    const authorization = await oauthService.getOrgByOAuthToken(token!, resource, ACCOUNTS_READ_SCOPE);
    const auth = authorization?.organization;
    if (!auth) {
      res.status(401).json({ error: 'invalid_token', error_description: 'Could not resolve organization' });
      return;
    }

    fixAcceptHeader(req);
    await runWithContext({ requestId: token!, auth }, async () => {
      await readServer.startHTTP({
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
