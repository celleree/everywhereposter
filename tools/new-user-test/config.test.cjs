const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const config = JSON.parse(execFileSync('docker', ['compose', '--env-file', '/dev/null', '--project-directory', root, '-f', __dirname + '/compose.yaml', '--profile', 'tools', 'config', '--format', 'json'], {
  env: { PATH: process.env.PATH, HOME: process.env.HOME, QA_ROOT: root, QA_UID: '1000', QA_GID: '1000' }, encoding: 'utf8',
}));
const services = config.services;
test('all application and data services stay on an internal-only network', () => {
  assert.equal(config.name, 'ep-new-user-20261107');
  assert.equal(config.networks.isolated.internal, true);
  assert.deepEqual(Object.keys(services).sort(), ['qa-backend', 'qa-build', 'qa-frontend', 'qa-ingress', 'qa-migrate', 'qa-postgres', 'qa-redis', 'qa-temporal', 'qa-temporal-db']);
  for (const [name, service] of Object.entries(services)) {
    if (name === 'qa-ingress') continue;
    assert.deepEqual(Object.keys(service.networks), ['isolated']);
    assert.equal(service.ports, undefined);
    assert.equal(service.network_mode, undefined);
  }
});
test('only fixed-upstream ingress publishes two loopback ports', () => {
  assert.deepEqual(services['qa-ingress'].ports.map(p => [p.host_ip, p.published, p.target]), [['127.0.0.1', '4317', 8080], ['127.0.0.1', '4318', 8081]]);
  assert.deepEqual(Object.keys(services['qa-ingress'].networks).sort(), ['ingress', 'isolated']);
  const proxy = require('node:fs').readFileSync(__dirname + '/proxy.conf', 'utf8');
  assert.deepEqual([...proxy.matchAll(/proxy_pass ([^;]+);/g)].map(m => m[1]), ['http://qa-frontend:4317', 'http://qa-backend:3000']);
  assert.doesNotMatch(proxy, /resolver |proxy_pass.*\$|access_log (?!off)/);
});
test('existing images are pinned and every service has bounded resources', () => {
  for (const service of Object.values(services)) {
    assert.match(service.image, /@sha256:[0-9a-f]{64}$/);
    assert.equal(service.pull_policy, 'never');
    assert.ok(service.cpus > 0 && service.cpus <= 2);
    assert.ok(service.mem_limit > 0 && service.mem_limit <= 3 * 1024 ** 3);
    assert.ok(service.pids_limit > 0 && service.pids_limit <= 256);
    assert.equal(service.privileged, undefined);
  }
});
test('real current source runs with explicit nonproduction configuration', () => {
  for (const name of ['qa-migrate', 'qa-build', 'qa-backend', 'qa-frontend']) {
    const service = services[name], env = service.environment;
    assert.deepEqual(service.entrypoint, ['/usr/bin/env']);
    assert.equal(service.read_only, true);
    assert.deepEqual(service.cap_drop, ['ALL']);
    assert.equal(service.volumes[0].source, root);
    assert.equal(service.volumes[0].target, '/workspace');
    assert.equal(env.DATABASE_URL, 'postgresql://isolated:isolated@qa-postgres:5432/ep_new_user');
    assert.equal(env.REDIS_URL, 'redis://qa-redis:6379');
    assert.equal(env.TEMPORAL_ADDRESS, 'qa-temporal:7233');
    assert.equal(env.BILLING_ENABLED, 'false');
    assert.equal(env.AI_WALLET_ENABLED, 'false');
    for (const key of Object.keys(env)) assert.doesNotMatch(key, /OPENAI_API_KEY|RESEND|SMTP|FACEBOOK|INSTAGRAM|THREADS|TIKTOK|STRIPE|SENTRY|RUN_CRON/);
    assert.equal(service.env_file, undefined);
  }
  assert.deepEqual(services['qa-build'].command.slice(-2), ['/workspace/postiz-app/node_modules/@nestjs/cli/bin/nest.js', 'build']);
  assert.doesNotMatch(services['qa-backend'].command.join(' '), /ts-node|dotenv|start-postiz/);
});
