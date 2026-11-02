// Optional offline runtime contract; CI executes it whenever Studio inputs change.
import childProcess = require('child_process');
import assert from 'node:assert/strict';
import { copyFile, readFile } from 'fs/promises';
import { join } from 'path';
import { fullSource, withV2Producer } from './studio-director.fixture';

const configured = ['EP_STUDIO_TITLE_PREFLIGHT_RUNTIME', 'EP_STUDIO_TITLE_PREFLIGHT_PACKAGE', 'EP_STUDIO_TITLE_PREFLIGHT_FONT'];
if (configured.some(k => process.env[k]) && !configured.every(k => process.env[k])) throw Error('Supply every explicit Studio title runtime fixture path');
const preflightRuntime = process.env.EP_STUDIO_TITLE_PREFLIGHT_RUNTIME;
(preflightRuntime ? it : it.skip)('real package preflight rejects a no-fit title through the app wrapper before wallet', async () => {
  const run = jest.fn(), launch = childProcess.spawn; let stderr = '';
  const spawn = jest.spyOn(childProcess, 'spawn').mockImplementation(((...args: any[]) => {
    const child = (launch as any)(...args); child.stderr.on('data', (b: Buffer) => { if (stderr.length < 2 * 1024 * 1024) stderr += b.toString(); }); return child;
  }) as any);
  try { await withV2Producer(async (f, service, dir, c) => {
    fullSource(f, 'WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW is not.');
    const settings = JSON.parse(await readFile(preflightRuntime!, 'utf8'));
    c.root = process.env.EP_STUDIO_TITLE_PREFLIGHT_PACKAGE!; c.file = preflightRuntime; c.node = settings.nodeExecutable;
    await copyFile(process.env.EP_STUDIO_TITLE_PREFLIGHT_FONT!, join(dir, 'Body-Bold.ttf'));
    delete (service as any).geometry;
    await assert.rejects(service.produce(c, f.job, f.raw, f.assets, dir), /Studio command failed/);
    await assert.rejects(readFile(join(dir, 'authored-plan.json')), { code: 'ENOENT' });
    await assert.rejects(readFile(join(dir, 'title-candidate/title-preflight.json')), { code: 'ENOENT' });
  }, { run }, true); } finally { spawn.mockRestore(); }
  assert.match(stderr, /(?:title|caption).*cannot fit|cannot fit.*(?:96px|76px)/i);
  expect(run).not.toHaveBeenCalled();
}, 180000);
(preflightRuntime ? it : it.skip)('real package preflight accepts the frozen title and final compiled layout with mocked paid direction', async () => {
  const run = jest.fn(async (...args: any[]) => args[5]({}));
  await withV2Producer(async (f, service, dir, c) => {
    const settings = JSON.parse(await readFile(preflightRuntime!, 'utf8'));
    c.root = process.env.EP_STUDIO_TITLE_PREFLIGHT_PACKAGE!; c.file = preflightRuntime; c.node = settings.nodeExecutable;
    await copyFile(process.env.EP_STUDIO_TITLE_PREFLIGHT_FONT!, join(dir, 'Body-Bold.ttf')); delete (service as any).geometry;
    const plan = await service.produce(c, f.job, f.raw, f.assets, dir);
    assert.equal(plan.manifest.project.title.text, 'Do not change this.');
    assert.equal(JSON.parse(await readFile(join(dir, 'title-candidate/title-preflight.json'), 'utf8')).status, 'PASS');
    expect(run).toHaveBeenCalledTimes(1);
  }, { run }, true);
}, 180000);
