// Owned offline acceptance: real editing/local storage, synthetic tenant repositories.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { createHash, randomUUID } = require('node:crypto');
module.exports = function videoEditorRuntime(fixtureOptions = {}) {
  const frontendPort = fixtureOptions.cooked ? '4547' : '4347', apiPort = fixtureOptions.cooked ? '4548' : '4348';
  if (process.env[fixtureOptions.cooked ? 'EP_COOKED_BROWSER' : 'EP_VIDEO_EDITOR_BROWSER'] !== '1' || process.env.BROWSER_FRONTEND_PORT !== frontendPort || process.env.BROWSER_API_PORT !== apiPort) throw new Error('Editor fixture requires its exact owned ports');
  // No ambient credentials/configuration reach imported services or subprocesses.
  const clean = Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'EP_VIDEO_EDITOR_BROWSER', 'EP_COOKED_BROWSER', 'COOKED_EDITOR_SOCKET', 'BROWSER_FRONTEND_PORT', 'BROWSER_API_PORT'].filter(k => process.env[k] !== undefined).map(k => [k, process.env[k]]));
  process.env = clean;
  require('./network-guard.cjs');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ep-editor-browser-'));
  const marker = randomUUID(), markerPath = path.join(directory, '.owned-fixture');
  fs.writeFileSync(markerPath, marker, { flag: 'wx' });
  Object.assign(process.env, { STORAGE_PROVIDER: 'local', UPLOAD_DIRECTORY: directory, FRONTEND_URL: 'http://127.0.0.1:' + frontendPort });
  const sourceFile = path.join(directory, 'source.mp4');
  // Two owned speech blocks with quiet separation and frame-aligned ends.
  if (fixtureOptions.cooked) execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:size=640x360:rate=25:duration=16',
    '-f', 'lavfi', '-i', 'flite=text=We record one useful video and explain the first step.:voice=slt',
    '-f', 'lavfi', '-i', 'flite=text=The original always stays available while we review the next step.:voice=slt',
    '-filter_complex', '[1:a]apad=whole_dur=6[a1];[2:a]apad=whole_dur=6[a2];[a1][a2]concat=n=2:v=0:a=1,adelay=1500,apad,atrim=duration=16[a]',
    '-map', '0:v', '-map', '[a]', '-c:v', 'libx264', '-threads', '2', '-c:a', 'aac', '-t', '16', sourceFile], { timeout: 15000, env: clean });
  else execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=size=160x120:duration=4', '-f', 'lavfi', '-i', 'sine=duration=4', '-filter:a', "volume=0:enable='between(t,1,3)'", '-c:v', 'libx264', '-threads', '2', '-c:a', 'aac', '-shortest', sourceFile], { timeout: 15000, env: clean });
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  const sourceBytes = fs.readFileSync(sourceFile), originalHash = hash(sourceBytes);
  if (sourceBytes.length > 1024 * 1024) throw new Error('Synthetic source exceeds fixture bound');
  const root = path.resolve(__dirname, '../..'), ts = require('typescript');
  const options = require(path.join(root, 'tsconfig.base.json')).compilerOptions;
  require('tsconfig-paths').register({ baseUrl: root, paths: options.paths });
  require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { ...options, module: ts.ModuleKind.CommonJS, emitDecoratorMetadata: false } }).outputText, file);
  require('reflect-metadata');
  const { VideoEditorService } = require('../../libraries/nestjs-libraries/src/media-editing/video-editor.service.ts');
  const { FfmpegVideoEditorService } = require('../../libraries/nestjs-libraries/src/media-editing/ffmpeg-video-editor.service.ts');
  const media = new Map(), assets = new Map();
  let sequence = 0, active = 0, peak = 0, renders = 0, postWrites = 0, session, cleanupRequested = false;
  function cleanup() {
    cleanupRequested = true;
    if (active) return; // Finish the owned render before removing its files.
    const resolved = path.resolve(directory);
    if (!fs.existsSync(resolved)) return;
    if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('ep-editor-browser-') || fs.readFileSync(markerPath, 'utf8') !== marker) throw new Error('Owned cleanup boundary failed');
    fs.rmSync(resolved, { recursive: true, force: true });
  }
  process.once('exit', cleanup);
  const browserPath = id => '/backend-api/__video-editor/assets/' + encodeURIComponent(id) + '.mp4';
  const addSource = (id, file, name) => {
    const item = { id, organizationId: 'synthetic-org', name, originalName: name, type: 'video', path: file, thumbnail: null, alt: null };
    media.set(id, item); assets.set(id, file); return { ...item, path: browserPath(id) };
  };
  const visible = item => ({ ...item, path: browserPath(item.id) });
  addSource('editor-source', sourceFile, 'Owned talking head.mp4');
  const repository = {
    getMediaByOrganizationIdAndId: async (org, id) => org === 'synthetic-org' && media.has(id) ? { ...media.get(id), path: assets.get(id) } : null,
    saveFile: async (org, name, storagePath, originalName) => {
      if (org !== 'synthetic-org') throw new Error('Foreign fixture tenant');
      const relative = new URL(storagePath).pathname.replace(/^\/uploads\//, '');
      const file = path.resolve(directory, relative);
      if (!file.startsWith(directory + path.sep) || !fs.statSync(file).isFile()) throw new Error('Unexpected output path');
      const id = 'editor-output-' + (++sequence);
      const item = { id, organizationId: org, name, originalName, path: browserPath(id), type: 'video', thumbnail: null, alt: null };
      media.set(id, item); assets.set(id, file); return item;
    },
  };
  const service = new VideoEditorService(repository, { getCurrentForActiveMedia: async () => null }, new FfmpegVideoEditorService());
  const cooked = fixtureOptions.cooked ? require('./cooked-browser-auth.cjs')(repository, new FfmpegVideoEditorService(), process.env.FRONTEND_URL) : undefined;
  const json = (res, body, status = 200) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
  const read = async (req, limit = 16384) => { const chunks = []; let size = 0; for await (const chunk of req) { size += chunk.length; if (size > limit) throw Object.assign(new Error('Fixture payload too large'), { status: 413 }); chunks.push(chunk); } return Buffer.concat(chunks); };
  const body = async req => JSON.parse(String(await read(req)) || '{}');
  return {
    token: cooked?.token,
    async handle(req, res, url, token) {
      if (cooked && await cooked.handle(req, res, url)) return true;
      // Known generated public assets carry no auth requirement; never accept a path.
      const asset = /^\/__video-editor\/assets\/([a-z0-9-]+)\.mp4$/.exec(url.pathname);
      if (asset && req.method === 'GET') {
        const file = assets.get(decodeURIComponent(asset[1]));
        if (!file) { json(res, {}, 404); return true; }
        res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': fs.statSync(file).size, 'cache-control': 'no-store' });
        fs.createReadStream(file).pipe(res); return true;
      }
      const recognized = url.pathname.startsWith('/__video-editor') || url.pathname.startsWith('/media') || url.pathname === '/integrations/list' || (url.pathname === '/posts' && req.method !== 'GET');
      if (!recognized) return false;
      const auth = req.headers.auth || /(?:^|;\s*)auth=([^;]+)/.exec(req.headers.cookie || '')?.[1];
      if (auth !== token) { json(res, {}, 401); return true; }
      if (url.pathname === '/posts' && req.method !== 'GET') { postWrites++; json(res, { message: 'Publishing forbidden' }, 405); return true; }
      try {
        if (url.pathname === '/media/cooked/status') { json(res, { enabled: false }); return true; }
        if (url.pathname === '/__video-editor/stats') { json(res, { renders, active, peak, postWrites, originalHash, currentHash: hash(fs.readFileSync(sourceFile)), uploaded: !!session?.media, uploadedHash: session?.media ? hash(fs.readFileSync(assets.get(session.media.id))) : null, outputIds: [...media.keys()].filter(k => k.startsWith('editor-output-')) }); return true; }
        if (url.pathname === '/__video-editor/reset' && req.method === 'POST') {
          if (active) { json(res, { message: 'Active render prevents reset' }, 409); return true; }
          // Reset only mappings/counters; owned files are removed once during teardown.
          for (const id of [...media.keys()]) if (id !== 'editor-source') { media.delete(id); assets.delete(id); }
          renders = peak = postWrites = 0; session = undefined; json(res, {}); return true;
        }
        if (url.pathname === '/integrations/list') { json(res, { integrations: [{ id: 'fixture-channel', providerIdentifier: 'x', identifier: 'x', type: 'social', name: 'Fixture account', picture: '/icons/platforms/x.png', disabled: false }] }); return true; }
        if (url.pathname === '/media/uploads' && req.method === 'GET') { json(res, { sessions: session ? [session] : [], durableQuickUploadEnabled: false }); return true; }
        if (url.pathname === '/media/uploads' && req.method === 'POST') {
          const input = await body(req);
          if (session || input.organizationId !== 'synthetic-org' || input.byteSize !== sourceBytes.length || input.manifest?.length !== 1 || input.manifest[0] !== originalHash) { json(res, { message: 'Only the bounded synthetic fixture upload is accepted' }, 400); return true; }
          session = { ...input, id: 'editor-upload-session', status: 'UPLOADING', parts: [] }; json(res, session); return true;
        }
        if (url.pathname === '/media/uploads/editor-upload-session/parts/0' && req.method === 'PUT') {
          const bytes = await read(req, 1024 * 1024);
          if (!session || hash(bytes) !== originalHash) { json(res, {}, 400); return true; }
          fs.writeFileSync(path.join(directory, 'uploaded.mp4'), bytes);
          session.parts = [{ index: 0, byteSize: bytes.length, digest: originalHash }]; json(res, session); return true;
        }
        if (url.pathname === '/media/uploads/editor-upload-session/complete' && req.method === 'POST') {
          if (!session?.parts.length) { json(res, {}, 409); return true; }
          session.media = addSource('editor-uploaded', path.join(directory, 'uploaded.mp4'), session.originalName);
          session.status = 'COMPLETE'; json(res, session); return true;
        }
        if (url.pathname === '/media/uploads/editor-upload-session' && req.method === 'GET') { json(res, session || {}, session ? 200 : 404); return true; }
        if (url.pathname === '/media/video-options' && req.method === 'GET') { json(res, []); return true; }
        if ((url.pathname === '/media' || url.pathname === '/media/post-attached') && req.method === 'GET') { json(res, { pages: 1, results: [...media.values()].map(visible) }); return true; }
        const render = /^\/media\/([^/]+)\/video-edits$/.exec(url.pathname);
        if (render && req.method === 'POST') {
          const input = await body(req); const source = assets.get(decodeURIComponent(render[1])); const before = source ? hash(fs.readFileSync(source)) : null; renders++; active++; peak = Math.max(peak, active);
          try { const result = await service.create('synthetic-org', decodeURIComponent(render[1]), input); if (hash(fs.readFileSync(sourceFile)) !== originalHash || hash(fs.readFileSync(source)) !== before) throw new Error('Source changed'); json(res, result, 201); }
          finally { active--; if (cleanupRequested) cleanup(); }
          return true;
        }
        const item = /^\/media\/([^/]+)$/.exec(url.pathname);
        if (item && req.method === 'GET') { const found = media.get(decodeURIComponent(item[1])); json(res, found ? visible(found) : {}, found ? 200 : 404); return true; }
        json(res, {}, 404); return true;
      } catch (error) { json(res, error.getResponse?.() || { message: error.message }, error.getStatus?.() || error.status || 500); return true; }
    },
    cleanup,
  };
};
