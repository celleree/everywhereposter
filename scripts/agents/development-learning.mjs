// Offline development evidence only. Never executes checks or activates proposals.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const LIMIT = 65536;
const id = value => typeof value === 'string' && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(value);
const digest = value => createHash('sha256').update(value).digest('hex');
const encode = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item) + '\n';
const fail = message => { throw new Error(message); };
const assert = (ok, message) => { if (!ok) fail(message); };
const exact = (value, keys) => assert(value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join() === [...keys].sort().join(), 'Invalid fields');
const metric = value => value === null || (Number.isSafeInteger(value) && value >= 0 && value <= 1e12);
const list = value => Array.isArray(value) && value.length > 0 && value.length <= 50
  && value.every(id) && new Set(value).size === value.length;

function read(file, limit = LIMIT) {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(fd);
    assert(stat.isFile() && stat.size <= limit, 'Invalid file or size limit');
    // Bound the read even if the file grows after stat.
    const bytes = Buffer.alloc(limit + 1);
    const count = fs.readSync(fd, bytes, 0, bytes.length, 0);
    assert(count <= limit, 'Size limit exceeded');
    return bytes.subarray(0, count);
  } finally { fs.closeSync(fd); }
}

function privateStore(store) {
  assert(path.isAbsolute(store), 'Store must be absolute and outside Git');
  store = path.resolve(store);
  for (let cursor = store; ; cursor = path.dirname(cursor)) {
    const git = path.join(cursor, '.git');
    assert(!(fs.existsSync(git) && (fs.statSync(git).isFile() || fs.existsSync(path.join(git, 'HEAD')))), 'Store must be outside Git');
    if (fs.existsSync(cursor)) assert(!fs.lstatSync(cursor).isSymbolicLink(), 'Symlinks are forbidden');
    if (path.dirname(cursor) === cursor) break;
  }
  if (!fs.existsSync(store)) fs.mkdirSync(store, { mode: 0o700 });
  const stat = fs.lstatSync(store);
  assert(stat.isDirectory() && (stat.mode & 0o077) === 0 && stat.uid === process.getuid(), 'Store must be owner-private');
  const names = fs.readdirSync(store);
  assert(names.length <= 1000 && names.every(name => /^(receipt|proposal)-[a-z0-9][a-z0-9_-]{0,63}\.json$/.test(name)), 'Invalid store entries or capacity');
  return store;
}

function load(store, type, key) {
  assert(id(key), 'Invalid ID');
  const file = path.join(store, `${type}-${key}.json`);
  if (!fs.existsSync(file)) return null;
  const stat = fs.lstatSync(file);
  assert(!stat.isSymbolicLink() && (stat.mode & 0o077) === 0, 'Evidence must be private');
  return JSON.parse(read(file));
}

function proposals(store) {
  return fs.readdirSync(store).filter(name => name.startsWith('proposal-'))
    .map(name => load(store, 'proposal', name.slice(9, -5)));
}

function persist(store, type, key, value) {
  const previous = load(store, type, key);
  if (previous) {
    assert(encode(previous) === encode(value), 'Conflicting duplicate');
    return { status: 'duplicate' };
  }
  assert(fs.readdirSync(store).filter(name => name !== '.lock').length < 1000, 'Store capacity exceeded');
  const file = path.join(store, `${type}-${key}.json`);
  // Exclusive creation: collisions fail closed, with no overwrite.
  const temporary = path.join(store, '.lock', 'value');
  try {
    fs.writeFileSync(temporary, encode(value), { flag: 'wx', mode: 0o600 });
    fs.linkSync(temporary, file);
  } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  return { status: 'recorded' };
}

function matches(receipt, proposal) {
  return ['kind', 'classId', 'checkId'].every(key => receipt[key] === proposal[key]);
}

function record(store, input) {
  exact(input, ['version', 'id', 'kind', 'classId', 'checkId', 'head', 'outcome', 'durationMs', 'repairCount', 'evidence']);
  assert(input.version === 1 && id(input.id) && id(input.classId) && id(input.checkId), 'Invalid receipt identity');
  assert(['real', 'synthetic'].includes(input.kind) && ['passed', 'failed', 'unknown'].includes(input.outcome), 'Invalid receipt classification');
  assert(typeof input.head === 'string' && /^[a-f0-9]{40}$/.test(input.head), 'Full commit SHA required');
  assert(metric(input.durationMs) && metric(input.repairCount), 'Invalid metrics');
  exact(input.evidence, ['path', 'sha256']);
  assert(typeof input.evidence.path === 'string' && path.isAbsolute(input.evidence.path)
    && /^[a-f0-9]{64}$/.test(input.evidence.sha256), 'Invalid evidence');
  assert(digest(read(input.evidence.path, 10 * 1024 * 1024)) === input.evidence.sha256, 'Evidence digest mismatch');
  const value = { ...input, evidence: { sha256: input.evidence.sha256 }, outcomeTrust: 'operator_attested' };
  for (const proposal of proposals(store)) {
    if (proposal.candidateIds.includes(input.id)) assert(matches(value, proposal), 'Prospective cohort mismatch');
  }
  return persist(store, 'receipt', input.id, value);
}

