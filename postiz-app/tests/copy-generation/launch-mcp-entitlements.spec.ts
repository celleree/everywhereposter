import { MCPServer } from '@mastra/mcp';
import { OrganizationRepository } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.repository';
import { startMcp } from '@gitroom/nestjs-libraries/chat/start.mcp';
import { getContext } from '@gitroom/nestjs-libraries/chat/async.storage';

jest.mock('bcrypt', () => ({ hashSync: jest.fn(), compareSync: jest.fn() }));
jest.mock('@mastra/mcp', () => ({ MCPServer: jest.fn() }));
jest.mock('@gitroom/nestjs-libraries/chat/mastra.service', () => ({ MastraService: class MastraService {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/organizations/organization.service', () => ({ OrganizationService: class OrganizationService {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/oauth/oauth.service', () => ({
  OAuthService: class OAuthService {}, OAUTH_SCOPES: ['accounts:read', 'posts:write'],
  parseOAuthScopes: (scope: string) => scope.split(' '),
  getMcpResource: () => 'https://server.test/api/mcp-oauth', getOAuthIssuer: () => 'https://server.test/api',
}));
jest.mock('@gitroom/nestjs-libraries/database/prisma/integrations/integration.service', () => ({ IntegrationService: class IntegrationService {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/media/media.service', () => ({ MediaService: class MediaService {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/posts/posts.service', () => ({ PostsService: class PostsService {} }));
jest.mock('@gitroom/backend/services/auth/permissions/permissions.service', () => ({ PermissionsService: class PermissionsService {} }));
jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({ ioRedis: {} }));
jest.mock('@gitroom/nestjs-libraries/chat/oauth-publishing.tools', () => ({
  createOAuthPublishingTools: () => ({ readTools: { read: {} }, writeTools: { write: {} } }),
}));
jest.mock('@gitroom/nestjs-libraries/chat/oauth-middleware', () => ({
  createOAuthMiddleware: () => async () => ({ proceed: true, tokenValidation: { subject: 'pos_fixture' } }),
}));
jest.mock('@gitroom/nestjs-libraries/chat/chatgpt-file', () => ({
  chatgptFileInput: { safeParse: () => ({ success: true }) }, createChatGPTFileTool: () => ({}),
}));

const paths = ['/mcp', '/mcp/:id', '/sse/:id', '/message/:id'];
const envKeys = ['BILLING_ENABLED', 'NEXT_PUBLIC_BACKEND_URL'] as const;
let saved: Partial<Record<typeof envKeys[number], string>>;
let handlers: Map<string, Function>;
let organization: { findUnique: jest.Mock };
let service: { getOrgByApiKey: jest.Mock; assertAdvancedAutomationAllowed: jest.Mock };
let observed: Array<ReturnType<typeof getContext>>;
let transports: Array<{ startHTTP: jest.Mock; startSSE: jest.Mock }>;

beforeEach(async () => {
  saved = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
  process.env.NEXT_PUBLIC_BACKEND_URL = 'https://server.test/api';
  handlers = new Map(); observed = []; transports = [];
  (MCPServer as jest.Mock).mockImplementation(() => {
    const transport = { startHTTP: jest.fn(async () => { observed.push(getContext()); }),
      startSSE: jest.fn(async () => { observed.push(getContext()); }) };
    transports.push(transport); return transport;
  });
  organization = { findUnique: jest.fn().mockResolvedValue({ subscription: { subscriptionTier: 'PRO' } }) };
  const repository = new OrganizationRepository({ model: { organization } } as any, {} as any, {} as any, {} as any);
  service = {
    getOrgByApiKey: jest.fn().mockResolvedValue({ id: 'org-fixture', subscription: { subscriptionTier: 'PRO' } }),
    assertAdvancedAutomationAllowed: jest.fn(id => repository.assertAdvancedAutomationAllowed(id)),
  };
  await startMcp({
    get: (provider: any) => {
      if (provider.name === 'MastraService') return { mastra: async () => ({ getAgent: () => ({ listTools: async () => ({ legacy: {} }) }) }) };
      if (provider.name === 'OrganizationService') return service;
      if (provider.name === 'OAuthService') return { getOrgByOAuthToken: async () => ({ id: 'grant', scope: 'accounts:read', organization: { id: 'oauth-org' } }) };
      return {};
    },
    use: (route: string | string[], handler: Function) => {
      for (const path of Array.isArray(route) ? route : [route]) handlers.set(path, handler);
    },
  } as any);
});
afterEach(() => {
  for (const key of envKeys) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; }
});

const request = (path: string, method = 'POST') => ({ path: '/', method, params: { id: 'fixture-key' },
  headers: { authorization: 'Bearer fixture-key' }, rawHeaders: [], originalUrl: path.replace(':id', 'fixture-key'),
  body: { jsonrpc: '2.0', id: 1, method: 'initialize' } });
const response = () => ({ status: jest.fn().mockReturnThis(), send: jest.fn(), sendStatus: jest.fn(),
  setHeader: jest.fn(), json: jest.fn() });
const expectNoDispatch = () => {
  for (const transport of transports) {
    expect(transport.startHTTP).not.toHaveBeenCalled(); expect(transport.startSSE).not.toHaveBeenCalled();
  }
  expect(observed).toEqual([]);
};

it.each(paths.flatMap(path => ['true', 'false'].map(billing => [path, billing])))('rejects Launch on %s (billing=%s)', async (path, billing) => {
  process.env.BILLING_ENABLED = billing;
  organization.findUnique.mockResolvedValue({ subscription: { subscriptionTier: 'LAUNCH_V1' } });
  const res = response();
  await handlers.get(path)!(request(path), res, jest.fn());
  expect(service.assertAdvancedAutomationAllowed).toHaveBeenCalledWith('org-fixture');
  expect(organization.findUnique).toHaveBeenCalledWith({ where: { id: 'org-fixture' }, select: { subscription: { select: { subscriptionTier: true } } } });
  expect(res.status).toHaveBeenCalledWith(403);
  expect(res.send).toHaveBeenCalledWith('Advanced automation is unavailable on this plan');
  expectNoDispatch();
});

it.each(paths)('preserves eligible legacy dispatch and rechecks the next request on %s', async path => {
  await handlers.get(path)!(request(path), response(), jest.fn());
  expect(observed).toEqual([{ requestId: 'fixture-key', auth: { id: 'org-fixture', subscription: { subscriptionTier: 'PRO' } } }]);
  const transport = path.startsWith('/mcp') ? transports[0] : transports[4];
  expect(path.startsWith('/mcp') ? transport.startHTTP : transport.startSSE).toHaveBeenCalledTimes(1);
  organization.findUnique.mockResolvedValue({ subscription: { subscriptionTier: 'LAUNCH_V1' } });
  const res = response();
  await handlers.get(path)!(request(path), res, jest.fn());
  expect(service.assertAdvancedAutomationAllowed).toHaveBeenCalledTimes(2);
  expect(res.status).toHaveBeenCalledWith(403); expect(observed).toHaveLength(1);
});

it.each(paths.flatMap(path => ['missing', 'failure'].map(state => [path, state])))('fails closed on %s when current eligibility is %s', async (path, state) => {
  if (state === 'missing') organization.findUnique.mockResolvedValue(null);
  else organization.findUnique.mockRejectedValue(new Error('private database failure detail'));
  const res = response();
  await handlers.get(path)!(request(path), res, jest.fn());
  expect(res.status).toHaveBeenCalledWith(state === 'missing' ? 403 : 503);
  expect(res.send).toHaveBeenCalledWith(state === 'missing'
    ? 'Advanced automation is unavailable on this plan' : 'Unable to verify advanced automation entitlement');
  expectNoDispatch();
});

it('waits for current eligibility before dispatching', async () => {
  let resolve!: (value: any) => void;
  let started!: () => void;
  const checking = new Promise<void>(done => { started = done; });
  organization.findUnique.mockImplementation(() => { started(); return new Promise(done => { resolve = done; }); });
  const pending = handlers.get('/mcp')!(request('/mcp'), response(), jest.fn());
  await checking;
  expect(service.assertAdvancedAutomationAllowed).toHaveBeenCalledTimes(1); expectNoDispatch();
  resolve({ subscription: null });
  await pending;
  expect(observed).toHaveLength(1);
});

it.each(paths)('retains invalid-key and OPTIONS behavior on %s', async path => {
  service.getOrgByApiKey.mockResolvedValue(null);
  const invalid = response();
  await handlers.get(path)!(request(path), invalid, jest.fn());
  expect(invalid.status).toHaveBeenCalledWith(path === '/mcp' ? 401 : 400);
  expect(invalid.send).toHaveBeenCalledWith(path === '/mcp' ? 'Invalid API Key or OAuth token' : 'Invalid API Key');
  service.getOrgByApiKey.mockClear();
  const options = response();
  await handlers.get(path)!(request(path, 'OPTIONS'), options, jest.fn());
  expect(options.sendStatus).toHaveBeenCalledWith(200);
  expect(service.getOrgByApiKey).not.toHaveBeenCalled();
  expect(service.assertAdvancedAutomationAllowed).not.toHaveBeenCalled(); expectNoDispatch();
});

it('retains missing bearer, OAuth-token rejection and subpath pass-through on /mcp', async () => {
  for (const authorization of [undefined, 'Bearer pos_fixture']) {
    const req = request('/mcp'); req.headers.authorization = authorization as any;
    const res = response(); await handlers.get('/mcp')!(req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(401);
  }
  const req = request('/mcp'); req.path = '/fixture-key';
  const next = jest.fn(); await handlers.get('/mcp')!(req, response(), next);
  expect(next).toHaveBeenCalledTimes(1);
  expect(service.getOrgByApiKey).not.toHaveBeenCalled();
  expect(service.assertAdvancedAutomationAllowed).not.toHaveBeenCalled(); expectNoDispatch();
});

it('keeps the restricted OAuth transport independent of legacy eligibility', async () => {
  organization.findUnique.mockResolvedValue({ subscription: { subscriptionTier: 'LAUNCH_V1' } });
  const req = request('/mcp-oauth'); req.headers.authorization = 'Bearer pos_fixture';
  await handlers.get('/mcp-oauth')!(req, response(), jest.fn());
  expect(service.getOrgByApiKey).not.toHaveBeenCalled();
  expect(service.assertAdvancedAutomationAllowed).not.toHaveBeenCalled();
  expect(transports[0].startHTTP).not.toHaveBeenCalled();
  expect(transports[1].startHTTP).toHaveBeenCalledTimes(1);
  const configs = (MCPServer as jest.Mock).mock.calls;
  expect(configs[1][0].tools).toEqual({ read: {} }); expect(configs[1][0].agents).toBeUndefined();
  expect(observed[0]).toMatchObject({ requestId: 'pos_fixture', auth: { id: 'oauth-org' }, oauth: { id: 'grant', scopes: ['accounts:read'] } });
});
