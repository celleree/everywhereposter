const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const {createHash} = require('node:crypto');
const path = require('node:path');
const {execFileSync, spawnSync} = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const media = 'postiz-app/libraries/nestjs-libraries/src/media-editing/';
const expected = ['cooked-editor-runtime.js', 'cooked-worker.js', 'video-edit-decision.js', 'cooked-editor-limits.js', 'cooked-editor-launcher.py', 'cooked-quiet-blocks.py', 'cooked-editor-apply.py', 'cooked-transcribe-observed.py', 'worker-entry.cjs', 'worker-health.cjs'].sort();
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cooked-staging-test-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const repo = path.join(dir, 'repo'); fs.mkdirSync(repo);
  const names = [...expected.map(n => n.startsWith('worker-') ? 'tools/cooked-worker/' + n : media + n.replace(/\.js$/, '.ts')), 'tools/cooked-worker/Dockerfile.worker', 'tools/cooked-worker/stage-runtime.cjs', 'tools/cooked-pilot/prepare.py', 'tools/cooked-pilot/requirements.lock', 'tools/cooked-pilot/MODEL-NOTICES.md', 'postiz-app/package.json', 'postiz-app/pnpm-lock.yaml'];
  for (const name of names) { fs.mkdirSync(path.dirname(path.join(repo, name)), {recursive: true}); fs.copyFileSync(path.join(root, name), path.join(repo, name)); }
  fs.writeFileSync(path.join(repo, '.gitignore'), 'node_modules/\n');
  fs.symlinkSync(fs.realpathSync(path.join(root, 'postiz-app/node_modules')), path.join(repo, 'postiz-app/node_modules'));
  const git = (...args) => execFileSync('git', ['-C', repo, ...args], {encoding: 'utf8'}).trim();
  git('init', '-q');
  const commit = () => { git('add', '.'); git('-c', 'user.name=Staging test', '-c', 'user.email=staging@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture'); return git('rev-parse', 'HEAD'); };
  const sha = commit();
  const run = (output, revision = sha) => spawnSync(process.execPath, [path.join(repo, 'tools/cooked-worker/stage-runtime.cjs'), revision, output], {encoding: 'utf8'});
  return {dir, repo, sha, commit, run};
}
test('exact ten-file closure, required apply helper, unchanged Dockerfile and reproducible metadata', t => {
  const f = fixture(t), a = path.join(f.dir, 'a'), b = path.join(f.dir, 'b');
  for (const out of [a, b]) { const result = f.run(out); assert.equal(result.status, 0, result.stderr); }
  assert.deepEqual(fs.readdirSync(path.join(a, 'runtime')).sort(), expected);
  assert.deepEqual(fs.readFileSync(path.join(a, 'Dockerfile')), fs.readFileSync(path.join(root, 'tools/cooked-worker/Dockerfile.worker')));
  const manifest = JSON.parse(fs.readFileSync(path.join(a, 'staging-manifest.json')));
  assert.equal(manifest.sourceSHA, f.sha); assert.equal(manifest.compiler.version, '5.5.4');
  assert.deepEqual(Object.keys(manifest.runtimeHashes).sort(), expected);
  for (const name of expected) assert.equal(manifest.runtimeHashes[name], createHash('sha256').update(fs.readFileSync(path.join(a, 'runtime', name))).digest('hex'));
  for (const name of ['staging-manifest.json', ...expected.map(n => 'runtime/' + n)]) assert.deepEqual(fs.readFileSync(path.join(a, name)), fs.readFileSync(path.join(b, name)));
  assert.match(fs.readFileSync(path.join(a, 'runtime/cooked-editor-runtime.js'), 'utf8'), /require\("\.\/cooked-editor-limits"\)/);
  fs.appendFileSync(path.join(f.repo, media + 'cooked-transcribe-observed.py'), '\n# new reviewed source\n');
  const next = f.commit(), c = path.join(f.dir, 'c'); assert.equal(f.run(c, next).status, 0);
  const changed = JSON.parse(fs.readFileSync(path.join(c, 'staging-manifest.json')));
  assert.equal(changed.sourceSHA, next); assert.notEqual(changed.runtimeHashes['cooked-transcribe-observed.py'], manifest.runtimeHashes['cooked-transcribe-observed.py']);
});
test('runtime remains readable and traversable by the image user under umask077', t => {
  const f = fixture(t), out = path.join(f.dir, 'restricted-umask');
  const child = spawnSync(process.execPath, ['-e', 'process.umask(0o077); require(process.argv[1]).stage(process.argv[2], process.argv[3]);', path.join(f.repo, 'tools/cooked-worker/stage-runtime.cjs'), f.sha, out], {encoding: 'utf8'});
  assert.equal(child.status, 0, child.stderr);
  const mode = name => fs.statSync(path.join(out, name)).mode & 0o777;
  assert.equal(mode('.'), 0o700); assert.equal(mode('runtime'), 0o755);
  for (const name of ['Dockerfile', ...expected.map(n => 'runtime/' + n)]) assert.equal(mode(name), 0o644, name);
});
test('rejects invalid SHA, existing/relative/in-repo/symlink output and dirty sources', t => {
  const f = fixture(t), out = path.join(f.dir, 'output');
  assert.notEqual(f.run(out, 'main').status, 0); assert.notEqual(f.run(out, '0'.repeat(40)).status, 0);
  fs.mkdirSync(out); assert.notEqual(f.run(out).status, 0); assert.deepEqual(fs.readdirSync(out), []);
  assert.notEqual(f.run('relative').status, 0); assert.notEqual(f.run(path.join(f.repo, 'output')).status, 0);
  fs.symlinkSync(f.dir, path.join(f.dir, 'alias')); assert.notEqual(f.run(path.join(f.dir, 'alias', 'new')).status, 0);
  fs.writeFileSync(path.join(f.repo, media + 'cooked-transcribe-observed.py'), '# dirty');
  assert.match(f.run(path.join(f.dir, 'dirty')).stderr, /Clean checkout required/);
});
test('compiler diagnostics and missing or symlinked required sources fail before output', t => {
  const f = fixture(t), source = path.join(f.repo, media + 'cooked-worker.ts'), out = path.join(f.dir, 'failed');
  fs.writeFileSync(source, 'const = ;');
  assert.match(f.run(out, f.commit()).stderr, /compilation diagnostics/); assert.equal(fs.existsSync(out), false);
  fs.rmSync(source); fs.symlinkSync(path.join(root, media + 'cooked-worker.ts'), source);
  assert.match(f.run(out, f.commit()).stderr, /Regular repository source required/); assert.equal(fs.existsSync(out), false);
  fs.rmSync(source); fs.copyFileSync(path.join(root, media + 'cooked-worker.ts'), source);
  fs.rmSync(path.join(f.repo, media + 'cooked-editor-apply.py'));
  assert.notEqual(f.run(out, f.commit()).status, 0); assert.equal(fs.existsSync(out), false);
});
