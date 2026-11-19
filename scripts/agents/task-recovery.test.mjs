import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { LIMITS, begin, capture, finish, guard, mark } from './task-recovery.mjs';

// An explicit private fixture outside the sandbox-writable temp roots; never a runner configuration.
const privateRoot = mkdtempSync(join(homedir(), '.ep-recovery-fixture-'));
const temporary = mkdtempSync(join(tmpdir(), 'ep-recovery-git-'));
after(() => { rmSync(privateRoot, { recursive: true, force: true }); rmSync(temporary, { recursive: true, force: true }); });
let sequence = 0;
function fixture() {
  const root = join(temporary, `repo-${sequence}`);
  const store = join(privateRoot, `store-${sequence++}`);
  mkdirSync(root); mkdirSync(store, { mode: 0o700 });
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
  git('init', '-q'); git('config', 'user.name', 'Recovery fixture'); git('config', 'user.email', 'fixture@example.invalid');
  writeFileSync(join(root, 'tracked.bin'), Buffer.from([0, 1, 2]));
  git('add', '.'); git('commit', '-qm', 'baseline');
  const start = git('rev-parse', 'HEAD');
  return { root, store, git, start, context: { phase: 'test', exit: 0, signal: null, branch: git('branch', '--show-current'), baseSha: start, startSha: start } };
}
const receipt = (run) => JSON.parse(readFileSync(join(run.path, 'receipt.json')));
const artifact = (run, entry) => readFileSync(join(run.path, entry.file));

test('private explicit store readiness refuses temp/Git/general/occupied/mode/symlink layouts without chmod', () => {
  const f = fixture();
  guard(f.store, f.root);
  assert.throws(() => guard('', f.root));
  assert.throws(() => guard(temporary, f.root), /sandbox_writable_store/);
  assert.throws(() => guard(f.root, f.root));
  chmodSync(f.store, 0o755);
  assert.throws(() => guard(f.store, f.root), /unsafe_private_entry/);
  assert.equal(statSync(f.store).mode & 0o777, 0o755);
  chmodSync(f.store, 0o700);
  writeFileSync(join(f.store, 'unrelated'), 'unrelated', { mode: 0o600 });
  assert.throws(() => guard(f.store, f.root), /occupied_store/);
  rmSync(join(f.store, 'unrelated'));
  const link = join(privateRoot, 'store-link'); symlinkSync(f.store, link);
  assert.throws(() => guard(link, f.root), /symlink/);
  const ssh = join(privateRoot, '.ssh'); mkdirSync(ssh, { mode: 0o700 });
  assert.throws(() => guard(ssh, f.root), /general_directory/);
});

test('precommit failure round-trips staged/unstaged binary patches and regular untracked bytes privately', () => {
  const f = fixture();
  const run = begin(f.store, f.root, { mode: 'implement', number: 42 });
  writeFileSync(join(f.root, 'tracked.bin'), Buffer.from([0, 3, 4])); f.git('add', 'tracked.bin');
  const final = Buffer.from([0, 9, 10, 255]); writeFileSync(join(f.root, 'tracked.bin'), final);
  const untracked = Buffer.from([0, 255, 7]); writeFileSync(join(f.root, 'new file.bin'), untracked);
  chmodSync(join(f.root, 'new file.bin'), 0o755);
  writeFileSync(join(run.path, 'stdout.log'), 'PRIVATE-STREAM-SENTINEL');
  capture(f.store, f.root, run.id, { ...f.context, phase: 'precommit_failure', exit: 1 });
  const event = receipt(run).events.at(-1);
  assert.equal(event.complete, true);
  assert.equal(event.artifacts.untracked[0].mode, 0o755);
  assert.match(artifact(run, event.artifacts.staged).toString(), /GIT binary patch/);
  assert.match(artifact(run, event.artifacts.unstaged).toString(), /GIT binary patch/);
  assert.deepEqual(artifact(run, event.artifacts.untracked[0]), untracked);
  assert.equal(statSync(join(run.path, event.artifacts.staged.file)).mode & 0o777, 0o600);
  finish(f.store, f.root, run.id);
  guard(f.store, f.root);
  f.git('reset', '--hard', '-q'); f.git('clean', '-fd');
  execFileSync('git', ['apply', '--index'], { cwd: f.root, input: artifact(run, event.artifacts.staged), stdio: ['pipe', 'pipe', 'pipe'] });
  execFileSync('git', ['apply'], { cwd: f.root, input: artifact(run, event.artifacts.unstaged), stdio: ['pipe', 'pipe', 'pipe'] });
  writeFileSync(join(f.root, event.artifacts.untracked[0].path), artifact(run, event.artifacts.untracked[0]), { mode: event.artifacts.untracked[0].mode });
  assert.equal(statSync(join(f.root, 'new file.bin')).mode & 0o777, 0o755);
  assert.deepEqual(readFileSync(join(f.root, 'tracked.bin')), final);
  assert.deepEqual(readFileSync(join(f.root, 'new file.bin')), untracked);
});

