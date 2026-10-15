#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

// Run with the already installed dotenv CLI; no dependencies are installed by this test.
const dotenv = resolve(process.env.DOTENV_CLI || 'postiz-app/node_modules/.bin/dotenv');
const source = await readFile(new URL('../start-postiz.sh', import.meta.url), 'utf8');

const localDatabase = 'postgresql://test:test@postiz-postgres:5432/postiz-db-local';
const startupCases = [
  { name: 'local defaults', failure: 'frontend', env: {
    SKIP_PRISMA_DB_PUSH: undefined, RUN_PRISMA_DB_PUSH_IN_PUBLIC_MODE: undefined } },
  { name: 'orchestrator supervision', failure: 'orchestrator', env: {} },
  { name: 'public managed database', failure: 'frontend', env: { MAIN_URL: 'https://app.everywhereposter.com' } },
  { name: 'legacy flags cannot enable schema writes', failure: 'frontend', env: {
    MAIN_URL: 'https://app.everywhereposter.com', RUN_PRISMA_DB_PUSH_IN_PUBLIC_MODE: 'true' } },
  { name: 'explicit public local DB override', failure: 'frontend', env: {
    FRONTEND_URL: 'https://publisheverywhere.halowebsites.com', DATABASE_URL: localDatabase,
    ALLOW_PUBLIC_DOMAIN_WITH_LOCAL_DB: 'true', RUN_PRISMA_DB_PUSH_IN_PUBLIC_MODE: 'true' } },
  { name: 'legacy skip flag', failure: 'frontend', env: { SKIP_PRISMA_DB_PUSH: 'true' } },
];

for (const { name, failure, env } of startupCases) {
  test(`${name}: schema-read-only startup preserves service supervision and dotenv parity`, { timeout: 15000 }, async () => {
    const dir = await mkdtemp(join(tmpdir(), 'postiz-start-test-'));
    const app = join(dir, 'app');
    const bin = join(dir, 'bin');
    const log = join(dir, 'events.jsonl');
    let launcher;
    try {
      for (const path of [bin, `${app}/apps/backend`, `${app}/apps/frontend`,
        `${app}/apps/orchestrator`, `${app}/node_modules/.bin`]) await mkdir(path, { recursive: true });
      await symlink(dotenv, `${app}/node_modules/.bin/dotenv`);
      await writeFile(join(dir, '.env'), 'START_TEST_LOADED=from-file\nSTART_TEST_PRIORITY=from-file\nSTART_TEST_EXPANDED=${START_TEST_LOADED}-expanded\n');
      await writeFile(join(dir, 'service.mjs'), `
import fs from 'node:fs';
const role = process.argv[2];
const emit = event => fs.appendFileSync(process.env.START_TEST_LOG, JSON.stringify({event, role, pid:process.pid,
  cwd:process.cwd(), args:process.argv.slice(3), loaded:process.env.START_TEST_LOADED,
  priority:process.env.START_TEST_PRIORITY, expanded:process.env.START_TEST_EXPANDED})+'\\n');
emit('start');
process.on('SIGTERM', () => {emit('stop'); process.exit(0)});
if(role === process.env.START_TEST_FAIL) setTimeout(() => process.exit(42), 1000);
setInterval(() => {}, 1000);
`);
      const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
      const service = quote(join(dir, 'service.mjs'));
      const node = quote(process.execPath);
      await writeFile(join(bin, 'node'), `#!/bin/sh\nif [ "$1" = - ]; then cat >/dev/null; exit 0; fi\ncase "$1" in */dotenv) exec ${node} "$@";; esac\ncase "$PWD" in */backend) role=backend;; */orchestrator) role=orchestrator;; *) echo 'unexpected node command' >&2; exit 99;; esac\nexec ${node} ${service} "$role" "$@"\n`, { mode: 0o755 });
      await writeFile(join(bin, 'nginx'), `#!/bin/sh\nexec ${node} ${service} nginx "$@"\n`, { mode: 0o755 });
      await writeFile(`${app}/node_modules/.bin/next`, `#!/bin/sh\nexec ${node} ${service} frontend "$@"\n`, { mode: 0o755 });
      // An accidental return to pnpm must fail rather than invoking package scripts.
      const prismaLog = join(dir, 'prisma-calls');
      for (const command of ['pnpm', 'prisma'])
        await writeFile(join(bin, command), `#!/bin/sh\necho "$*" >> '${prismaLog}'\nexit 99\n`, { mode: 0o755 });
      const script = join(dir, 'start.sh');
      await writeFile(script, source.replace(/\/app(?=\/|\s|$)/g, app));
      launcher = spawn('/bin/sh', [script], { timeout: 10000, env: { ...process.env, PATH: `${bin}:${process.env.PATH}`,
        MAIN_URL: 'http://localhost', FRONTEND_URL: 'http://localhost', SKIP_PRISMA_DB_PUSH: 'false',
        DATABASE_URL: 'postgresql://test:test@prepared-db:5432/test',
        ALLOW_PUBLIC_DOMAIN_WITH_LOCAL_DB: 'false', RUN_PRISMA_DB_PUSH_IN_PUBLIC_MODE: 'false', ...env,
        START_TEST_LOG: log, START_TEST_FAIL: failure, START_TEST_PRIORITY: 'from-process' }, stdio: 'ignore' });
      const [code, signal] = await once(launcher, 'exit');
      assert.equal(signal, null);
      assert.equal(code, 42);
      await assert.rejects(readFile(prismaLog), { code: 'ENOENT' }, 'no schema command was invoked');
      const events = (await readFile(log, 'utf8')).trim().split('\n').map(JSON.parse);
      for (const role of ['frontend', 'orchestrator']) {
        const start = events.find(e => e.role === role && e.event === 'start');
        assert.ok(start, `${role} started`);
        assert.equal(start.cwd, `${app}/apps/${role}`);
        assert.equal(start.loaded, 'from-file');
        assert.equal(start.priority, 'from-process');
        assert.equal(start.expanded, 'from-file-expanded');
        assert.deepEqual(start.args, role === 'frontend' ? ['start', '-p', '4200'] :
          ['--experimental-require-module', './dist/apps/orchestrator/src/main.js']);
      }
      for (const role of ['nginx', 'backend', failure === 'frontend' ? 'orchestrator' : 'frontend'])
        assert.ok(events.some(e => e.role === role && e.event === 'stop'), `${role} terminated`);
    } finally {
      if (launcher?.exitCode === null) launcher.kill('SIGTERM');
      await rm(dir, { recursive: true, force: true });
    }
  });
}

