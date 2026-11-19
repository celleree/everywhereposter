import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { bindScope, changedPaths, checkPaths, parseScope, pathEntry, protectedPath, verifyScope } from './task-path-scope.mjs';

const temporary = mkdtempSync(join(tmpdir(), 'task-scope-test-'));
after(() => rmSync(temporary, { recursive: true, force: true }));
const body = (owned = ['docs/'], prohibited = ['docs/private/']) => `### Expected scope

Owned paths:
${owned.map((p) => `- ${p}`).join('\n')}

Shared paths or dependencies:
- None

### Explicitly out of scope

Prohibited paths:
${prohibited.map((p) => `- ${p}`).join('\n')}

Other behavior exclusions:
- Keep unrelated behavior unchanged.
`;
let sequence = 0;
function fixture(owned, prohibited) {
  const root = join(temporary, `repo-${sequence++}`);
  mkdirSync(join(root, 'docs/private'), { recursive: true });
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
  git('init', '-q'); git('config', 'user.name', 'Scope fixture'); git('config', 'user.email', 'fixture@example.invalid');
  writeFileSync(join(root, 'docs/a.md'), 'before\n');
  writeFileSync(join(root, 'docs/private/keep.md'), 'private\n');
  writeFileSync(join(root, '.gitignore'), '*.ignored\n');
  git('add', '.'); git('commit', '-qm', 'fixture');
  const start = git('rev-parse', 'HEAD');
  const snapshot = join(temporary, `issue-${sequence}.json`);
  writeFileSync(snapshot, JSON.stringify({ number: 42, state: 'OPEN', body: body(owned, prohibited) }));
  const contract = bindScope(snapshot, 'owner/repository', 42, root, start);
  return { root, git, start, snapshot, contract };
}

test('existing labels parse exact files/directories, None and prohibition precedence', () => {
  assert.deepEqual(parseScope(body(['docs/a.md'], ['None'])), { owned: ['docs/a.md'], prohibited: [] });
  for (const altered of [body().replace('Owned paths:', 'Paths:'), body().replace('- None', '- shared/file.md'), body().replace('Prohibited paths:', 'Prohibited paths:\n- None'), body() + '\n### Expected scope\nDuplicate']) {
    assert.throws(() => parseScope(altered));
  }
  assert.throws(() => parseScope(body(['docs/a.md'], ['docs/'])), /prohibited_owned_path/);
  assert.throws(() => parseScope(body(['docs/a.md', 'docs/a.md'], ['None'])), /ambiguous/);
  const f = fixture();
  assert.throws(() => checkPaths(f.contract, ['docs/private/new.md']), /prohibited/);
  assert.throws(() => checkPaths(f.contract, ['docsish/a.md']), /unowned/);
});

test('ambiguous, absolute, traversal, glob, backslash and control paths are rejected', () => {
  for (const value of ['/etc/file', '../file', 'a/../b', './a', 'a/./b', 'a//b', 'C:/file', 'a\\b', 'a*', 'a?', 'a[0]', 'a{b}', 'a\nb', 'a\tb', 'a\u007fb', ' a', 'a ', '.git/config']) assert.throws(() => pathEntry(value));
  assert.equal(pathEntry('docs/a b.md'), 'docs/a b.md');
  assert.equal(pathEntry('docs/-literal.md'), 'docs/-literal.md');
});

test('governance and existing secret/dependency/container protections always win', () => {
  for (const file of ['AGENTS.md', 'docs/AGENTS.md', 'src/AGENTS.override.md', 'src/CLAUDE.md', 'src/.gitattributes', 'src/.gitmodules', 'src/.githooks/pre-push', 'scripts/check-canonical-branch.sh', '.agents/task', 'src/.github/task', 'src/.codex/task', 'docs/brain/a.md', 'scripts/agents/test.mjs', 'scripts/local-agent-doctor.sh', 'scripts/local-agent-diagnostics.sh', 'scripts/test-local-agent-doctor.sh', '.env.local', 'src/credentials.json', 'postiz-app/package.json', 'x/pnpm-lock.yaml', 'prisma/migrations/one.sql', 'Dockerfile.production', 'x/compose.dev.yml']) {
    assert.equal(protectedPath(file), true, file);
    assert.throws(() => parseScope(body([file], ['None'])), /protected/);
  }
  for (const file of ['docs/.githubish/a.md', 'docs/.githooksish/a.md', 'docs/agents-guide.md', 'src/AGENTS.md.example']) assert.equal(protectedPath(file), false, file);
});

