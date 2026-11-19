import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { constants as C, closeSync, existsSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

export const LIMITS = Object.freeze({ bytes: 25 * 1024 * 1024, records: 100, files: 100, metadata: 512 * 1024, raw: 4 * 1024 * 1024, events: 32 });
const deny = (code) => { throw new Error(code); };
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const within = (path, root) => path === root || path.startsWith(`${root}/`);
const decode = (bytes) => new TextDecoder('utf-8', { fatal: true }).decode(bytes);
const git = (root, args, maxBuffer = LIMITS.bytes) => execFileSync('git', ['--literal-pathspecs', ...args], { cwd: root, maxBuffer, stdio: ['ignore', 'pipe', 'pipe'] });
const exists = (path) => { try { return lstatSync(path); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } };
const syncDirectory = (path) => { const fd = openSync(path, C.O_RDONLY | C.O_DIRECTORY); try { fsyncSync(fd); } finally { closeSync(fd); } };

function noLinks(path) {
  let current = '/';
  for (const part of path.split('/').filter(Boolean)) {
    current = join(current, part);
    if (lstatSync(current).isSymbolicLink()) deny('symlink_path');
  }
}
function privateEntry(path, directory) {
  const value = lstatSync(path);
  if (value.uid !== process.getuid() || (value.mode & 0o777) !== (directory ? 0o700 : 0o600) ||
      (directory ? !value.isDirectory() : !value.isFile() || value.nlink !== 1)) deny('unsafe_private_entry');
  return value;
}
function privateRead(path) {
  privateEntry(path, false);
  const fd = openSync(path, C.O_RDONLY | C.O_NOFOLLOW);
  try {
    const value = fstatSync(fd);
    if (!value.isFile() || value.uid !== process.getuid() || value.nlink !== 1 || (value.mode & 0o777) !== 0o600 || value.size > LIMITS.metadata) deny('unsafe_private_file');
    return readFileSync(fd);
  } finally { closeSync(fd); }
}
function writeNew(path, bytes) {
  const fd = openSync(path, C.O_WRONLY | C.O_CREAT | C.O_EXCL | C.O_NOFOLLOW, 0o600);
  try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
  syncDirectory(dirname(path));
}
function atomicJSON(path, data, limits) {
  const bytes = Buffer.from(`${JSON.stringify(data)}\n`);
  if (bytes.length > limits.metadata) deny('metadata_limit');
  if (exists(path)) privateEntry(path, false);
  const temporary = `${path}.${randomUUID()}.tmp`;
  writeNew(temporary, bytes);
  renameSync(temporary, path);
  syncDirectory(dirname(path));
}

export function guard(store, checkout, { active = '', limits = LIMITS } = {}) {
  if (!store || !isAbsolute(store) || resolve(store) !== store) deny('recovery_store_required');
  noLinks(store); privateEntry(store, true);
  if (store === homedir() || store.split('/').some((part) => ['.ssh', '.gnupg', '.aws'].includes(part))) deny('general_directory');
  const blocked = [resolve(checkout), '/tmp', '/var/tmp', process.env.RUNNER_TEMP, process.env.RUNNER_WORKSPACE, process.env.TMPDIR].filter(Boolean).map((p) => resolve(p));
  if (blocked.some((path) => within(store, path)) || within(resolve(checkout), store)) deny('sandbox_writable_store');
  for (let path = store; path !== '/'; path = dirname(path)) if (exists(join(path, '.git'))) deny('git_storage');
  const entries = readdirSync(store);
  if (entries.some((name) => !['store.json', 'records', 'ACTIVE'].includes(name))) deny('occupied_store');
  if (entries.length) {
    const format = JSON.parse(privateRead(join(store, 'store.json')));
    if (format.version !== 1 || format.kind !== 'everywhereposter-task-recovery') deny('ambiguous_store');
  }
  const records = join(store, 'records');
  if (exists(records)) {
    privateEntry(records, true);
    const names = readdirSync(records);
    if (names.length > limits.records || !active && names.length >= limits.records) deny('record_limit');
    for (const name of names) {
      if (!/^[a-zA-Z0-9-]{1,100}$/.test(name)) deny('invalid_record');
      privateEntry(join(records, name), true);
    }
  }
  const marker = join(store, 'ACTIVE');
  if (exists(marker)) {
    const state = JSON.parse(privateRead(marker));
    if (!active || state.id !== active || state.checkout !== resolve(checkout)) deny('checkout_quarantined');
  } else if (active) deny('missing_quarantine_marker');
  return store;
}

function load(store, checkout, id, limits) {
  if (!/^[a-zA-Z0-9-]{1,100}$/.test(id)) deny('invalid_record');
  guard(store, checkout, { active: id, limits });
  const path = join(store, 'records', id);
  privateEntry(path, true);
  const receipt = JSON.parse(privateRead(join(path, 'receipt.json')));
  if (receipt.id !== id || receipt.checkout !== resolve(checkout) || receipt.version !== 1) deny('record_identity');
  return { path, receipt };
}

export function begin(store, checkout, task, { id = randomUUID(), limits = LIMITS } = {}) {
  guard(store, checkout, { limits });
  if (!/^[a-zA-Z0-9-]{1,100}$/.test(id)) deny('invalid_record');
  if (!exists(join(store, 'store.json'))) writeNew(join(store, 'store.json'), Buffer.from('{"version":1,"kind":"everywhereposter-task-recovery"}\n'));
  if (!exists(join(store, 'records'))) { mkdirSync(join(store, 'records'), { mode: 0o700 }); syncDirectory(store); }
  writeNew(join(store, 'ACTIVE'), Buffer.from(JSON.stringify({ id, checkout: resolve(checkout) })));
  const path = join(store, 'records', id);
  mkdirSync(path, { mode: 0o700 }); mkdirSync(join(path, 'objects'), { mode: 0o700 }); syncDirectory(join(store, 'records'));
  const receipt = { version: 1, id, checkout: resolve(checkout), task, state: 'active', createdAt: new Date().toISOString(), external: { push: 'not_attempted', pr: 'not_attempted' }, events: [] };
  atomicJSON(join(path, 'receipt.json'), receipt, limits);
  for (const name of ['stdout.log', 'stderr.log']) writeNew(join(path, name), Buffer.alloc(0));
  return { id, path };
}

function budget(path, limits) {
  privateEntry(join(path, 'objects'), true);
  let bytes = 2 * limits.metadata + 2 * limits.raw;
  let files = 3;
  for (const name of readdirSync(join(path, 'objects'))) {
    if (!/^[0-9a-f]{64}$/.test(name)) deny('invalid_object');
    bytes += privateEntry(join(path, 'objects', name), false).size; files++;
  }
  for (const name of ['stdout.log', 'stderr.log']) if (privateEntry(join(path, name), false).size > limits.raw) deny('raw_stream_limit');
  if (bytes > limits.bytes || files > limits.files) deny('capture_limit');
  return limits.bytes - bytes;
}
function object(path, bytes, limits) {
  const sha256 = digest(bytes);
  const file = join(path, 'objects', sha256);
  if (exists(file)) {
    privateEntry(file, false);
    if (digest(readFileSync(file)) !== sha256) deny('object_integrity');
  } else {
    if (bytes.length > budget(path, limits) || readdirSync(join(path, 'objects')).length + 4 > limits.files) deny('capture_limit');
    writeNew(file, bytes);
  }
  return { sha256, bytes: bytes.length, file: `objects/${sha256}` };
}
function regularBytes(root, relative, maximum) {
  if (!relative || isAbsolute(relative) || relative.split('/').some((part) => !part || part === '.' || part === '..' || part === '.git')) deny('unsafe_capture_path');
  const path = join(root, relative);
  noLinks(path);
  const fd = openSync(path, C.O_RDONLY | C.O_NOFOLLOW);
  try {
    const value = fstatSync(fd);
    if (!value.isFile() || value.size > maximum) deny('untracked_capture_limit');
    const bytes = readFileSync(fd);
    if (bytes.length !== value.size) deny('file_changed_during_capture');
    return { data: bytes, mode: value.mode & 0o777 };
  } finally { closeSync(fd); }
}
function workingState(checkout, maximum, files) {
  const head = decode(git(checkout, ['rev-parse', 'HEAD'], 1024)).trim();
  const branch = decode(git(checkout, ['branch', '--show-current'], 1024)).trim();
  if (!/^[0-9a-f]{40}$/.test(head)) deny('invalid_current_revision');
  const staged = git(checkout, ['diff', '--cached', '--binary', '--full-index', '--no-ext-diff', '--no-textconv'], maximum);
  let remaining = maximum - staged.length;
  const unstaged = git(checkout, ['diff', '--binary', '--full-index', '--no-ext-diff', '--no-textconv'], Math.max(1, remaining));
  remaining -= unstaged.length;
  if (remaining < 0) deny('patch_capture_limit');
  const listing = git(checkout, ['ls-files', '--others', '--exclude-standard', '-z'], maximum);
  if (listing.length && listing.at(-1) !== 0) deny('invalid_untracked_listing');
  const paths = listing.length ? decode(listing.subarray(0, -1)).split('\0') : [];
  if (paths.length > files) deny('untracked_count_limit');
  const untracked = paths.sort().map((path) => {
    const { data, mode } = regularBytes(checkout, path, remaining);
    remaining -= data.length;
    return { path, data, mode };
  });
  const fingerprint = digest(JSON.stringify({ head, branch, staged: digest(staged), unstaged: digest(unstaged), untracked: untracked.map(({ path, data, mode }) => ({ path, mode, hash: digest(data) })) }));
  return { head, branch, staged, unstaged, untracked, fingerprint };
}

export function capture(store, checkout, id, context, attachments = {}, limits = LIMITS) {
  const { path, receipt } = load(store, checkout, id, limits);
  if (receipt.incomplete || receipt.state === 'quarantined') deny('capture_already_incomplete');
  try {
    if (receipt.events.length >= limits.events) deny('event_limit');
    budget(path, limits);
    const state = workingState(checkout, limits.bytes, limits.files - 3);
    const artifacts = { staged: object(path, state.staged, limits), unstaged: object(path, state.unstaged, limits), untracked: state.untracked.map(({ path: name, data, mode }) => ({ path: name, mode, ...object(path, data, limits) })) };
    for (const [name, source] of Object.entries(attachments)) {
      if (source && exists(source)) {
        noLinks(source);
        const value = lstatSync(source);
        if (!value.isFile() || value.size > budget(path, limits)) deny('attachment_limit');
        artifacts[name] = object(path, readFileSync(source), limits);
      }
    }
    for (const name of ['stdout.log', 'stderr.log']) artifacts[name] = object(path, readFileSync(join(path, name)), limits);
    const external = { ...receipt.external, ...context.external };
    if (Object.values(external).some((value) => !['not_attempted', 'attempted_unconfirmed', 'confirmed'].includes(value))) deny('external_state');
    if (context.startSha && state.head !== context.startSha && external.push !== 'confirmed') {
      if (!/^[0-9a-f]{40}$/.test(context.startSha)) deny('invalid_start_revision');
      const file = join(path, `bundle-${randomUUID()}`);
      const available = budget(path, limits);
      execFileSync('bash', ['-c', 'umask 077; ulimit -f "$1"; exec git --literal-pathspecs bundle create "$2" "$3"', 'recovery-bundle', String(Math.floor(available / 1024)), file, `${context.startSha}..HEAD`], { cwd: checkout, maxBuffer: 65536, stdio: ['ignore', 'pipe', 'pipe'] });
      privateEntry(file, false);
      const bytes = readFileSync(file);
      if (bytes.length > available) deny('bundle_limit');
      const sha256 = digest(bytes);
      const target = join(path, 'objects', sha256);
      if (exists(target)) { if (digest(readFileSync(target)) !== sha256) deny('object_integrity'); rmSync(file); }
      else { const fd = openSync(file, C.O_RDONLY | C.O_NOFOLLOW); fsyncSync(fd); closeSync(fd); renameSync(file, target); syncDirectory(join(path, 'objects')); }
      artifacts.bundle = { sha256, bytes: bytes.length, file: `objects/${sha256}`, prerequisite: context.startSha };
    }
    if (workingState(checkout, limits.bytes, limits.files - 3).fingerprint !== state.fingerprint) deny('checkout_changed_during_capture');
    receipt.external = external;
    receipt.events.push({ ...context, external, at: new Date().toISOString(), branch: state.branch, currentSha: state.head, fingerprint: state.fingerprint, artifacts, complete: true });
    atomicJSON(join(path, 'receipt.json'), receipt, limits);
    budget(path, limits);
    return { id, complete: true };
  } catch {
    receipt.state = 'quarantined';
    receipt.incomplete = true;
    try { atomicJSON(join(path, 'receipt.json'), receipt, limits); } catch { /* ACTIVE remains even when persistence fails. */ }
    deny('capture_incomplete');
  }
}

export function mark(store, checkout, id, context, limits = LIMITS) {
  const { path, receipt } = load(store, checkout, id, limits);
  try {
    if (receipt.incomplete) deny('capture_already_incomplete');
    receipt.transitions ??= [];
    if (receipt.transitions.length >= limits.events) deny('event_limit');
    const external = { ...receipt.external, ...context.external };
    if (Object.values(external).some((value) => !['not_attempted', 'attempted_unconfirmed', 'confirmed'].includes(value))) deny('external_state');
    receipt.external = external;
    receipt.transitions.push({ ...context, external, at: new Date().toISOString() });
    atomicJSON(join(path, 'receipt.json'), receipt, limits);
    return { id, persisted: true };
  } catch {
    receipt.incomplete = true;
    receipt.state = 'quarantined';
    try { atomicJSON(join(path, 'receipt.json'), receipt, limits); } catch { /* ACTIVE is the durable fail-safe. */ }
    deny('persistence_incomplete');
  }
}

export function finish(store, checkout, id, limits = LIMITS) {
  const { path, receipt } = load(store, checkout, id, limits);
  const event = receipt.events.at(-1);
  if (receipt.incomplete || !event?.complete || Object.values(receipt.external).includes('attempted_unconfirmed')) deny('checkout_quarantined');
  budget(path, limits);
  if (workingState(checkout, limits.bytes, limits.files - 3).fingerprint !== event.fingerprint) deny('checkout_changed_after_capture');
  for (const event of receipt.events) {
    for (const artifact of Object.values(event.artifacts).flat()) {
      if (!artifact?.sha256) continue;
      const file = join(path, artifact.file);
      privateEntry(file, false);
      if (digest(readFileSync(file)) !== artifact.sha256) deny('object_integrity');
    }
  }
  receipt.state = 'retained';
  receipt.completedAt = new Date().toISOString();
  atomicJSON(join(path, 'receipt.json'), receipt, limits);
  rmSync(join(store, 'ACTIVE')); syncDirectory(store);
  return { id, complete: true };
}

export function execute(mode, args) {
  const [store, checkout, id, context = '{}', attachments = '{}'] = args;
  if (mode === 'guard') { guard(store, checkout); return { ready: true }; }
  if (mode === 'begin') return begin(store, checkout, JSON.parse(id));
  if (mode === 'capture') return capture(store, checkout, id, JSON.parse(context), JSON.parse(attachments));
  if (mode === 'mark') return mark(store, checkout, id, JSON.parse(context));
  if (mode === 'finish') return finish(store, checkout, id);
  deny('recovery_usage');
}
if (import.meta.url.startsWith('file:') && process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(execute(process.argv[2], process.argv.slice(3)))); }
  catch { console.error('ERROR: Private recovery is unavailable or incomplete; checkout reuse is blocked.'); process.exitCode = 1; }
}