function propose(store, input) {
  exact(input, ['version', 'id', 'kind', 'classId', 'checkId', 'summary', 'enforcement', 'baselineIds', 'candidateIds']);
  assert(input.version === 1 && id(input.id) && id(input.classId) && id(input.checkId), 'Invalid proposal identity');
  assert(['real', 'synthetic'].includes(input.kind), 'Invalid proposal classification');
  assert(typeof input.summary === 'string' && input.summary.length > 0 && input.summary.length <= 500
    && !/[\r\n\x00-\x1f]/.test(input.summary), 'Invalid summary');
  assert(['regression_test', 'guard', 'helper', 'contract', 'documentation'].includes(input.enforcement), 'Invalid enforcement');
  assert(list(input.baselineIds) && list(input.candidateIds)
    && input.candidateIds.every(key => !input.baselineIds.includes(key)), 'Invalid cohort IDs');
  const support = input.baselineIds.map(key => {
    const receipt = load(store, 'receipt', key);
    assert(receipt && matches(receipt, input), 'Missing or mismatched baseline');
    return { id: key, sha256: digest(encode(receipt)) };
  });
  const value = { ...input, support, status: 'needs_human_review' };
  const previous = load(store, 'proposal', input.id);
  if (previous) return persist(store, 'proposal', input.id, value);
  assert(input.candidateIds.every(key => !load(store, 'receipt', key)), 'Prospective tasks already recorded');
  for (const proposal of proposals(store)) {
    assert(input.candidateIds.every(key => !proposal.candidateIds.includes(key)), 'Prospective task already reserved');
  }
  return persist(store, 'proposal', input.id, value);
}

function aggregate(receipts) {
  const result = { recorded: receipts.length, passed: 0, failed: 0, unknown: 0,
    durationMs: { total: 0, measured: 0 }, repairCount: { total: 0, measured: 0 } };
  for (const receipt of receipts) {
    result[receipt.outcome]++;
    for (const key of ['durationMs', 'repairCount']) if (receipt[key] !== null) {
      result[key].total += receipt[key]; result[key].measured++;
    }
  }
  return result;
}

function report(store, key) {
  const proposal = load(store, 'proposal', key);
  assert(proposal, 'Proposal not found');
  const baseline = proposal.support.map(ref => {
    const receipt = load(store, 'receipt', ref.id);
    assert(receipt && digest(encode(receipt)) === ref.sha256, 'Baseline evidence changed');
    return receipt;
  });
  const candidate = proposal.candidateIds.map(key => load(store, 'receipt', key)).filter(Boolean);
  assert(candidate.every(receipt => matches(receipt, proposal)), 'Prospective cohort mismatch');
  return { status: proposal.status, kind: proposal.kind, outcomeTrust: 'operator_attested',
    baseline: aggregate(baseline), candidate: aggregate(candidate),
    pending: proposal.candidateIds.length - candidate.length, effectiveness: 'not_established' };
}

export function run(command, store, input) {
  assert(['record', 'propose', 'report'].includes(command), 'Use record, propose or report');
  store = privateStore(store);
  const lock = path.join(store, '.lock');
  fs.mkdirSync(lock, { mode: 0o700 });
  try {
    if (command === 'report') return report(store, input);
    return command === 'record' ? record(store, input) : propose(store, input);
  } finally { fs.rmdirSync(lock); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    assert(process.argv.length === 5, 'Usage: node development-learning.mjs record|propose|report /absolute/private/store input.json|proposal-id');
    const [, , command, store, source] = process.argv;
    const input = command === 'report' ? source : JSON.parse(read(source));
    console.log(JSON.stringify(run(command, store, input)));
  } catch {
    // Do not echo inputs, file paths, logs or low-level exception contents.
    console.error('Development learning failed: check schema, private store, evidence digest and cohort identities.');
    process.exitCode = 1;
  }
}
