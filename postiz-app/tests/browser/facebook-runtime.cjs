// Opt-in local adapter: synthetic session, real controller/services/Prisma,
// deterministic Graph and Temporal boundaries. Never loads environment files.
// Membership is supplied synthetically: controller role checks run, but this
// harness does not claim AuthMiddleware, OAuth, or live-provider acceptance.
const path = require('node:path');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
module.exports = function facebookRuntime() {
  const url = process.env.EP_SUBMISSION_TEST_DATABASE_URL;
  if (url !== 'postgresql://isolated:isolated@127.0.0.1:55462/isolated') throw new Error('Facebook browser tests require the exact isolated database.');
  if (process.env.REDIS_URL || process.env.FACEBOOK_APP_SECRET) throw new Error('Live service configuration is forbidden in the fixture process.');
  process.env.FACEBOOK_APP_ID = 'browser-fixture-app';
  const root = path.resolve(__dirname, '../..');
  const ts = require('typescript');
  const compilerOptions = require(path.join(root, 'tsconfig.base.json')).compilerOptions;
  require('tsconfig-paths').register({ baseUrl: root, paths: compilerOptions.paths });
  require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { ...compilerOptions, module: ts.ModuleKind.CommonJS, emitDecoratorMetadata: false },
  }).outputText, file);
  require('reflect-metadata');
  const { PrismaClient } = require('@prisma/client');
  const { FacebookPublishedService } = require('../../libraries/nestjs-libraries/src/database/prisma/posts/facebook-published.service.ts');
  const { FacebookProvider } = require('../../libraries/nestjs-libraries/src/integrations/social/facebook.provider.ts');
  const { PostsController } = require('../../apps/backend/src/api/routes/posts.controller.ts');
  const { PostsRepository } = require('../../libraries/nestjs-libraries/src/database/prisma/posts/posts.repository.ts');
  const { PublishingSubmissionService } = require('../../libraries/nestjs-libraries/src/database/prisma/posts/publishing-submission.service.ts');
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const model = { model: prisma };
  const repository = new PostsRepository(model, model, model, model, model, model);
  const submissions = new PublishingSubmissionService(prisma, repository, { client: { getRawClient: () => undefined } });
  const service = new FacebookPublishedService(prisma);
  const provider = new FacebookProvider();
  const { PostsService } = require('../../libraries/nestjs-libraries/src/database/prisma/posts/posts.service.ts');
  const postsService = Object.create(PostsService.prototype);
  postsService._integrationService = { getIntegrationById: (organizationId, id) => prisma.integration.findFirst({ where: { organizationId, id } }) };
  postsService._facebookPublished = service;
  postsService._submissions = submissions;
  postsService._postRepository = repository;
  const { ShortLinkService } = require('../../libraries/nestjs-libraries/src/short-linking/short.link.service.ts');
  const controller = new PostsController({
    facebookPublishedStatus: (...args) => service.status(...args),
    mutateFacebookPublished: (...args) => service.mutate(...args),
    reconcileFacebookPublished: (...args) => service.reconcile(...args),
    mapTypeToPost: (...args) => postsService.mapTypeToPost(...args),
    createPost: (...args) => create(...args),
    reconcileSubmission: (...args) => postsService.reconcileSubmission(...args),
  }, undefined, new ShortLinkService());
  let fixture, calls = [], remote = new Map(), mode = 'success';
  let reads = 0;
  global.fetch = async (input, init = {}) => {
    const graph = new URL(String(input));
    if (graph.origin !== 'https://graph.facebook.com' || !graph.pathname.startsWith('/v25.0/')) throw new Error('Unexpected external request blocked');
    const id = graph.pathname.slice('/v25.0/'.length), method = init.method || 'GET';
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ id, method, ...(body?.message ? { message: body.message } : {}) });
    const respond = (json, status = 200) => new Response(JSON.stringify(json), { status, headers: { 'content-type': 'application/json' } });
    if (id.endsWith('/feed') && method === 'POST') {
      const postId = `${id.split('/')[0]}_${Date.now()}${remote.size}`;
      remote.set(postId, body.message);
      return respond({ id: postId, permalink_url: `https://www.facebook.com/${postId}` });
    }
    if (!remote.has(id)) return respond({ error: { message: 'Unavailable fixture post' } }, 400);
    if (method === 'GET') return respond({ id, message: remote.get(id), permalink_url: `https://www.facebook.com/${id}` });
    if (mode === 'reject') return respond({ error: { message: 'Fixture authorization rejected' } }, 403);
    if (mode === 'timeout') throw new Error('Fixture network timeout');
    if (method === 'POST') remote.set(id, body.message);
    if (method === 'DELETE') remote.delete(id);
    if (mode === 'accepted-timeout') throw new Error('Fixture lost acknowledgement');
    return respond({ success: true });
  };
  async function create(orgId, body) {
    const result = await postsService.createPost(orgId, body);
    // Drive the existing durable activity boundary synchronously, replacing only
    // external Temporal dispatch. Reservation, provider receipt and commit are real.
    for (const item of result) {
      const post = await prisma.post.findUniqueOrThrow({ where: { id: item.postId }, include: { integration: true } });
      const destination = await prisma.publishingSubmissionDestination.findUnique({ where: { postId: post.id } });
      if (!destination) throw new Error('Fixture expected the real composer to create a durable submission receipt');
      await submissions.runProvider(orgId, post.id, item.integration, `post_${post.id}_submission_1`, async () => provider.post(
        post.integration.internalId, post.integration.token,
        await postsService.buildPostDetailsForProvider(orgId, provider, [post])
      ));
    }
    return result;
  }
  async function reset(body) {
    mode = 'success'; calls = []; remote = new Map(); reads = 0;
    const organization = await prisma.organization.create({ data: { id: randomUUID(), name: 'Browser fixture only' } });
    const accounts = await Promise.all(['Browser Page A', 'Browser Page B'].map((name, index) => prisma.integration.create({ data: {
      id: randomUUID(), organizationId: organization.id, internalId: `990${index}`, name, providerIdentifier: 'facebook', type: 'social', token: 'fixture-not-a-meta-token',
    } })));
    fixture = { organization: { ...organization, users: [{ role: body.role || 'ADMIN' }] }, accounts };
    if (!body.empty) for (const account of accounts) await create(organization.id, {
      submissionId: randomUUID(), type: 'now', shortLink: false, inter: 0, tags: [],
      posts: [{ integration: { id: account.id }, settings: { __type: 'facebook' }, value: [{ content: `Original ${account.name} text`, image: [], delay: 0 }] }],
    });
    mode = body.mode || 'success';
    return { organizationId: organization.id, integrationIds: accounts.map(a => a.id) };
  }
  const jsonBody = async req => {
    let data = ''; for await (const chunk of req) { data += chunk; if (data.length > 100000) throw new Error('Fixture payload too large'); }
    return data ? JSON.parse(data) : {};
  };
  const send = (res, data, status = 200) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(data)); return true; };
  const rows = () => prisma.post.findMany({ where: { organizationId: fixture.organization.id }, include: { integration: true }, orderBy: { createdAt: 'asc' } });
  const publicPost = post => ({ ...post, integration: { id: post.integration.id, name: post.integration.name, providerIdentifier: 'facebook', picture: '' }, tags: [], image: JSON.parse(post.image || '[]') });
  return { async handle(req, res, target, token) {
    const pathname = target.pathname;
    if (!pathname.startsWith('/__facebook/') && !/(?:^|;\s*)facebook-fixture=1(?:;|$)/.test(req.headers.cookie || '')) return false;
    const management = /^\/posts\/([^/]+)\/facebook-published(\/reconcile)?$/.exec(pathname);
    const submission = /^\/posts\/submissions\/([^/]+)$/.exec(pathname);
    const handled = pathname.startsWith('/__facebook/') || fixture && (submission || management || ['/user/self', '/user/organizations', '/integrations/list', '/integrations', '/posts', '/posts/list'].includes(pathname) || pathname.startsWith('/posts/group/') || /^\/posts\/[^/]+$/.test(pathname) && !['/posts/tags', '/posts/find-slot'].includes(pathname));
    if (!handled) return false;
    const auth = req.headers.auth || /(?:^|;\s*)auth=([^;]+)/.exec(req.headers.cookie || '')?.[1];
    if (auth !== token) return send(res, {}, 401);
    if (pathname === '/__facebook/reset' && req.method === 'POST') return send(res, await reset(await jsonBody(req)));
    if (!fixture) return send(res, {}, 409);
    if (submission) {
      if (req.method !== 'GET') return send(res, {}, 405);
      return send(res, await controller.reconcileSubmission(fixture.organization, decodeURIComponent(submission[1])));
    }
    if (pathname === '/__facebook/evidence') return send(res, { calls, reads, posts: (await rows()).map(publicPost), remote: [...remote].map(([id, message]) => ({ id, message })) });
    if (pathname === '/__facebook/mode' && req.method === 'POST') { mode = (await jsonBody(req)).mode; return send(res, {}); }
    if (management) {
      const result = req.method === 'GET' ? await controller.facebookPublishedStatus(fixture.organization, management[1])
        : management[2] ? await controller.reconcileFacebookPublished(fixture.organization, management[1])
        : await controller.mutateFacebookPublished(fixture.organization, management[1], await jsonBody(req));
      return send(res, result);
    }
    if (pathname === '/user/self') return send(res, { id: 'synthetic-user', orgId: fixture.organization.id, name: 'Synthetic Creator', email: 'fixture@example.test', role: fixture.organization.users[0].role, tier: 'STANDARD', totalChannels: 2, publicApi: '', allowTrial: false });
    if (pathname === '/user/organizations') return send(res, [{ id: fixture.organization.id, name: fixture.organization.name }]);
    if (pathname.startsWith('/integrations')) {
      const integrations = fixture.accounts.map(account => ({ id: account.id, name: account.name, identifier: 'facebook', type: 'social', editor: 'normal', picture: '', additionalSettings: '[]', time: [], inBetweenSteps: false, publishedCapabilities: provider.getPublishedCapabilities(account) }));
      return send(res, pathname.endsWith('/list') ? { integrations } : integrations);
    }
    if (pathname === '/posts/should-shortlink' && req.method === 'POST') return send(res, await controller.shouldShortlink(await jsonBody(req)));
    if (pathname === '/posts' && req.method === 'POST') return send(res, await controller.createPost(fixture.organization, await jsonBody(req)));
    if (req.method !== 'GET') return send(res, {}, 405);
    reads++;
    const posts = (await rows()).map(publicPost);
    if (pathname.startsWith('/posts/group/')) {
      const selected = posts.filter(post => post.group === pathname.split('/').pop());
      return send(res, { group: selected[0]?.group, integration: selected[0]?.integrationId, integrationPicture: '', settings: JSON.parse(selected[0]?.settings || '{}'), posts: selected });
    }
    if (pathname === '/posts' || pathname === '/posts/list') return send(res, { posts, total: posts.length, page: 0, limit: 100, hasMore: false });
    return send(res, { posts: posts.filter(post => post.id === pathname.split('/').pop()) });
  } };
};
