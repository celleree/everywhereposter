const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const net = require('node:net');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '../..');
const origin = 'http://127.0.0.1:4217';
const token = 'synthetic-playwright-session';
const branding = path.join(root, 'apps/frontend/public/branding');
const brandingSource = path.resolve(root, '../site/branding');
// Refuse accidental execution inside a checkout carrying live environment files.
for (const dir of [root, path.dirname(root), path.join(root, 'apps/frontend')]) {
  for (const name of fs.readdirSync(dir)) {
    if (/^\.env($|\.)/.test(name) && !['.env.example', '.env.sample'].includes(name)) {
      throw new Error('Isolated browser runtime refuses environment files: ' + dir);
    }
  }
}
const user = { id: 'synthetic-user', orgId: 'synthetic-org', email: 'fixture@example.test', name: 'Synthetic Creator', role: 'ADMIN', tier: 'STANDARD', publicApi: '', totalChannels: 0, admin: false, allowTrial: false, isTrailing: false, impersonate: false, streakSince: null };
const posts = Array.from({ length: 18 }, (_, index) => ({ id: `synthetic-post-${index}`, group: `synthetic-group-${index}`, state: 'QUEUE', content: `Synthetic scheduled post ${index + 1}: a long caption for responsive scrolling and reachability checks.`, publishDate: '2035-01-01T18:00:00.000Z', tags: [], intervalInDays: null, integration: { id: 'synthetic-channel', name: 'Synthetic channel', providerIdentifier: 'x', picture: '/icons/platforms/x.png' } }));
const values = {
  '/user/self': user,
  '/user/organizations': [{ id: 'synthetic-org', name: 'Synthetic workspace' }],
  '/integrations/list': { integrations: [] },
  '/integrations': [],
  '/announcements': [],
  '/notifications': { total: 0 },
  '/notifications/list': { notifications: [], total: 0 },
  '/media': { pages: 0, results: [] },
  '/media/post-attached': { pages: 0, results: [] },
  '/posts/list': { posts, total: posts.length, page: 0, limit: 100, hasMore: false },
  '/posts': { posts },
  '/tags': [],
  '/customers': [],
  '/settings': {},
  '/settings/shortlink': { shortlink: 'ASK' },
  '/signatures/default': {},
  '/third-party': [],
  '/media/video-options': [],
  '/posts/tags': [],
  '/sets': [],
  '/posts/find-slot': { date: '2035-01-01T18:00:00.000Z' },
  '/billing/check': {},
  '/auth/can-register': { register: false },
};
let frontend;
let ready = false;
let stopping = false;
let createdBranding = false;
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1:4218');
  if (req.method !== 'GET') { res.writeHead(405); return res.end('Fixture mutations are disabled'); }
  if (url.pathname === '/__ready') { res.writeHead(ready ? 200 : 503); return res.end('synthetic fixture readiness'); }
  const auth = req.headers.auth || /(?:^|;\s*)auth=([^;]+)/.exec(req.headers.cookie || '')?.[1];
  if (url.pathname !== '/auth/can-register' && auth !== token) { res.writeHead(401); return res.end('{}'); }
  if (!Object.hasOwn(values, url.pathname)) { console.log('UNHANDLED_FIXTURE_GET ' + url.pathname); res.writeHead(404); return res.end('{}'); }
  res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(values[url.pathname]));
});
// Reserve the frontend port before starting or sending synthetic cookies.
const reservation = net.createServer();
reservation.once('error', error => { console.error('Frontend port unavailable: ' + error.code); process.exitCode = 1; });
server.once('error', error => { reservation.close(); console.error('Fixture API port unavailable: ' + error.code); process.exitCode = 1; });
reservation.listen(4217, '127.0.0.1', () => {
  if (stopping) { reservation.close(); return; }
  server.listen(4218, '127.0.0.1', () => reservation.close(startFrontend));
});
function startFrontend() {
  if (stopping) { server.close(); return; }
  if (!fs.existsSync(branding)) fs.symlinkSync(brandingSource, branding, 'dir');
  // Recover only our exact link after an interrupted prior run in this owned worktree.
  createdBranding = fs.lstatSync(branding).isSymbolicLink() && fs.readlinkSync(branding) === brandingSource;
  // No .env loader, real API credentials, DB URL, workers, or migrations.
  const env = {
    PATH: process.env.PATH, HOME: process.env.HOME,
    NODE_ENV: 'development', NEXT_TELEMETRY_DISABLED: '1',
    FRONTEND_URL: origin, MAIN_URL: origin, NOT_SECURED: 'true',
    BACKEND_INTERNAL_URL: 'http://127.0.0.1:4218', NEXT_PUBLIC_BACKEND_URL: '/backend-api',
    DISABLE_REGISTRATION: 'true', STORAGE_PROVIDER: 'local',
    NEXT_PUBLIC_GUIDED_COMPOSER_SHELL: 'true',
    NEXT_FONT_GOOGLE_MOCKED_RESPONSES: path.join(__dirname, 'fonts.cjs'),
    NODE_OPTIONS: '--require=' + path.join(__dirname, 'network-guard.cjs'),
  };
  frontend = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'dev', '--webpack', '--hostname', '127.0.0.1', '--port', '4217'], { cwd: path.join(root, 'apps/frontend'), env, stdio: ['ignore', 'pipe', 'pipe'] });
  let startup = '';
  let warming = false;
  frontend.stdout.on('data', data => {
    process.stdout.write(data);
    startup = (startup + data.toString()).slice(-8192);
    // Wait for Next to confirm its own listener before any authenticated warm-up.
    if (!warming && /Ready in/.test(startup)) {
      warming = true;
      warmRoutes().catch(error => { console.error(error.message); stop(); process.exitCode = 1; });
    }
  });
  frontend.stderr.on('data', data => process.stderr.write(data));
  frontend.on('exit', code => { stopping = true; cleanupBranding(); server.close(); process.exitCode = process.exitCode || code || 0; });
}
async function warmRoutes() {
  const deadline = Date.now() + 330_000;
  for (const route of ['/auth/login', '/media', '/launches', '/create', '/settings']) {
    let loaded = false;
    while (!stopping && !loaded && Date.now() < deadline) {
      try {
        loaded = await new Promise((resolve, reject) => {
          const req = http.get(origin + route, { headers: route === '/auth/login' ? {} : { cookie: `auth=${token}` } }, response => {
            response.resume();
            response.on('end', () => resolve(response.statusCode === 200));
          });
          req.setTimeout(120_000, () => req.destroy(new Error('Route warm-up timeout')));
          req.on('error', reject);
        });
      } catch { /* Frontend may still be starting. */ }
      if (!loaded) await new Promise(resolve => setTimeout(resolve, 500));
    }
    if (stopping) return;
    if (!loaded) throw new Error('Isolated frontend did not become ready: ' + route);
  }
  ready = true;
  console.log('ISOLATED_FRONTEND_READY ' + origin);
}
function cleanupBranding() {
  if (createdBranding && fs.existsSync(branding) && fs.lstatSync(branding).isSymbolicLink() && fs.readlinkSync(branding) === brandingSource) {
    fs.unlinkSync(branding); createdBranding = false;
  }
}
function stop() { stopping = true; ready = false; if (reservation.listening) reservation.close(); frontend?.kill('SIGTERM'); cleanupBranding(); server.close(); }
process.once('SIGTERM', stop);
process.once('SIGINT', stop);
