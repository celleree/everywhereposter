import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { run } from './development-learning.mjs';

const cli = fileURLToPath(new URL('./development-learning.mjs', import.meta.url));
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ep-learning-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const evidence = path.join(dir, 'evidence');
  fs.writeFileSync(evidence, 'sanitized test result');
  const receipt = { version: 1, id: 'baseline', kind: 'synthetic', classId: 'workflow', checkId: 'unit',
    head: 'a'.repeat(40), outcome: 'passed', durationMs: null, repairCount: 0,
    evidence: { path: evidence, sha256: createHash('sha256').update(fs.readFileSync(evidence)).digest('hex') } };
  const proposal = { version: 1, id: 'proposal', kind: 'synthetic', classId: 'workflow', checkId: 'unit',
    summary: 'Add a regression guard', enforcement: 'regression_test', baselineIds: ['baseline'], candidateIds: ['future', 'future-two'] };
  const store = path.join(dir, 'store');
  return { dir, store, receipt, proposal, invoke: (command, value) => run(command, store, value) };
}

test('record/propose/report closes a measured loop without activating a proposal', t => {
  const f = fixture(t);
  assert.equal(f.invoke('record', f.receipt).status, 'recorded');
  assert.equal(f.invoke('record', Object.fromEntries(Object.entries(f.receipt).reverse())).status, 'duplicate');
  const { status, reportToken } = f.invoke('propose', f.proposal);
  assert.equal(status, 'recorded');
  assert.match(reportToken, /^proposal:[a-f0-9]{64}$/);
  f.invoke('record', { ...f.receipt, id: 'future', outcome: 'failed', durationMs: 12, repairCount: null });
  f.invoke('record', { ...f.receipt, id: 'future-two', outcome: 'unknown', durationMs: null, repairCount: null });
  assert.deepEqual(f.invoke('propose', f.proposal), { status: 'duplicate' });
  const report = f.invoke('report', reportToken);
  assert.equal(report.status, 'needs_human_review');
  assert.equal(report.effectiveness, 'not_established');
  assert.equal(report.outcomeTrust, 'operator_attested');
  assert.equal(report.pending, 0);
  assert.deepEqual(report.candidate, { recorded: 2, passed: 0, failed: 1, unknown: 1,
    durationMs: { total: 12, measured: 1 }, repairCount: { total: 0, measured: 0 } });
  assert.equal(fs.statSync(f.store).mode & 0o077, 0);
  const stored = fs.readFileSync(path.join(f.store, 'receipt-baseline.json'), 'utf8');
  assert(!stored.includes(f.dir) && !stored.includes('sanitized test result'));
});

test('rejects conflicting replay, extra fields, invalid metrics and altered evidence', t => {
  const f = fixture(t);
  f.invoke('record', f.receipt);
  for (const patch of [{ outcome: 'failed' }, { transcript: 'PRIVATE_SENTINEL' }, { durationMs: -1 },
    { repairCount: 0.5 }, { head: 'short' }, { durationMs: Number.MAX_SAFE_INTEGER + 1 }]) {
    assert.throws(() => f.invoke('record', { ...f.receipt, ...patch }));
  }
  fs.writeFileSync(f.receipt.evidence.path, 'changed');
  assert.throws(() => f.invoke('record', { ...f.receipt, id: 'new' }), /digest/);
});

test('prospective cohorts reject retrospective IDs, mixed classes, sources and reservations', t => {
  const f = fixture(t);
  f.invoke('record', f.receipt);
  assert.throws(() => f.invoke('propose', { ...f.proposal, candidateIds: ['baseline'] }));
  f.invoke('record', { ...f.receipt, id: 'old' });
  assert.throws(() => f.invoke('propose', { ...f.proposal, candidateIds: ['old'] }), /already recorded/);
  assert.throws(() => f.invoke('propose', { ...f.proposal, kind: 'real' }), /baseline/);
  const { reportToken } = f.invoke('propose', f.proposal);
  assert.throws(() => f.invoke('propose', { ...f.proposal, id: 'second' }), /reserved/);
  for (const patch of [{ kind: 'real' }, { checkId: 'other' }, { classId: 'other' }]) {
    assert.throws(() => f.invoke('record', { ...f.receipt, id: 'future', ...patch }), /mismatch/);
  }
  assert.throws(() => f.invoke('propose', { ...f.proposal, summary: 'changed' }), /duplicate/);
  assert.equal(f.invoke('report', reportToken).pending, 2);
});