for (const hostname of ['app.everywhereposter.com', 'publisheverywhere.halowebsites.com']) {
  for (const urlVariable of ['MAIN_URL', 'FRONTEND_URL']) {
    test(`public local DB guard rejects ${hostname} in ${urlVariable} before services start`, async () => {
      const dir = await mkdtemp(join(tmpdir(), 'postiz-guard-test-'));
      try {
        const script = join(dir, 'start.sh');
        await writeFile(script, source.replace(/\/app(?=\/|\s|$)/g, dir));
        await symlink('/bin/cat', join(dir, 'cat'));
        const result = spawnSync('/bin/sh', [script], { timeout: 3000, encoding: 'utf8', env: {
          ...process.env, PATH: dir, MAIN_URL: 'http://localhost', FRONTEND_URL: 'http://localhost',
          [urlVariable]: `https://${hostname}`, DATABASE_URL: localDatabase,
          ALLOW_PUBLIC_DOMAIN_WITH_LOCAL_DB: 'false', RUN_PRISMA_DB_PUSH_IN_PUBLIC_MODE: 'true',
        } });
        // Only cat is needed to print the refusal; no service/schema executable is available.
        assert.equal(result.status, 1);
        assert.match(result.stderr, /Refusing to start EverywherePoster/);
        assert.doesNotMatch(result.stdout, /Waiting for|Starting against/);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });
  }
}

test('PM2 entrypoints start workspace services without schema synchronization', { timeout: 40000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'postiz-pm2-test-'));
  try {
    const { scripts } = JSON.parse(await readFile(new URL('../postiz-app/package.json', import.meta.url)));
    const bin = join(dir, 'bin');
    const log = join(dir, 'pm2-calls');
    await mkdir(bin);
    await writeFile(join(bin, 'pm2'), `#!/bin/sh\necho "$*" >> '${log}'\n`, { mode: 0o755 });
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'startup-fixture', private: true,
      scripts: { pm2: scripts.pm2, 'pm2-run': scripts['pm2-run'], 'prisma-db-push': 'exit 99' } }));
    await writeFile(join(dir, 'pnpm-workspace.yaml'), 'packages:\n  - apps/*\n');
    for (const role of ['backend', 'frontend', 'orchestrator']) {
      const app = join(dir, 'apps', role);
      await mkdir(app, { recursive: true });
      const manifest = JSON.parse(await readFile(new URL(`../postiz-app/apps/${role}/package.json`, import.meta.url)));
      await writeFile(join(app, 'package.json'), JSON.stringify({ name: manifest.name, scripts: { pm2: manifest.scripts.pm2 } }));
    }
    for (const entrypoint of ['pm2', 'pm2-run']) {
      await writeFile(log, '');
      const result = spawnSync('pnpm', ['run', entrypoint], { cwd: dir, timeout: 15000, encoding: 'utf8',
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } });
      assert.equal(result.status, 0, result.stdout + result.stderr);
      const calls = (await readFile(log, 'utf8')).trim().split('\n');
      assert.equal(calls[0], 'delete all');
      assert.equal(calls.at(-1), 'logs');
      assert.deepEqual(calls.slice(1, -1).sort(), ['backend', 'frontend', 'orchestrator'].map(role => `start pnpm --name ${role} -- start`).sort());
    }
    assert.match(scripts['prisma-db-push'], /prisma@6\.5\.0 db push/);
    const deploy = await readFile(new URL('./deploy-production.sh', import.meta.url), 'utf8');
    assert.match(deploy, /--entrypoint \/bin\/sh[\s\S]*pnpm exec prisma migrate deploy --schema/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
