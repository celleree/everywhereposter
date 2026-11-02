const fs = require('node:fs'), path = require('node:path'), child = require('node:child_process');
const { createHash, randomUUID } = require('node:crypto');
// Explicit offline fixture: only the paid completion is synthetic.
module.exports = function studioBrowserRuntime() {
  const keys = ['PATH', 'HOME', 'TMPDIR', 'EP_STUDIO_BROWSER', 'BROWSER_FRONTEND_PORT', 'BROWSER_API_PORT', 'STUDIO_BROWSER_FIXTURE_ROOT',
    'STUDIO_BROWSER_DATABASE_URL', 'STUDIO_BROWSER_REPLAY', 'STUDIO_EDITOR_PACKAGE_ROOT', 'STUDIO_EDITOR_RUNTIME', 'STUDIO_EDITOR_V2_PACKAGE_ROOT', 'STUDIO_EDITOR_V2_RUNTIME'];
  process.env = Object.fromEntries(keys.filter(k => process.env[k] !== undefined).map(k => [k, process.env[k]]));
  const base = process.env.STUDIO_BROWSER_FIXTURE_ROOT, origin = 'http://127.0.0.1:4647';
  if (process.env.EP_STUDIO_BROWSER !== '1' || process.env.BROWSER_FRONTEND_PORT !== '4647' || process.env.BROWSER_API_PORT !== '4648' ||
      !/^\/tmp\/ep-studio-ui\.[a-zA-Z0-9_]+$/.test(base || '') ||
      process.env.STUDIO_BROWSER_DATABASE_URL !== 'postgresql://isolated:isolated@127.0.0.1:55462/isolated') throw Error('Exact owned Studio fixture required');
  const marker = path.join(base, '.owned-fixture.json');
  if (fs.realpathSync(base) !== base || fs.lstatSync(marker).isSymbolicLink()) throw Error('Owned fixture root required');
  const ownership = JSON.parse(fs.readFileSync(marker, 'utf8'));
  if (ownership.owner !== 'studio-source-only-acceptance' || ownership.root !== base) throw Error('Owned fixture marker required');
  for (const name of ['uploads', 'private', 'ipc']) {
    const dir = path.join(base, name);
    if (!fs.statSync(dir).isDirectory() || fs.lstatSync(dir).isSymbolicLink()) throw Error('Stage owned fixture directories');
  }
  const retained = process.env.STUDIO_BROWSER_REPLAY === '1' ? JSON.parse(fs.readFileSync(path.join(base, 'retained-fixture.json'), 'utf8')) : undefined;
  if (retained && (!/^studio-browser-[a-f0-9-]{36}$/.test(retained.orgId) || !/^studio-user-[a-f0-9-]{36}$/.test(retained.userId) ||
      !/^studio-other-user-[a-f0-9-]{36}$/.test(retained.otherUser) || retained.jobs?.length !== 1)) throw Error('Owned retained fixture required');
  const orgId = retained?.orgId || 'studio-browser-' + randomUUID(), userId = retained?.userId || 'studio-user-' + randomUUID(),
    otherOrg = 'studio-other-' + randomUUID(), otherUser = retained?.otherUser || 'studio-other-user-' + randomUUID();
  const uploads = path.join(base, 'uploads'), work = path.join(base, 'private');
  Object.assign(process.env, { DATABASE_URL: process.env.STUDIO_BROWSER_DATABASE_URL, STORAGE_PROVIDER: 'local', UPLOAD_DIRECTORY: uploads,
    FRONTEND_URL: origin, NOT_SECURED: 'true', JWT_SECRET: 'isolated-studio-browser-signing-key-not-production',
    STUDIO_EDITOR_ENABLED: 'true', STUDIO_EDITOR_V2_ENABLED: 'true', STUDIO_EDITOR_ORGANIZATIONS: orgId, STUDIO_EDITOR_WORK_ROOT: work,
    COOKED_EDITOR_ENABLED: 'true', COOKED_EDITOR_ORGANIZATIONS: orgId, COOKED_EDITOR_SOCKET: path.join(base, 'ipc/cooked.sock'),
    BILLING_ENABLED: 'true', AI_WALLET_ENABLED: 'true', AI_WALLET_TEXT_ENABLED: 'true',
    AI_WALLET_TEXT_RATE_CARDS: JSON.stringify({ 'gpt-6-luna': { billingContext: 'standard-text-receipt-no-extra-charges',
      rateVersion: 'synthetic-browser-v1', per: '1', rates: { inputUncachedLow: '2', inputCachedLow: '1', outputLow: '5',
        inputUncachedHigh: '4', inputCachedHigh: '2', outputHigh: '8' } } }) });
  require('./network-guard.cjs');
  const root = path.resolve(__dirname, '../..'), ts = require('typescript'), options = require(path.join(root, 'tsconfig.base.json')).compilerOptions;
  require('tsconfig-paths').register({ baseUrl: root, paths: options.paths });
  require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'),
    { compilerOptions: { ...options, module: ts.ModuleKind.CommonJS, emitDecoratorMetadata: false } }).outputText, file);
  require('reflect-metadata');
  const counters = retained ? { nativeDispatches: retained.nativeDispatches, paidCompletions: retained.paidCompletions, postWrites: retained.postWrites }
    : { nativeDispatches: 0, paidCompletions: 0, postWrites: 0 }, commands = retained?.commands || [];
  const spawn = child.spawn;
  child.spawn = function(executable, args, ...rest) {
    const record = { executable, args };
    if (args.some(v => /(?:prepare\.py|run\.mjs|qa\.py|receipt-bindings\.mjs|title-layout)/.test(String(v)))) commands.push(record);
    const proc = spawn.call(this, executable, args, ...rest);
    proc.stderr?.on('data', chunk => { record.stderr = ((record.stderr || '') + chunk).slice(-2048); });
    proc.once('close', code => { record.exitCode = code; });
    return proc;
  };
  const execFile = child.execFile;
  child.execFile = function(executable, args, ...rest) {
    commands.push({ executable, args });
    return execFile.call(this, executable, args, ...rest);
  };
  child.execFile[require('node:util').promisify.custom] = (...args) => new Promise((resolve, reject) => {
    child.execFile(...args, (error, stdout, stderr) => error ? reject(error) : resolve({ stdout, stderr }));
  });
  const load = file => require('../../' + file);
  const { PrismaClient } = require('@prisma/client');
  const db = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } }), repository = { model: db };
  const { SubscriptionRepository } = load('libraries/nestjs-libraries/src/database/prisma/subscriptions/subscription.repository.ts');
  const subscriptions = new SubscriptionRepository(repository, repository, repository, repository, repository);
  const { AiWalletService } = load('libraries/nestjs-libraries/src/database/prisma/ai-wallet/ai-wallet.service.ts');
  const { AiWalletTextService } = load('libraries/nestjs-libraries/src/services/ai-wallet-text.service.ts');
  const { StudioEditRepository } = load('libraries/nestjs-libraries/src/media-editing/studio-edit.repository.ts');
  const { StudioEditService } = load('libraries/nestjs-libraries/src/media-editing/studio-edit.service.ts');
  const { StudioDirectorService } = load('libraries/nestjs-libraries/src/media-editing/studio-director.service.ts');
  const { CookedReviewService } = load('libraries/nestjs-libraries/src/media-editing/cooked-review.service.ts');
  const { CookedWorkerClient } = load('libraries/nestjs-libraries/src/media-editing/cooked-worker-client.ts');
  const { FfmpegVideoEditorService } = load('libraries/nestjs-libraries/src/media-editing/ffmpeg-video-editor.service.ts');
  const { MediaController } = load('apps/backend/src/api/routes/media.controller.ts');
  const { AuthService } = load('libraries/helpers/src/auth/auth.service.ts');
  const { AuthMiddleware } = load('apps/backend/src/services/auth/auth.middleware.ts');
  const { PoliciesGuard } = load('apps/backend/src/services/auth/permissions/permissions.guard.ts');
  const { PermissionsService } = load('apps/backend/src/services/auth/permissions/permissions.service.ts');
  const { Reflector } = require('@nestjs/core');
  const nativeCreate = CookedWorkerClient.prototype.create;
  CookedWorkerClient.prototype.create = function(...args) { if (retained) throw Error('Retained fixture forbids new native dispatch'); counters.nativeDispatches++; return nativeCreate.apply(this, args); };
  const wallet = new AiWalletService(repository), director = new StudioDirectorService(new AiWalletTextService(wallet), subscriptions);
  director.invoke = async request => {
    if (retained) throw Error('Retained fixture forbids new completion');
    if (!commands.some(c => c.args?.includes('title-preflight-check'))) throw Error('Measured title preflight required before metering');
    commands.push({ kind: 'synthetic-completion', usage: { prompt_tokens: 10, completion_tokens: 3, cached_tokens: 2 } });
    counters.paidCompletions++;
    if (counters.paidCompletions !== 1 || request.model !== 'gpt-6-luna') throw Error('Only one synthetic paid completion allowed');
    return { id: randomUUID(), model: request.model, service_tier: 'default',
      choices: [{ finish_reason: 'stop', message: { parsed: { summary: 'We make art. You can too.', effects: [], broll: [] } } }],
      usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13,
        prompt_tokens_details: { cached_tokens: 2 }, completion_tokens_details: { reasoning_tokens: 1 } } };
  };
  const media = { getMediaByOrganizationIdAndId: (org, id) => db.media.findFirst({ where: { organizationId: org, id, deletedAt: null } }) };
  const service = new StudioEditService(new StudioEditRepository(db), db, new CookedReviewService(media, new FfmpegVideoEditorService()), director);
  const controller = new MediaController({}, {}, {}, {}, {}, {}, service);
  const middleware = new AuthMiddleware({ getOrgsByUserId: id => db.organization.findMany({
    where: { users: { some: { userId: id } } }, include: { users: { where: { userId: id } } } }) }, {});
  const guard = new PoliciesGuard(new Reflector(), new PermissionsService(subscriptions, {}, {}, {}, wallet));
  const token = AuthService.signJWT({ id: userId, activated: true, isSuperAdmin: false });
  const otherToken = AuthService.signJWT({ id: otherUser, activated: true, isSuperAdmin: false });
  const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex'), source = path.join(uploads, 'source.mp4');
  // This generator and the browser's framing confirmation are synthetic, not face detection.
  if (!fs.existsSync(source)) child.execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=360x640:rate=30:duration=10',
    '-f', 'lavfi', '-i', 'flite=text=We make art.:voice=slt',
    '-f', 'lavfi', '-i', 'flite=text=You can too.:voice=slt',
    '-filter_complex', '[1:a]atempo=0.6,adelay=400,apad=whole_dur=4[a1];[2:a]atempo=0.8,apad=whole_dur=6[a2];[a1][a2]concat=n=2:v=0:a=1[a]',
    '-map', '0:v', '-map', '[a]', '-c:v', 'libx264', '-threads', '2', '-c:a', 'aac', '-t', '10', '-movflags', '+faststart', source],
    { timeout: 30000, env: process.env });
  const originalHash = hash(source), audioProof = new Map();
  const pcmHash = file => child.execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-map', '0:a:0', '-c:a', 'pcm_s16le', '-f', 'hash', '-hash', 'sha256', '-'],
    { timeout: 30000, encoding: 'utf8', env: process.env }).trim().split('=').pop();
  let retainedState;
  const initialized = (async () => {
    await db.$connect();
    if (retained) {
      const member = await db.userOrganization.findFirst({ where: { userId, organizationId: orgId, disabled: false } });
      const job = await db.studioEditJob.findFirst({ where: { id: retained.jobs[0].id, organizationId: orgId, sourceMediaId: 'source-' + orgId, state: { in: ['TECHNICAL_READY', 'REVIEWED'] } } });
      if (!member || !job || originalHash !== retained.originalHash || job.artifactSha256 !== retained.artifacts[0]?.sha256) throw Error('Retained fixture SQL/source binding changed');
      retainedState = job.state; return;
    }
    if (await db.organization.count({ where: { id: { in: [orgId, otherOrg] } } })) throw Error('Owned fixture namespace already exists');
    for (const [org, user] of [[orgId, userId], [otherOrg, otherUser]]) {
      await db.user.create({ data: { id: user, email: user + '@example.test', providerName: 'LOCAL', timezone: 0 } });
      await db.organization.create({ data: { id: org, name: 'Owned Studio fixture', apiKey: 'synthetic-fixture-only',
        paymentId: 'cus_' + org, users: { create: { userId: user, role: 'ADMIN' } },
        subscription: { create: { subscriptionTier: 'LAUNCH_V1', totalChannels: 0, period: 'MONTHLY' } } } });
    }
    await db.aiWallet.create({ data: { organizationId: orgId, balanceNanos: 100000000n } });
    await db.media.create({ data: { id: 'source-' + orgId, name: 'Owned portrait source.mp4', originalName: 'Owned portrait source.mp4',
      organizationId: orgId, type: 'video', fileSize: fs.statSync(source).size, path: origin + '/uploads/source.mp4' } });
  })();
  initialized.catch(error => console.error('STUDIO_FIXTURE_INIT_FAILED ' + error.message));
  const json = (res, value, status = 200) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(value, (_, v) => typeof v === 'bigint' ? v.toString() : v)); };
  const read = async req => { let text = ''; for await (const chunk of req) { text += chunk; if (text.length > 16384) throw Error('Fixture body bound'); } return JSON.parse(text || '{}'); };
  async function stats() {
    const jobs = await db.studioEditJob.findMany({ where: { organizationId: orgId } }), outputs = await db.media.findMany({ where: { organizationId: orgId, id: { not: 'source-' + orgId } } }), files = {};
    for (const row of jobs) {
      const dir = path.join(work, row.id, 'g' + row.generation);
      const aligned = path.join(dir, 'cooked-audio.mp4');
      if (fs.existsSync(aligned) && !audioProof.has(row.id)) audioProof.set(row.id, { sourcePcmSha256: pcmHash(source), alignedPcmSha256: pcmHash(aligned) });
      const names = fs.existsSync(dir) ? [...fs.readdirSync(dir).filter(n => /\.json$/.test(n)),
        'project/render-receipt.json', 'project/qa/final-verification.json', 'title-candidate/title-preflight.json'] : [];
      for (const name of names) {
        const file = path.join(dir, name);
        if (fs.existsSync(file) && fs.statSync(file).size < 2 * 1024 * 1024) files[name] = { path: file, sha256: hash(file), value: JSON.parse(fs.readFileSync(file)) };
      }
    }
    const artifacts = jobs.map(row => path.join(work, row.id, 'g' + row.generation, 'project/final.mp4')).filter(file => fs.existsSync(file))
      .map(file => ({ path: file, sha256: hash(file), bytes: fs.statSync(file).size }));
    return { ...counters, instrumentationOrigin: retained ? 'PERSISTED_FIRST_PROCESS_SNAPSHOT' : 'CURRENT_PROCESS', commands, artifacts, audioProof: [...audioProof.values()], originalHash, currentHash: hash(source), jobs, outputs, files,
      operations: await db.aiWalletReservation.findMany({ where: { organizationId: orgId } }), ledger: await db.aiWalletLedger.findMany({ where: { organizationId: orgId } }) };
  }
  return { token, user: { id: userId, orgId }, ready: initialized, cleanup() { void db.$disconnect(); }, async handle(req, res, url) {
    if (url.pathname === '/__studio/session' && req.method === 'GET') { await initialized; json(res, { token, otherToken, scope: encodeURIComponent(userId) + ':' + encodeURIComponent(orgId),
      replay: retained ? { jobId: retained.jobs[0].id, reviewed: retainedState === 'REVIEWED', request: retained.jobs[0].input.request } : null }); return true; }
    if (!url.pathname.startsWith('/media') && !url.pathname.startsWith('/__studio') && !url.pathname.startsWith('/uploads/') &&
        url.pathname !== '/integrations/list' && !/^\/posts(?:\/|$)/.test(url.pathname)) return false;
    try {
      await initialized;
      req.cookies = Object.fromEntries(String(req.headers.cookie || '').split(';').map(v => v.trim().split('=')).filter(v => v.length === 2));
      req.path = url.pathname; req.query = Object.fromEntries(url.searchParams); req.body = req.method === 'POST' ? await read(req) : undefined;
      await middleware.use(req, res, () => {});
      if (/^\/posts(?:\/|$)/.test(url.pathname)) {
        if (req.method === 'GET') return false;
        counters.postWrites++; json(res, { message: 'Publishing forbidden' }, 405); return true;
      }
      if (url.pathname === '/__studio/stats') { json(res, await stats()); return true; }
      if (url.pathname === '/integrations/list') { json(res, { integrations: [{ id: 'fixture-channel', providerIdentifier: 'x', identifier: 'x',
        type: 'social', name: 'Fixture account', picture: '/icons/platforms/x.png', disabled: false }] }); return true; }
      const owned = await db.media.findMany({ where: { organizationId: req.org.id, deletedAt: null } });
      if (url.pathname.startsWith('/uploads/')) {
        const item = owned.find(m => new URL(m.path).pathname === url.pathname);
        if (!item || req.method !== 'GET') { json(res, {}, 404); return true; }
        const file = path.resolve(uploads, '.' + url.pathname.slice('/uploads'.length));
        if (!file.startsWith(uploads + path.sep)) throw Error('Invalid owned asset');
        res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': fs.statSync(file).size }); fs.createReadStream(file).pipe(res); return true;
      }
      if (['/media', '/media/post-attached'].includes(url.pathname)) { json(res, { pages: 1, results: owned }); return true; }
      if (url.pathname === '/media/cooked/status') { json(res, { enabled: false }); return true; }
      if (url.pathname === '/media/uploads') { json(res, { sessions: [], durableQuickUploadEnabled: false }); return true; }
      if (url.pathname === '/media/video-options') { json(res, []); return true; }
      const item = /^\/media\/([^/]+)$/.exec(url.pathname);
      if (item) { const value = owned.find(m => m.id === item[1]); json(res, value || {}, value ? 200 : 404); return true; }
      const match = /^\/media\/studio\/(status|framing\/([^/]+)|jobs(?:\/([^/]+)(?:\/(preview|review|resume))?)?)$/.exec(url.pathname);
      if (!match) { json(res, {}, 404); return true; }
      const [, route, sourceId, job, view] = match, method = req.method;
      const action = route === 'status' && method === 'GET' ? 'studioAvailability' : sourceId && method === 'GET' ? 'studioFraming' :
        !job ? method === 'GET' ? 'studioJobs' : method === 'POST' ? 'createStudio' : undefined :
        view === 'preview' && method === 'GET' ? 'studioPreview' : view === 'review' && method === 'POST' ? 'reviewStudio' :
        view === 'resume' && method === 'POST' ? 'resumeStudio' : !view && method === 'GET' ? 'studioJob' : undefined;
      if (!action) { json(res, {}, 405); return true; }
      await guard.canActivate({ getHandler: () => controller[action], switchToHttp: () => ({ getRequest: () => req }) });
      let value;
      if (action === 'studioAvailability' || action === 'studioJobs') value = await controller[action](req.org);
      else if (action === 'studioFraming') value = await controller[action](req.org, sourceId);
      else if (action === 'createStudio') value = await controller[action](req.org, req.body, req);
      else if (action === 'reviewStudio') value = await controller[action](req.org, req.user, job, req.body, req);
      else if (action === 'studioJob') value = await controller[action](req.org, job);
      else if (action === 'resumeStudio') value = await controller[action](req.org, job, req);
      else {
        res.type = type => { res.setHeader('content-type', type); return res; }; res.status = status => { res.statusCode = status; return res; };
        await controller.studioPreview(req.org, job, req, res); return true;
      }
      json(res, value); return true;
    } catch (error) {
      console.error('STUDIO_FIXTURE_REJECT ' + JSON.stringify({ status: error.getStatus?.() || 500, message: error.message }));
      if (!res.headersSent) json(res, { message: error.message }, error.getStatus?.() || 500); else res.destroy();
      return true;
    }
  } };
};
