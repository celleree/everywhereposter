// Offline policy/receipt handling and one direct CLI child; no provider probe or fallback.
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { constants as C, closeSync, fstatSync, fsyncSync, lstatSync, openSync, readSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { constants as OS } from 'node:os';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const encoded = value => Buffer.from(`${JSON.stringify(value)}\n`);
const assert = (value) => { if (!value) throw new Error('execution_contract'); };
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const safeInteger = value => Number.isSafeInteger(value) && value >= 0;
const PAIRS = { 'gpt-6-luna': ['low','medium','high','xhigh','max'], 'gpt-6.1-sol': ['low','medium','high','xhigh','max','ultra'], 'gpt-6-astra': ['low','medium','high','xhigh','max','ultra'] };
export function boundedRead(file, limit) {
  const fd = openSync(file, C.O_RDONLY | C.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    assert(stat.isFile() && stat.size <= limit);
    const bytes = Buffer.alloc(limit + 1), count = readSync(fd, bytes, 0, bytes.length, 0);
    assert(count <= limit);
    return bytes.subarray(0, count);
  } finally { closeSync(fd); }
}
// Linux directory descriptors anchor every receipt operation even if its declared path moves.
function openDirectory(path) {
  let fd = openSync('/', C.O_RDONLY | C.O_DIRECTORY | C.O_NOFOLLOW);
  const identities = [];
  try {
    const remember = () => { const st = fstatSync(fd, { bigint: true }); identities.push(`${st.dev}:${st.ino}`); };
    remember();
    for (const part of resolve(path).split('/').filter(Boolean)) {
      const next = openSync(`/proc/self/fd/${fd}/${part}`, C.O_RDONLY | C.O_DIRECTORY | C.O_NOFOLLOW);
      closeSync(fd); fd = next; remember();
    }
    return { fd, identities };
  } catch (error) { closeSync(fd); throw error; }
}
function pinReceipt(file) {
  assert(isAbsolute(file));
  const directory = dirname(file), pinned = openDirectory(directory);
  const check = () => {
    const current = openDirectory(directory);
    try {
      const st = fstatSync(pinned.fd);
      assert(JSON.stringify(current.identities) === JSON.stringify(pinned.identities));
      assert(st.uid === process.getuid() && (st.mode & 0o777) === 0o700);
    } finally { closeSync(current.fd); }
  };
  try { check(); } catch (error) { closeSync(pinned.fd); throw error; }
  return { file: `/proc/self/fd/${pinned.fd}/${basename(file)}`, fd: pinned.fd, check, close: () => closeSync(pinned.fd) };
}
function persist(pinned, value, create = false) {
  pinned.check();
  const file = pinned.file;
  const bytes = encoded(value); assert(bytes.length <= 65536);
  if (!create) { const st = lstatSync(file); assert(st.isFile() && st.uid === process.getuid() && (st.mode & 0o777) === 0o600 && st.nlink === 1); }
  const temporary = create ? file : `${file}.${randomUUID()}`;
  const fd = openSync(temporary, C.O_WRONLY | C.O_CREAT | C.O_EXCL | C.O_NOFOLLOW, 0o600);
  try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
  if (!create) renameSync(temporary, file);
  fsyncSync(pinned.fd);
  pinned.check();
  return hash(bytes);
}
export function authorize(policy, requested) {
  assert(policy.version === 1 && policy.settingsSource === 'github-actions-vars');
  assert(JSON.stringify(policy.globalAllowlist) === JSON.stringify(Object.keys(PAIRS)));
  assert(JSON.stringify(policy.unattendedAllowlist) === JSON.stringify(Object.keys(PAIRS).slice(0,2)));
  assert(object(requested) && requested.source === policy.settingsSource);
  assert(typeof requested.model === 'string' && typeof requested.reasoningEffort === 'string');
  assert(policy.unattendedAllowlist.includes(requested.model));
  assert(PAIRS[requested.model].includes(requested.reasoningEffort));
  assert(policy.advertisedSnapshot.models[requested.model].includes(requested.reasoningEffort));
  return { model: requested.model, reasoningEffort: requested.reasoningEffort, source: requested.source };
}
function checkedArgv(argv, authorized) {
  assert(argv.every(value => typeof value === 'string' && !value.includes('\0')));
  assert(argv[0] === '--ask-for-approval' && argv[1] === 'never' && argv[2] === 'exec');
  assert(argv.filter(value => value === '--model').length === 1 && argv[argv.indexOf('--model') + 1] === authorized.model);
  assert(argv.filter(value => value === '--json').length === 1 && argv.filter(value => value === '--ignore-user-config').length === 1);
  const configs = argv.flatMap((value,index) => value === '--config' ? [argv[index+1]] : []);
  const effort = `model_reasoning_effort="${authorized.reasoningEffort}"`;
  assert(configs.filter(value => value === effort).length === 1);
  assert(!configs.some(value => /^\s*model(?:_|\s*=)/.test(value) && value !== effort));
  assert(!argv.some(value => value === '-m' || value === '-c' || value.startsWith('--model=') || value.startsWith('--config=')));
  return argv;
}
export function prepare(policy, bindings, requested, identity, argv, file) {
  const authorized = authorize(policy, requested);
  checkedArgv(argv, authorized);
  assert(object(identity) && /^[0-9a-f]{40}$/.test(identity.revision));
  const receipt = { version: 1, requested, authorized, invoked: null, observed: { model: null, reasoningEffort: null, usage: null },
    identity, policy: { ...bindings, advertisedSnapshot: policy.advertisedSnapshot.fetchedAt, cliObservation: policy.cliObservation, remoteSupport: 'unverified' },
    digests: { settings: hash(encoded(requested)), identity: hash(encoded(identity)), argv: hash(encoded(argv)) }, intendedArgv: argv,
    preparedAt: new Date().toISOString(), result: null, billedCost: null };
  const pinned = pinReceipt(file);
  try { return { sha256: persist(pinned, receipt, true) }; } finally { pinned.close(); }
}
// JSON.parse alone silently accepts duplicate keys. Treat them as ambiguous telemetry.
function duplicateKeys(line) {
  const tokens = /"(?:\\.|[^"\\])*"|[{}\[\]]/g, stack = [];
  let token;
  while ((token = tokens.exec(line))) {
    const text = token[0];
    if (text === '{') stack.push(new Set());
    else if (text === '[') stack.push(null);
    else if (text === '}' || text === ']') stack.pop();
    else if (/^\s*:/.test(line.slice(tokens.lastIndex)) && stack.at(-1)) {
      const key = JSON.parse(text); if (stack.at(-1).has(key)) return true; stack.at(-1).add(key);
    }
  }
  return false;
}
export function observations(bytes) {
  const result = { model: null, reasoningEffort: null, usage: null, telemetry: { source: 'codex-exec-jsonl', stdoutSha256: hash(bytes), status: 'unknown', reason: 'missing_completion', line: null, event: null, lineSha256: null } };
  const fail = reason => { result.telemetry.reason = reason; return result; };
  if (bytes.length > 4 * 1024 * 1024) return fail('stream_limit');
  let text; try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return fail('invalid_utf8'); }
  if (text && !text.endsWith('\n')) return fail('truncated_stream');
  const lines = text.split('\n'); if (lines.length > 8193) return fail('line_limit');
  const completed = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]; if (!line.trim()) continue;
    if (Buffer.byteLength(line) > 65536) return fail('line_limit');
    let event; try { event = JSON.parse(line); } catch { return fail('malformed_stream'); }
    if (!object(event) || duplicateKeys(line)) return fail('ambiguous_stream');
    if (event.type === 'turn.failed' || event.type === 'error') return fail('failed_stream');
    if (event.type === 'turn.completed') completed.push({ event, line: index + 1, lineSha256: hash(line) });
  }
  if (completed.length !== 1) return fail(completed.length ? 'ambiguous_completion' : 'missing_completion');
  const entry = completed[0], usage = entry.event.usage;
  if (!object(usage)) return fail('missing_usage');
  const fields = ['input_tokens','cached_input_tokens','output_tokens','reasoning_output_tokens'];
  if (Object.keys(usage).some(key => !fields.includes(key)) || fields.some(key => key in usage && !safeInteger(usage[key]))) return fail('invalid_usage');
  if (usage.cached_input_tokens > usage.input_tokens || usage.reasoning_output_tokens > usage.output_tokens) return fail('invalid_usage');
  const observed = Object.fromEntries(fields.map(key => [key, key in usage ? usage[key] : null]));
  if (Object.values(observed).every(value => value === null)) return fail('missing_usage');
  result.usage = observed;
  Object.assign(result.telemetry, { status: 'cli_reported', reason: null, line: entry.line, event: 'turn.completed', lineSha256: entry.lineSha256 });
  return result;
}
function verified(pinned, expected) {
  pinned.check(); const bytes = boundedRead(pinned.file, 65536); pinned.check();
  assert(hash(bytes) === expected); return JSON.parse(bytes);
}
export function verify(file, expected) {
  const pinned = pinReceipt(file);
  try { return verified(pinned, expected); } finally { pinned.close(); }
}
export function retained(recordPath, expected) {
  assert(/^[0-9a-f]{64}$/.test(expected));
  const manifest = JSON.parse(boundedRead(join(recordPath,'receipt.json'),512*1024));
  const event = manifest.events?.at(-1), ref = event?.artifacts?.codexExecution;
  assert(event?.complete === true && event.executionSha256 === expected);
  assert(ref?.sha256 === expected && ref.file === `objects/${expected}`);
  const bytes = boundedRead(join(recordPath,ref.file),65536);
  assert(bytes.length === ref.bytes && hash(bytes) === expected);
  return { verified: true };
}
export async function launch(policy, bindings, file, expected, stdoutFile, argv, { executable = 'codex', signals = process } = {}) {
  const pinned = pinReceipt(file);
  try {
  const receipt = verified(pinned, expected);
  assert(receipt.invoked === null && receipt.policy.helperSha256 === bindings.helperSha256 && receipt.policy.policySha256 === bindings.policySha256);
  assert(JSON.stringify(authorize(policy, receipt.requested)) === JSON.stringify(receipt.authorized));
  checkedArgv(argv, receipt.authorized); assert(hash(encoded(argv)) === receipt.digests.argv);
  const started = process.hrtime.bigint();
  let child, receivedSignal = null, persistenceFailed = false, spawnError = null;
  const save = () => { try { persist(pinned, receipt); } catch { persistenceFailed = true; child?.kill('SIGTERM'); } };
  const handlers = new Map(['SIGTERM','SIGINT','SIGHUP'].map(signal => [signal, () => { receivedSignal = signal; child?.kill(signal); }]));
  for (const [signal, handler] of handlers) signals.on(signal, handler);
  let code, signal;
  try {
    child = spawn(executable, argv, { stdio: ['inherit','inherit','inherit'] });
    const outcome = await new Promise(resolve => {
      child.once('spawn', () => {
        receipt.invoked = { model: receipt.authorized.model, reasoningEffort: receipt.authorized.reasoningEffort, argvSha256: receipt.digests.argv, pid: child.pid, startedAt: new Date().toISOString(), trust: 'os_process_started' };
        save(); if (receivedSignal) child.kill(receivedSignal);
      });
      child.once('error', error => { spawnError = ['ENOENT','EACCES'].includes(error.code) ? error.code : 'spawn_error'; });
      child.once('close', (exitCode, exitSignal) => resolve({ code: exitCode, signal: exitSignal }));
    });
    ({ code, signal } = outcome);
  } finally { for (const [name, handler] of handlers) signals.off(name, handler); }
  receipt.observed = observations(boundedRead(stdoutFile, 4 * 1024 * 1024));
  const elapsedMs = Math.floor(Number(process.hrtime.bigint() - started) / 1e6);
  receipt.result = { exitCode: safeInteger(code) ? code : null, signal, receivedSignal, spawnError, elapsedMs: safeInteger(elapsedMs) ? elapsedMs : null, completedAt: new Date().toISOString() };
  assert(!persistenceFailed);
  const sha256 = persist(pinned, receipt);
  const exitCode = receivedSignal || signal ? 128 + (OS.signals[receivedSignal || signal] || 1) : safeInteger(code) ? code : 1;
  return { complete: true, sha256, exitCode };
  } finally { pinned.close(); }
}
export async function execute(mode, policy, bindings, args) {
  if (mode === 'prepare') {
    const [file, requested, identity, ...argv] = args;
    return prepare(policy, bindings, JSON.parse(requested), JSON.parse(identity), argv, file);
  }
  if (mode === 'launch') { const [file, expected, stdoutFile, ...argv] = args; return launch(policy, bindings, file, expected, stdoutFile, argv); }
  if (mode === 'verify') { verify(args[0], args[1]); return { verified: true }; }
  if (mode === 'retained') return retained(args[0],args[1]);
  throw new Error('execution_mode');
}