test('real Git tracks additions, deletions, staged-only changes and reversals separately', () => {
  const f = fixture();
  writeFileSync(join(f.root, 'docs/a.md'), 'staged\n'); f.git('add', 'docs/a.md');
  writeFileSync(join(f.root, 'docs/a.md'), 'before\n');
  writeFileSync(join(f.root, 'outside.txt'), 'not owned');
  assert.throws(() => changedPaths(f.contract), /unowned/);
  rmSync(join(f.root, 'outside.txt'));
  assert.deepEqual(changedPaths(f.contract), ['docs/a.md']);
  assert.throws(() => changedPaths(f.contract, true), /index_does_not_match/);
  f.git('reset', '--hard', '-q'); rmSync(join(f.root, 'docs/a.md'));
  writeFileSync(join(f.root, 'docs/new file.md'), 'new\n');
  assert.deepEqual(changedPaths(f.contract), ['docs/a.md', 'docs/new file.md']);
  f.git('--literal-pathspecs', 'add', '-A', '--', 'docs/a.md', 'docs/new file.md');
  assert.deepEqual(changedPaths(f.contract, true), ['docs/a.md', 'docs/new file.md']);
  writeFileSync(join(f.root, 'docs/line\nbreak.md'), 'invalid changed name');
  assert.throws(() => changedPaths(f.contract), /invalid_scope_path/);
});

test('renames require both old and new paths even when rename detection is enabled', () => {
  const f = fixture(['docs/a.md'], ['None']);
  f.git('mv', 'docs/a.md', 'docs/renamed.md');
  assert.throws(() => changedPaths(f.contract), /unowned/);
  const allowed = bindScope(f.snapshot, 'owner/repository', 42, f.root, f.start);
  allowed.scope.owned = ['docs/'];
  assert.deepEqual(changedPaths(allowed), ['docs/a.md', 'docs/renamed.md']);
});

test('changed/deleted symlinks, gitlinks and symlink ancestors fail closed', () => {
  const f = fixture();
  symlinkSync('/tmp', join(f.root, 'docs/link'));
  assert.throws(() => changedPaths(f.contract), /symlink/);
  assert.throws(() => checkPaths(f.contract, ['docs/link/file.md']), /symlink/);
  rmSync(join(f.root, 'docs/link'));
  f.git('update-index', '--add', '--cacheinfo', `160000,${f.start},docs/module`);
  assert.throws(() => changedPaths(f.contract), /unsafe_index_mode/);
  f.git('reset', '--hard', '-q');
  symlinkSync('/tmp/absent-target', join(f.root, 'docs/link'));
  f.git('add', 'docs/link'); f.git('commit', '-qm', 'symlink fixture');
  const contract = { ...f.contract, startSha: f.git('rev-parse', 'HEAD') };
  rmSync(join(f.root, 'docs/link')); f.git('add', '-u');
  assert.throws(() => changedPaths(contract), /unsafe_tree_mode/);
});

test('snapshot bytes, normalized scope, repository, issue, start and PR head are pinned', () => {
  const f = fixture();
  verifyScope(f.contract, f.snapshot, 'owner/repository', 42, f.root, f.start);
  for (const key of ['repository', 'issue', 'startSha', 'prHead', 'scopeHash', 'snapshotHash']) assert.throws(() => verifyScope({ ...f.contract, [key]: 'altered' }, f.snapshot, 'owner/repository', 42, f.root, f.start), /scope_contract_changed/);
  writeFileSync(f.snapshot, readFileSync(f.snapshot, 'utf8') + '\n');
  assert.throws(() => verifyScope(f.contract, f.snapshot, 'owner/repository', 42, f.root, f.start), /scope_contract_changed/);
});
