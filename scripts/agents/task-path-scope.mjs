import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const reject = (code) => { throw new Error(code); };
const hash = (value) => createHash('sha256').update(value).digest('hex');
const decode = (value) => new TextDecoder('utf-8', { fatal: true }).decode(value);
const nul = (value) => {
  if (!value.length) return [];
  if (value.at(-1) !== 0) reject('malformed_git_inventory');
  return decode(value.subarray(0, -1)).split('\0');
};
const git = (root, args) => execFileSync('git', ['--literal-pathspecs', ...args], {
  cwd: root, maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
});

export function pathEntry(value, directoryAllowed = true) {
  if (typeof value !== 'string' || !value || value !== value.trim() ||
      /[\p{Cc}\\*?\[\]{}:]/u.test(value) || value.startsWith('/')) reject('invalid_scope_path');
  const directory = value.endsWith('/');
  if (directory && !directoryAllowed) reject('invalid_changed_path');
  const parts = (directory ? value.slice(0, -1) : value).split('/');
  if (parts.some((part) => !part || part === '.' || part === '..' || part === '.git' || part !== part.trim())) {
    reject('invalid_scope_path');
  }
  return value;
}

export function protectedPath(value) {
  return /(^|\/)(\.agents|\.codex|\.github|\.githooks)(\/|$)/.test(value) ||
    /(^|\/)(AGENTS\.md|AGENTS\.override\.md|CLAUDE\.md|\.gitattributes|\.gitmodules)$/.test(value) ||
    /^(AGENTS\.md|OPERATING-MANUAL\.md|docs\/brain(?:\/|$)|scripts\/agents(?:\/|$)|scripts\/(?:install-git-guardrails|check-repository-state|check-canonical-branch|start-change|(?:test-)?local-agent-(?:doctor|diagnostics))\.sh)/.test(value) ||
    /(^|\/)(\.env($|\.)|secrets?($|\/|\.)|credentials?($|\/|\.)|id_rsa($|\.)|[^/]+\.(pem|key)$)/.test(value) ||
    /(^|\/)(package\.json|pnpm-lock\.yaml|package-lock\.json|yarn\.lock|bun\.lockb?)$|(^|\/)prisma\/(schema\.prisma|migrations\/)/.test(value) ||
    /(^|\/)(Dockerfile[^/]*|compose[^/]*\.ya?ml|docker-compose[^/]*\.ya?ml)$/.test(value);
}

function section(body, name) {
  const headings = body.split('\n');
  const indexes = headings.flatMap((line, index) => line === `### ${name}` ? [index] : []);
  if (indexes.length !== 1) reject('ambiguous_scope_section');
  const start = indexes[0] + 1;
  const end = headings.findIndex((line, index) => index >= start && line.startsWith('###'));
  return headings.slice(start, end < 0 ? undefined : end);
}

function lists(lines, names, allowOther = false) {
  const result = Object.fromEntries(names.map((name) => [name, []]));
  const seen = new Set();
  let current;
  for (const [index, line] of lines.entries()) {
    if (!line.trim()) continue;
    if (allowOther && line === 'Other behavior exclusions:') {
      if (seen.size !== names.length || !result[names.at(-1)].length) reject('malformed_path_lists');
      if (lines.slice(index + 1).some((text) => [...names, 'Owned paths:', 'Shared paths or dependencies:', 'Other behavior exclusions:'].includes(text))) reject('duplicate_path_list');
      return result;
    }
    if (names.includes(line)) {
      if (seen.has(line) || names[seen.size] !== line) reject('duplicate_path_list');
      current = line; seen.add(line); continue;
    }
    if (!current || !line.startsWith('- ') || line.length === 2) reject('malformed_path_lists');
    result[current].push(line.slice(2));
  }
  if (seen.size !== names.length || Object.values(result).some((entries) => !entries.length)) reject('missing_path_list');
  return result;
}

export function parseScope(body) {
  if (typeof body !== 'string' || /\r/.test(body)) reject('malformed_scope_body');
  const expected = lists(section(body, 'Expected scope'), ['Owned paths:', 'Shared paths or dependencies:']);
  if (JSON.stringify(expected['Shared paths or dependencies:']) !== '["None"]') reject('unresolved_shared_paths');
  const excluded = lists(section(body, 'Explicitly out of scope'), ['Prohibited paths:'], true);
  const owned = expected['Owned paths:'].map((value) => pathEntry(value)).sort();
  const rawProhibited = excluded['Prohibited paths:'];
  const prohibited = JSON.stringify(rawProhibited) === '["None"]' ? [] : rawProhibited.map((value) => pathEntry(value)).sort();
  if (owned.includes('None') || rawProhibited.includes('None') && prohibited.length ||
      new Set(owned.map((p) => p.replace(/\/$/, ''))).size !== owned.length ||
      new Set(prohibited.map((p) => p.replace(/\/$/, ''))).size !== prohibited.length) reject('ambiguous_scope_paths');
  if (owned.some(protectedPath)) reject('protected_owned_path');
  if (owned.some((file) => prohibited.some((entry) => matches(file.replace(/\/$/, ''), entry) || file === entry))) reject('prohibited_owned_path');
  return { owned, prohibited };
}

