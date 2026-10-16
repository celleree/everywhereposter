// Isolated browser adapter: real Nest HTTP controller, Discovery service and
// throttle guard; synthetic authenticated membership, repository and Graph only.
// No database, OAuth, workers, real credentials, or outbound provider traffic.
const path = require('node:path');
const fs = require('node:fs');
module.exports = function discoveryRuntime() {
  for (const key of ['DATABASE_URL', 'REDIS_URL', 'FACEBOOK_APP_ID', 'FACEBOOK_APP_SECRET', 'JWT_SECRET']) {
    if (process.env[key]) throw new Error('Discovery fixture refuses preconfigured service credentials: ' + key);
  }
  process.env.FACEBOOK_APP_ID = '456';
  process.env.FACEBOOK_APP_SECRET = 'synthetic-app-secret';
  process.env.JWT_SECRET = 'synthetic-discovery-session-secret';
  const root = path.resolve(__dirname, '../..');
  const ts = require('typescript');
  const options = require(path.join(root, 'tsconfig.base.json')).compilerOptions;
  require('tsconfig-paths').register({ baseUrl: root, paths: options.paths });
  require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { ...options, module: ts.ModuleKind.CommonJS, emitDecoratorMetadata: true } }).outputText, file);
  require('reflect-metadata');
  const ModuleLoader = require('node:module');
  const load = ModuleLoader._load;
  const stubs = {
    '@gitroom/nestjs-libraries/database/prisma/integrations/integration.repository': { IntegrationRepository: class IntegrationRepository {} },
    '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service': { IntegrationService: class IntegrationService {} },
    '@gitroom/nestjs-libraries/database/prisma/posts/posts.service': { PostsService: class PostsService {} },
  };
  ModuleLoader._load = function (name, ...args) { return stubs[name] || load.call(this, name, ...args); };
  let BusinessDiscoveryService, AnalyticsController;
  try {
    ({ BusinessDiscoveryService } = require('../../libraries/nestjs-libraries/src/analytics/business-discovery.service.ts'));
    ({ AnalyticsController } = require('../../apps/backend/src/api/routes/analytics.controller.ts'));
  } finally { ModuleLoader._load = load; }
  const { Module, HttpException } = require('@nestjs/common');
  const { NestFactory } = require('@nestjs/core');
  const { ThrottlerModule } = require('@nestjs/throttler');
  const accounts = ['Discovery actor one', 'Discovery actor two'].map((name, index) => ({ id: `discovery-${index}`, organizationId: 'synthetic-org', internalId: String(123 + index), name, profile: index ? 'actortwo' : 'actorone', providerIdentifier: 'instagram', type: 'social', token: `SYNTHETIC_PAGE_${index}`, refreshToken: 'SYNTHETIC_USER', tokenExpiration: new Date(Date.now() + 86400000), disabled: false, inBetweenSteps: false, refreshNeeded: false, deletedAt: null }));
  let calls = [], mode = 'normal', hits = new Map();
  const repo = { getIntegrationById: async (org, id) => accounts.find(account => account.organizationId === org && account.id === id) || null };
  const service = new BusinessDiscoveryService(repo);
  global.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    if (url.origin !== 'https://graph.facebook.com' || !url.pathname.startsWith('/v25.0/') || init.method && init.method !== 'GET') throw new Error('Unexpected fixture external request');
    const node = url.pathname.slice('/v25.0/'.length);
    const fields = url.searchParams.get('fields') || '';
    calls.push({ node, fields });
    const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
    if (node === 'debug_token') {
      const page = /SYNTHETIC_PAGE_(\d)/.exec(url.searchParams.get('input_token'));
      return json({ data: page ? { is_valid: true, app_id: '456', type: 'PAGE', profile_id: String(999 - Number(page[1])), expires_at: 0 } : { is_valid: true, app_id: '456', type: 'USER', user_id: '789', expires_at: Math.floor(Date.now() / 1000) + 3600, data_access_expires_at: Math.floor(Date.now() / 1000) + 3600, scopes: ['instagram_basic', 'instagram_manage_insights', 'pages_read_engagement', 'pages_show_list'] } });
    }
    if (node === 'me/accounts') return json({ data: accounts.map((account, i) => ({ id: String(999 - i), instagram_business_account: { id: account.internalId } })) });
    if (node === 'me') {
      const page = /SYNTHETIC_PAGE_(\d)/.exec(init.headers.Authorization);
      return json(page ? { id: String(999 - Number(page[1])), instagram_business_account: { id: String(123 + Number(page[1])) } } : { id: '789' });
    }
    const account = accounts.find(account => account.internalId === node);
    if (!account) throw new Error('Unknown fixture Graph node');
    if (fields === 'id,username') return json({ id: node, username: account.profile });
    const target = /business_discovery\.username\(([^)]+)\)/.exec(fields)?.[1];
    if (!target) throw new Error('Unexpected Graph field expansion');
    if (target === 'ratelimited') return json({ error: { code: 4, message: 'upstream secret must not pass through' } }, 429);
    if (target === 'expiredtarget') return json({ error: { code: 190 } }, 400);
    if (target === 'missingpermissions') return json({ error: { code: 200 } }, 403);
    if (target === 'upstreamfail') return json({ error: { code: 2 } }, 500);
    if (target === 'unknownuser') return json({ id: node });
    if (target === 'slowtarget') await new Promise(resolve => setTimeout(resolve, 1800));
    const second = fields.includes('.after(NEXT_PAGE)');
    return json({ id: node, business_discovery: { id: '321', username: target, biography: '<script>Public biography is text</script>', website: 'https://public.example/', followers_count: 0, media_count: target === 'emptytarget' ? 0 : 2, media: { data: target === 'emptytarget' ? [] : [{ id: second ? '9872' : '9871', caption: second ? 'Second page public caption' : `${target} public caption`, media_type: 'VIDEO', permalink: 'https://www.instagram.com/p/synthetic/', like_count: 0 }], ...(second || target === 'emptytarget' ? {} : { paging: { cursors: { after: 'NEXT_PAGE' } } }) } } });
  };
  class DiscoveryFixtureModule {}
  Module({ imports: [ThrottlerModule.forRoot({ throttlers: [{ ttl: 60000, limit: 30 }], storage: { increment: async (key, ttl, limit) => { const count = (hits.get(key) || 0) + 1; hits.set(key, count); return { totalHits: count, timeToExpire: 60, isBlocked: count > limit, timeToBlockExpire: 60 }; } } })], controllers: [AnalyticsController], providers: [
    { provide: stubs['@gitroom/nestjs-libraries/database/prisma/integrations/integration.service'].IntegrationService, useValue: { checkAnalytics: async () => { throw new HttpException('Synthetic owner insights unavailable', 502); } } },
    { provide: stubs['@gitroom/nestjs-libraries/database/prisma/posts/posts.service'].PostsService, useValue: {} },
    { provide: BusinessDiscoveryService, useValue: service },
  ] })(DiscoveryFixtureModule);
  const application = NestFactory.create(DiscoveryFixtureModule, { logger: false }).then(async app => {
    // Deliberately synthetic membership; this is not an OAuth/AuthMiddleware test.
    app.use((req, res, next) => { req.user = { id: 'synthetic-user' }; req.org = { id: req.headers.showorg === 'other-org' ? 'other-org' : 'synthetic-org' }; req.cookies = { auth: 'synthetic-playwright-session' }; next(); });
    await app.init(); return app;
  });
  const send = (res, data, status = 200) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(data)); return true; };
  return { async handle(req, res, url, token) {
    if (!url.pathname.startsWith('/__discovery/') && !url.pathname.startsWith('/analytics/') && !['/integrations/list', '/integrations'].includes(url.pathname)) return false;
    const auth = req.headers.auth || /(?:^|;\s*)auth=([^;]+)/.exec(req.headers.cookie || '')?.[1];
    if (auth !== token) return send(res, {}, 401);
    if (url.pathname === '/__discovery/reset' && req.method === 'POST') { calls = []; hits = new Map(); mode = 'normal'; return send(res, {}); }
    if (url.pathname === '/__discovery/evidence') return send(res, { calls, mode });
    if (req.method !== 'GET') return send(res, {}, 405);
    if (url.pathname.startsWith('/integrations')) {
      const publicAccounts = accounts.map(account => ({ id: account.id, name: account.name, identifier: 'instagram', internalId: account.internalId, type: 'social', disabled: false, refreshNeeded: false, inBetweenSteps: false, canListMedia: false, picture: '/icons/platforms/instagram.png' }));
      return send(res, url.pathname.endsWith('/list') ? { integrations: publicAccounts } : publicAccounts);
    }
    const app = await application;
    app.getHttpAdapter().getInstance()(req, res);
    return true;
  } };
};