test('bound supporting receipts and fail closed on concurrent access', t => {
  const f = fixture(t);
  f.invoke('record', f.receipt);
  const { reportToken } = f.invoke('propose', f.proposal);
  const file = path.join(f.store, 'receipt-baseline.json');
  const value = JSON.parse(fs.readFileSync(file));
  value.outcome = 'failed';
  fs.writeFileSync(file, JSON.stringify(value));
  assert.throws(() => f.invoke('report', reportToken), /changed/);
  fs.mkdirSync(path.join(f.store, '.lock'));
  assert.throws(() => f.invoke('report', reportToken));
});

test('retained creation token rejects edited cohorts, status, support and fields', t => {
  const f = fixture(t);
  f.invoke('record', f.receipt);
  f.invoke('record', { ...f.receipt, id: 'old' });
  const { reportToken } = f.invoke('propose', f.proposal);
  const file = path.join(f.store, 'proposal-proposal.json');
  const original = JSON.parse(fs.readFileSync(file));
  for (const token of [undefined, 'proposal', reportToken + ':extra', 'proposal:not-a-hash']) {
    assert.throws(() => f.invoke('report', token), /token/);
  }
  for (const patch of [{ candidateIds: ['old'] }, { status: 'approved' }, { support: [] }, { extra: 'PRIVATE_SENTINEL' }]) {
    fs.writeFileSync(file, JSON.stringify({ ...original, ...patch }));
    assert.throws(() => f.invoke('report', reportToken), /integrity/);
  }
  const altered = JSON.stringify({ ...original, status: 'approved' }) + '\n';
  fs.writeFileSync(file, altered);
  const forged = 'proposal:' + createHash('sha256').update(altered).digest('hex');
  assert.throws(() => f.invoke('report', forged), /stored proposal state/);
});

test('editing then replaying a proposal never issues a replacement creation token', t => {
  const f = fixture(t);
  f.invoke('record', f.receipt);
  f.invoke('record', { ...f.receipt, id: 'old' });
  const { reportToken } = f.invoke('propose', f.proposal);
  const file = path.join(f.store, 'proposal-proposal.json');
  const value = JSON.parse(fs.readFileSync(file));
  value.candidateIds = ['old'];
  fs.writeFileSync(file, JSON.stringify(value));
  assert.deepEqual(f.invoke('propose', { ...f.proposal, candidateIds: ['old'] }), { status: 'duplicate' });
  assert.throws(() => f.invoke('report', reportToken), /integrity/);
  assert.throws(() => f.invoke('propose', { ...f.proposal, id: 'new', candidateIds: ['old'] }), /already recorded/);
});

test('rejects Git storage, permissive storage and symlinks', t => {
  const f = fixture(t);
  fs.mkdirSync(f.store, { mode: 0o755 });
  fs.chmodSync(f.store, 0o755);
  assert.throws(() => f.invoke('record', f.receipt), /private/);
  fs.chmodSync(f.store, 0o700);
  fs.symlinkSync(f.receipt.evidence.path, path.join(f.dir, 'symlink'));
  assert.throws(() => f.invoke('record', { ...f.receipt, evidence: { ...f.receipt.evidence, path: path.join(f.dir, 'symlink') } }));
  fs.mkdirSync(path.join(f.dir, '.git'));
  fs.writeFileSync(path.join(f.dir, '.git', 'HEAD'), 'ref: refs/heads/main');
  assert.throws(() => f.invoke('record', f.receipt), /outside Git/);
});

test('CLI bounds input and never echoes private error content', t => {
  const f = fixture(t);
  const input = path.join(f.dir, 'input.json');
  fs.writeFileSync(input, JSON.stringify({ ...f.receipt, transcript: 'PRIVATE_SENTINEL' }));
  for (const content of [null, 'PRIVATE_SENTINEL'.repeat(10000)]) {
    if (content) fs.writeFileSync(input, content);
    const child = spawnSync(process.execPath, [cli, 'record', f.store, input], { encoding: 'utf8' });
    assert.equal(child.status, 1);
    assert(!child.stdout.includes('PRIVATE_SENTINEL') && !child.stderr.includes('PRIVATE_SENTINEL'));
    assert(!child.stderr.includes(f.dir));
  }
});
