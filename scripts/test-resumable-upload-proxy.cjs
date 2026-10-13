// Run inside an existing Postiz image with the repository mounted at /repo.
// No application credentials, network providers, or image pulls are needed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const { spawnSync } = require('node:child_process');
const root = process.argv[2] || '/repo';
const configs = ['nginx/privacy-site.conf', 'nginx/postiz-frontend-standalone.conf', 'postiz-app/var/docker/nginx.conf'];
function run(...args) {
  const r = spawnSync('nginx', args, { encoding: 'utf8', stdio: 'ignore' });
  assert.equal(r.status, 0, r.stderr);
}
function request(port, method, path, body = '', headers = {}) {
  return new Promise((resolve, reject) => {
    const q = http.request({ hostname: '127.0.0.1', port, method, path, headers: { 'Content-Length': Buffer.byteLength(body), ...headers } }, r => {
      let text = ''; r.on('data', b => text += b); r.on('end', () => resolve({ status: r.statusCode, headers: r.headers, text }));
    });
    q.setTimeout(10000, () => q.destroy(new Error('Proxy response timeout')));
    q.on('error', reject); q.end(body);
  });
}
function oversized(port, path, bytes) {
  return new Promise((resolve, reject) => {
    const q = http.request({ hostname: '127.0.0.1', port, method: 'PUT', path, headers: { 'Content-Length': bytes, Expect: '100-continue' } }, r => { r.resume(); r.on('end', () => resolve(r.statusCode)); });
    q.setTimeout(10000, () => q.destroy(new Error('Proxy rejection timeout')));
    q.on('error', reject); q.flushHeaders();
  });
}
(async () => {
  const echo = http.createServer((q, r) => {
    let body = ''; q.on('data', b => body += b); q.on('end', () => r.end(JSON.stringify({ method: q.method, path: q.url, body, auth: q.headers.auth })));
  });
  await new Promise(ok => echo.listen(3000, '0.0.0.0', ok));
  for (let i = 0; i < configs.length; i++) {
    const source = fs.readFileSync(`${root}/${configs[i]}`, 'utf8');
    const port = i === 2 ? 5000 : 80;
    const conf = i === 2 ? source : `events {}\nhttp { include /etc/nginx/mime.types; ${source}\n}`;
    const file = `/tmp/upload-proxy-${i}.conf`; fs.writeFileSync(file, conf);
    run('-t', '-c', file); run('-c', file);
    try {
      for (const method of ['GET', 'POST']) {
        const body = method === 'POST' ? '{"clientId":"original-body"}' : '';
        const r = await request(port, method, '/api/media/uploads?probe=1', body, { Auth: 'synthetic-auth' });
        assert.equal(r.status, 200); assert.equal(r.headers.location, undefined);
        assert.deepEqual(JSON.parse(r.text), { method, path: '/media/uploads?probe=1', body, auth: 'synthetic-auth' });
      }
      const part = await request(port, 'PUT', '/api/media/uploads/session/parts/0', 'original-part');
      assert.equal(part.status, 200); assert.equal(JSON.parse(part.text).path, '/media/uploads/session/parts/0');
      assert.equal(await oversized(port, '/api/media/uploads/session/parts/0', 9 * 1024 * 1024 + 1), 413);
      assert.equal((await request(port, 'GET', '/uploads/.resumable/session/part')).status, 404);
      if (i !== 2) assert.equal(await oversized(port, '/api/media/upload-server', 100 * 1024 * 1024 + 1), 413);
      console.log(`PASS ${configs[i]}: collection method/body/auth, part path/limit, private storage`);
    } finally { run('-s', 'quit', '-c', file); await new Promise(ok => setTimeout(ok, 200)); }
  }
  echo.close();
})().catch(e => { console.error(e); process.exit(1); });