const matches = (file, entry) => entry.endsWith('/') ? file.startsWith(entry) : file === entry;
const stat = (file) => {
  try { return lstatSync(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
};
function noSymlinks(root, file, changed = false) {
  const parts = file.replace(/\/$/, '').split('/');
  for (let i = 1; i <= parts.length; i++) {
    const value = stat(join(root, ...parts.slice(0, i)));
    if (value?.isSymbolicLink()) reject('symlink_path');
    if (value && (i < parts.length && !value.isDirectory() || changed && i === parts.length && !value.isFile())) reject('nonregular_path');
  }
}

export function readScope(snapshot, repository, issue, root) {
  if (!/^[^/\s]+\/[^/\s]+$/.test(repository) || !/^[1-9][0-9]*$/.test(String(issue))) reject('invalid_scope_identity');
  const bytes = readFileSync(snapshot);
  const item = JSON.parse(decode(bytes));
  if (item.number !== Number(issue) || item.state !== 'OPEN') reject('wrong_scope_issue');
  const scope = parseScope(item.body);
  for (const value of scope.owned) noSymlinks(root, value);
  return { repository, issue: Number(issue), root: realpathSync(root), snapshotHash: hash(bytes), scopeHash: hash(JSON.stringify(scope)), scope };
}

export function bindScope(snapshot, repository, issue, root, startSha, prHead = '') {
  if (!/^[0-9a-f]{40}$/.test(startSha) || prHead && !/^[0-9a-f]{40}$/.test(prHead)) reject('invalid_start_revision');
  return { version: 1, ...readScope(snapshot, repository, issue, root), startSha, prHead };
}

function modes(root, paths, refs) {
  const records = nul(git(root, ['ls-files', '--stage', '-z', '--', ...paths]));
  for (const record of records) {
    const match = /^(\d{6}) [0-9a-f]+ ([0-3])\t/.exec(record);
    if (!match || match[2] !== '0' || !['100644', '100755'].includes(match[1])) reject('unsafe_index_mode');
  }
  for (const ref of refs) {
    for (const record of nul(git(root, ['ls-tree', '-rz', ref, '--', ...paths]))) {
      if (!/^(100644|100755) blob [0-9a-f]+\t/.test(record)) reject('unsafe_tree_mode');
    }
  }
}

export function checkPaths(contract, paths, refs = [contract.startSha]) {
  paths = [...new Set(paths)].sort();
  if (paths.length > 30) reject('too_many_changed_paths');
  for (const file of paths) {
    pathEntry(file, false);
    if (protectedPath(file) || contract.scope.prohibited.some((entry) => matches(file, entry))) reject('prohibited_changed_path');
    if (!contract.scope.owned.some((entry) => matches(file, entry))) reject('unowned_changed_path');
    noSymlinks(contract.root, file, true);
  }
  if (paths.length) modes(contract.root, paths, refs);
  return paths;
}

export function verifyScope(contract, snapshot, repository, issue, root, startSha, prHead = '') {
  const expected = bindScope(snapshot, repository, issue, root, startSha, prHead);
  if (JSON.stringify(contract) !== JSON.stringify(expected)) reject('scope_contract_changed');
  if (decode(git(root, ['rev-parse', 'HEAD'])).trim() !== startSha) reject('scope_start_changed');
}

export function changedPaths(contract, indexRequired = false) {
  const root = contract.root;
  const staged = nul(git(root, ['diff', '--name-only', '-z', '--no-renames', '--cached', contract.startSha, '--']));
  const unstaged = nul(git(root, ['diff', '--name-only', '-z', '--no-renames', '--']));
  const untracked = nul(git(root, ['ls-files', '--others', '--exclude-standard', '-z']));
  const all = checkPaths(contract, [...staged, ...unstaged, ...untracked]);
  if (!all.length || indexRequired && !staged.length) reject('no_staged_changes');
  if (indexRequired && (unstaged.length || untracked.length)) reject('index_does_not_match_worktree');
  return all;
}

export function checkBoundScope(mode, contract, args) {
  if (!['collect', 'index', 'pr'].includes(mode) || args.length !== (mode === 'pr' ? 7 : 6)) reject('scope_usage');
  const [snapshot, repository, issue, root, startSha, prHead, baseSha] = args;
  if (mode === 'pr' && !/^[0-9a-f]{40}$/.test(baseSha)) reject('invalid_pr_base');
  verifyScope(contract, snapshot, repository, issue, root, startSha, prHead);
  return mode === 'pr'
    ? checkPaths(contract, nul(git(root, ['diff', '--name-only', '-z', '--no-renames', `${baseSha}...${prHead}`, '--'])), [baseSha, prHead])
    : changedPaths(contract, mode === 'index');
}

function main([mode, ...args]) {
  if (mode === 'parse' && args.length === 4) return console.log(JSON.stringify(readScope(...args)));
  if (mode === 'bind' && args.length === 6) return console.log(JSON.stringify(bindScope(...args)));
  const [file, ...parameters] = args;
  const contract = JSON.parse(readFileSync(file, 'utf8'));
  const files = checkBoundScope(mode, contract, parameters);
  if (mode === 'collect') process.stdout.write(Buffer.from(files.map((file) => `${file}\0`).join('')));
}

if (import.meta.url.startsWith('file:') && process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); } catch {
    console.error('ERROR: Task path scope could not be verified; no staging or commit is authorized.');
    process.exitCode = 1;
  }
}
