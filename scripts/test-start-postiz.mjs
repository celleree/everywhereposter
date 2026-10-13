#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

// Run with the already installed dotenv CLI; no dependencies are installed by this test.
const dotenv = resolve(process.env.DOTENV_CLI || 'postiz-app/node_modules/.bin/dotenv');
const source = await readFile(new URL('../start-postiz.sh', import.meta.url), 'utf8');

for (const failure of ['frontend', 'orchestrator']) {
  test(`${failure} exit propagates and stops sibling services with dotenv parity`, { timeout: 15000 }, async () => {
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
      await writeFile(join(bin, 'pnpm'), '#!/bin/sh\nexit 99\n', { mode: 0o755 });
      const script = join(dir, 'start.sh');
      await writeFile(script, source.replace(/\/app(?=\/|\s|$)/g, app));
      launcher = spawn('/bin/sh', [script], { env: { ...process.env, PATH: `${bin}:${process.env.PATH}`,
        MAIN_URL: 'http://localhost', FRONTEND_URL: 'http://localhost', SKIP_PRISMA_DB_PUSH: 'true',
        START_TEST_LOG: log, START_TEST_FAIL: failure, START_TEST_PRIORITY: 'from-process' }, stdio: 'ignore' });
      const [code, signal] = await once(launcher, 'exit');
      assert.equal(signal, null);
      assert.equal(code, 42);
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
