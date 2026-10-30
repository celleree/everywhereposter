// Stage only the reviewed worker closure; never install dependencies or fetch models.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');
const root = fs.realpathSync(path.resolve(__dirname, '../..'));
const media = 'postiz-app/libraries/nestjs-libraries/src/media-editing/';
const sources = [
  ...['cooked-editor-runtime', 'cooked-worker', 'video-edit-decision', 'cooked-editor-limits'].map(n => media + n + '.ts'),
  ...['cooked-editor-launcher.py', 'cooked-quiet-blocks.py', 'cooked-editor-apply.py', 'cooked-transcribe-observed.py'].map(n => media + n),
  'tools/cooked-worker/worker-entry.cjs', 'tools/cooked-worker/worker-health.cjs',
];
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
const git = (...args) => execFileSync('git', ['-C', root, ...args], {encoding: 'utf8'}).trim();
const inside = (parent, child) => child === parent || child.startsWith(parent + path.sep);
function stage(sha, output) {
  if (!/^[0-9a-f]{40}$/.test(sha) || git('rev-parse', 'HEAD') !== sha) throw Error('Exact full HEAD SHA required');
  if (git('status', '--porcelain', '--untracked-files=normal')) throw Error('Clean checkout required');
  if (!path.isAbsolute(output) || path.normalize(output) !== output || inside(root, output) || inside(output, root)) throw Error('New absolute outside-repository output required');
  if (fs.existsSync(output) || fs.lstatSync(path.dirname(output)).isSymbolicLink() || fs.realpathSync(path.dirname(output)) !== path.dirname(output)) throw Error('New output with a real parent required');
  const ts = require(path.join(root, 'postiz-app/node_modules/typescript'));
  const pinned = require(path.join(root, 'postiz-app/package.json')).devDependencies.typescript;
  if (ts.version !== pinned || !/^\d+\.\d+\.\d+$/.test(pinned)) throw Error('Pinned repository TypeScript required');
  const options = {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true};
  const sourceFiles = {};
  const runtime = new Map(), validated = new Map();
  const inputs = [...sources, 'tools/cooked-worker/Dockerfile.worker', 'tools/cooked-pilot/prepare.py', 'tools/cooked-pilot/requirements.lock', 'tools/cooked-pilot/MODEL-NOTICES.md', 'tools/cooked-worker/stage-runtime.cjs', 'postiz-app/package.json', 'postiz-app/pnpm-lock.yaml'];
  for (const name of inputs) {
    const file = path.join(root, name);
    if (!fs.lstatSync(file).isFile() || fs.realpathSync(file) !== file) throw Error('Regular repository source required: ' + name);
    const data = fs.readFileSync(file);
    if (!data.equals(execFileSync('git', ['-C', root, 'show', `${sha}:${name}`], {maxBuffer: data.length + 1024}))) throw Error('Source differs from exact commit: ' + name);
    sourceFiles[name] = hash(data); validated.set(name, data);
    if (!sources.includes(name)) continue;
    let bytes = data;
    if (name.endsWith('.ts')) {
      const result = ts.transpileModule(data.toString('utf8'), {fileName: name, reportDiagnostics: true, compilerOptions: options});
      if (result.diagnostics?.length) throw Error('TypeScript compilation diagnostics: ' + name);
      bytes = Buffer.from(result.outputText);
    }
    runtime.set(path.basename(name).replace(/\.ts$/, '.js'), bytes);
  }
  if (git('status', '--porcelain', '--untracked-files=normal') || git('rev-parse', 'HEAD') !== sha) throw Error('Checkout changed while staging');
  const manifest = {
    sourceSHA: sha,
    compiler: {
      version: ts.version, module: 'CommonJS', target: 'ES2022', esModuleInterop: true,
      sha256: hash(fs.readFileSync(require.resolve(path.join(root, 'postiz-app/node_modules/typescript')))),
    },
    sourceFiles,
    runtimeHashes: Object.fromEntries([...runtime].map(([name, bytes]) => [name, hash(bytes)])),
  };
  fs.mkdirSync(output, {mode: 0o700}); // Exclusive: an existing entry is never overwritten.
  const runtimeDir = path.join(output, 'runtime');
  fs.mkdirSync(runtimeDir, {mode: 0o755});
  fs.chmodSync(runtimeDir, 0o755); // Docker copies root-owned content; UID10001 must traverse it.
  const writeReadable = (file, bytes) => {
    fs.writeFileSync(file, bytes, {flag: 'wx', mode: 0o644});
    fs.chmodSync(file, 0o644); // Explicitly restore read permission after a restrictive host umask.
  };
  for (const [name, bytes] of runtime) writeReadable(path.join(runtimeDir, name), bytes);
  writeReadable(path.join(output, 'Dockerfile'), validated.get('tools/cooked-worker/Dockerfile.worker'));
  fs.writeFileSync(path.join(output, 'staging-manifest.json'), JSON.stringify(manifest, null, 2) + '\n', {flag: 'wx'});
  return manifest;
}
if (require.main === module) {
  try {
    if (process.argv.length !== 4) throw Error('Usage: node tools/cooked-worker/stage-runtime.cjs <full-HEAD-SHA> <new-absolute-output>');
    stage(process.argv[2], process.argv[3]);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = {stage};