test('committed/prepush failure retains a verifiable incremental Git bundle', () => {
  const f = fixture(); const run = begin(f.store, f.root, { mode: 'implement', number: 42 });
  writeFileSync(join(f.root, 'tracked.bin'), Buffer.from([0, 5])); f.git('add', '.'); f.git('commit', '-qm', 'unpublished');
  const head = f.git('rev-parse', 'HEAD');
  capture(f.store, f.root, run.id, { ...f.context, phase: 'committed_pre_push', exit: 1 });
  const bundle = receipt(run).events.at(-1).artifacts.bundle;
  assert.equal(bundle.prerequisite, f.start);
  const bundleFile = join(run.path, bundle.file);
  f.git('bundle', 'verify', bundleFile);
  finish(f.store, f.root, run.id);
  f.git('reset', '--hard', f.start);
  f.git('fetch', bundleFile, 'HEAD');
  assert.equal(f.git('rev-parse', 'FETCH_HEAD'), head);
});

test('confirmed push/pre-PR and normal success retain evidence and release automatically', () => {
  const f = fixture(); const run = begin(f.store, f.root, { mode: 'implement', number: 42 });
  writeFileSync(join(f.root, 'tracked.bin'), Buffer.from([0, 8])); f.git('add', '.'); f.git('commit', '-qm', 'confirmed fixture');
  capture(f.store, f.root, run.id, { ...f.context, phase: 'postpush_prePR', external: { push: 'confirmed', pr: 'not_attempted' } });
  assert.equal(receipt(run).events.at(-1).artifacts.bundle, undefined);
  capture(f.store, f.root, run.id, { ...f.context, phase: 'completed', external: { push: 'confirmed', pr: 'confirmed' } });
  finish(f.store, f.root, run.id);
  assert.equal(receipt(run).state, 'retained');
  assert.equal(existsSync(join(f.store, 'ACTIVE')), false);
});

test('ambiguous PR response or incomplete capture quarantines and blocks reuse', () => {
  const f = fixture(); const run = begin(f.store, f.root, { mode: 'implement', number: 42 });
  capture(f.store, f.root, run.id, { ...f.context, phase: 'PR_response_lost', external: { push: 'confirmed', pr: 'attempted_unconfirmed' } });
  assert.throws(() => finish(f.store, f.root, run.id), /quarantined/);
  assert.throws(() => guard(f.store, f.root), /quarantined/);
  assert.equal(receipt(run).external.pr, 'attempted_unconfirmed');
  const broken = fixture(); const incomplete = begin(broken.store, broken.root, { mode: 'implement', number: 42 });
  writeFileSync(join(broken.root, 'recover-me'), 'PRESERVE-ME');
  rmSync(join(incomplete.path, 'objects'), { recursive: true });
  symlinkSync(privateRoot, join(incomplete.path, 'objects'));
  assert.throws(() => capture(broken.store, broken.root, incomplete.id, broken.context), /incomplete/);
  assert.throws(() => guard(broken.store, broken.root), /quarantined/);
  assert.equal(readFileSync(join(broken.root, 'recover-me'), 'utf8'), 'PRESERVE-ME');
});

test('bounds, collision and source symlink failures preserve quarantine and checkout', () => {
  const f = fixture();
  const limits = { ...LIMITS, bytes: 128 * 1024, metadata: 8192, raw: 1024 };
  const run = begin(f.store, f.root, { mode: 'implement' }, { id: 'fixed-record', limits });
  writeFileSync(join(f.root, 'too-large'), Buffer.alloc(150 * 1024));
  assert.throws(() => capture(f.store, f.root, run.id, f.context, {}, limits), /incomplete/);
  assert.equal(existsSync(join(f.root, 'too-large')), true);
  assert.throws(() => begin(f.store, f.root, {}, { id: 'fixed-record', limits }), /quarantined/);
  const raw = fixture(); const rawRun = begin(raw.store, raw.root, {}, { limits });
  writeFileSync(join(rawRun.path, 'stdout.log'), Buffer.alloc(limits.raw + 1));
  assert.throws(() => capture(raw.store, raw.root, rawRun.id, raw.context, {}, limits), /incomplete/);
  assert.equal(existsSync(join(raw.store, 'ACTIVE')), true);
  const link = fixture(); const linked = begin(link.store, link.root, {});
  symlinkSync('/etc/passwd', join(link.root, 'untracked-link'));
  assert.throws(() => capture(link.store, link.root, linked.id, link.context), /incomplete/);
  assert.equal(existsSync(join(link.store, 'ACTIVE')), true);
});

test('CLI errors suppress source/stream sentinels and leave ACTIVE on persistence failure', () => {
  const f = fixture(); const run = begin(f.store, f.root, {});
  writeFileSync(join(run.path, 'stderr.log'), 'PRIVATE-RECOVERY-SENTINEL');
  writeFileSync(join(f.root, 'source.txt'), 'PRIVATE-RECOVERY-SENTINEL');
  chmodSync(join(run.path, 'objects'), 0o755);
  const result = spawnSync(process.execPath, [new URL('./task-recovery.mjs', import.meta.url).pathname, 'capture', f.store, f.root, run.id, JSON.stringify(f.context)], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.doesNotMatch(result.stdout + result.stderr, /PRIVATE-RECOVERY-SENTINEL/);
  assert.equal(existsSync(join(f.store, 'ACTIVE')), true);
});

test('phase transitions persist before external attempts; count and reused-id bounds fail closed', () => {
  const f = fixture(); const run = begin(f.store, f.root, {}, { id: 'retained-id' });
  mark(f.store, f.root, run.id, { phase: 'push_attempt', external: { push: 'attempted_unconfirmed' } });
  assert.equal(receipt(run).transitions[0].external.push, 'attempted_unconfirmed');
  mark(f.store, f.root, run.id, { phase: 'push_confirmed', external: { push: 'confirmed' } });
  capture(f.store, f.root, run.id, f.context); finish(f.store, f.root, run.id);
  assert.throws(() => guard(f.store, f.root, { limits: { ...LIMITS, records: 1 } }), /record_limit/);
  assert.throws(() => begin(f.store, f.root, {}, { id: 'retained-id' }));
  assert.equal(existsSync(join(f.store, 'ACTIVE')), true);
  assert.equal(receipt(run).state, 'retained');
});

test('all three trusted pre-checkout guards reject real quarantined/unsafe fixtures before checkout', () => {
  const sources = ['codex-development-agents.yml', 'codex-issue-queue.yml'].map(name => readFileSync(new URL(`../../.github/workflows/${name}`, import.meta.url), 'utf8'));
  const guards = sources.flatMap(source => [...source.matchAll(/          \/\/ RECOVERY_PRECHECK_BEGIN\n([\s\S]*?)          \/\/ RECOVERY_PRECHECK_END/g)].map(match => match[1].replace(/^          /gm, '')));
  assert.equal(guards.length, 3);
  assert.equal(new Set(guards).size, 1);
  for (const source of sources) {
    const blocks = source.split('    steps:').slice(1);
    for (const block of blocks.filter(value => value.includes('RECOVERY_PRECHECK_BEGIN'))) assert.ok(block.indexOf('RECOVERY_PRECHECK_END') < block.indexOf('uses: actions/checkout@'));
  }
  const f = fixture();
  const check = (store) => spawnSync(process.execPath, ['-e', guards[0]], { encoding: 'utf8', env: { ...process.env, CODEX_RECOVERY_ROOT: store, GITHUB_WORKSPACE: f.root } });
  assert.equal(check(f.store).status, 0);
  assert.equal(check('').status, 1);
  assert.equal(check(temporary).status, 1);
  const run = begin(f.store, f.root, {});
  assert.equal(check(f.store).status, 1);
  capture(f.store, f.root, run.id, f.context); finish(f.store, f.root, run.id);
  assert.equal(check(f.store).status, 0);
  chmodSync(f.store, 0o755); assert.equal(check(f.store).status, 1); chmodSync(f.store, 0o700);
  writeFileSync(join(f.store, 'unrelated'), 'PRIVATE-GUARD-SENTINEL');
  const denied = check(f.store);
  assert.equal(denied.status, 1); assert.doesNotMatch(denied.stdout + denied.stderr, /PRIVATE-GUARD-SENTINEL/);
});
