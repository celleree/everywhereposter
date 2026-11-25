"""Exercise the pinned held rollout on disposable services only."""

from concurrent.futures import ThreadPoolExecutor
from hashlib import sha256
import importlib.util
import ipaddress
import json
import os
from pathlib import Path
import subprocess
import sys
import threading
import time
from uuid import uuid4

from ingress import Gate, exchange


ROOT = Path(__file__).resolve().parent
REPO = 'ghcr.io/celleree/publish-everywhere-postiz'
PREVIOUS = 'sha256:b98b88c4e484389a76f719e6226d244e1f11587cc65f081afc0bfbc8d63b086d'
CANDIDATE = 'sha256:e5460a07684b025a35ac28fc11cb1aa027ffd88d2eb98e49144c74700a2228a4'
PG = 'sha256:c7526c0f6c3f30260a563d7bcf8ad778effac59a44f8ffa86678c35418338609'
REDIS = 'sha256:37aa82f9fdff30517603b2e2c5376b34b106d353c2b508262260d3bb0d2c21ba'
TEMPORAL = 'sha256:01537b62d995f27a0f0d33a01ac4caa6779622f454fb2eb36fed0dccd45c6244'
MIGRATION = ('20261122000000_facebook_publication_receipt', '45fb6ad8b7db9ef58e8cd99df1aec198a33c890e8a915d2135734580ba792a23')
DB = 'postgresql://isolated:isolated@pg:5432/isolated'
LABEL = 'ep.held.release.fixture'
AUTH = {'provider': 'LOCAL', 'email': 'held-fixture@example.invalid', 'password': 'synthetic-fixture-only-368'}
JSON = {'Content-Type': 'application/json'}
SEED = '''
const {PrismaClient}=require('@prisma/client');
const db=new PrismaClient({log:[]});
const password=require('bcrypt').hashSync(process.env.FIXTURE_PASSWORD,10);
db.organization.create({data:{name:'Held rehearsal',users:{create:{role:'SUPERADMIN',user:{create:{
  email:process.env.FIXTURE_EMAIL,password,activated:true,providerName:'LOCAL',timezone:0
}}}}}}).catch(e=>{console.error(e.code || e.name);process.exitCode=1;}).finally(()=>db.$disconnect());
'''


def verify(value, message):
    if not value:
        raise RuntimeError(message)


class Fixture:
    def __init__(self, command):
        self.command = command
        self.name = 'ep-held-' + uuid4().hex
        self.network = None

    def docker(self, *args, data=None, timeout=35):
        result = subprocess.run([*self.command, *args], input=data, capture_output=True, text=True, timeout=timeout)
        if result.returncode:
            raise RuntimeError(f'Docker {args[0]} failed: {result.stderr[-800:]} {result.stdout[-300:]}')
        return result.stdout.strip()

    def inspect(self, resource):
        return json.loads(self.docker('inspect', resource))[0]

    def run(self, role, image, options, command, data=None, wait=False):
        flags = ['--label', f'{LABEL}={self.name}', '--name', f'{self.name}-{role}', '--network', self.name,
                 '--network-alias', role, '--pull=never', '--restart=no', '--security-opt=no-new-privileges',
                 '--cap-drop=ALL', '--read-only', '--memory=1536m', '--cpus=2', '--pids-limit=256', '--init']
        return self.docker('run', *(['--rm', '-i'] if wait else ['-d']), *flags, *options, image, *command, data=data, timeout=110)

    def cleanup(self):
        for identifier in self.docker('ps', '-aq', '--filter', f'label={LABEL}={self.name}').splitlines():
            verify(self.inspect(identifier)['Config']['Labels'][LABEL] == self.name, 'Cleanup owner mismatch')
            self.docker('rm', '-fv', identifier)
        if self.network:
            net = json.loads(self.docker('network', 'inspect', self.network))[0]
            verify(net['Labels'][LABEL] == self.name and not net['Containers'], 'Network cleanup owner mismatch')
            self.docker('network', 'rm', self.network)


def retry(operation):
    end = time.monotonic() + 70
    while time.monotonic() < end:
        try:
            return operation()
        except (RuntimeError, OSError) as error:
            failure = error
            time.sleep(1)
    raise RuntimeError(f'Owned fixture did not become ready: {failure}')


def migration_inputs():
    source = ROOT.parent / 'verify-release-image.py'
    verify(sha256(source.read_bytes()).hexdigest() == 'd4994a994335dee1b2c995da48da0ef1bd929fc1e06e418653ef2573511a5f59',
           'Packaged Prisma driver differs from the reviewed image verifier')
    spec = importlib.util.spec_from_file_location('image_preflight', source)
    helper = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helper)
    return helper.NODE_MIGRATE


def scalar(services, sql):
    fixture, pg, _ = services
    return fixture.docker('exec', pg, 'psql', '-XqAt', '-v', 'ON_ERROR_STOP=1', '-U', 'isolated', '-d', 'isolated', '-c', sql)


def ledger(services):
    rows = scalar(services, 'SELECT migration_name,checksum,finished_at IS NOT NULL AND rolled_back_at IS NULL FROM "_prisma_migrations"')
    values = [line.split('|') for line in rows.splitlines()]
    verify(len({row[0] for row in values}) == len(values) and all(row[2] == 't' for row in values), 'Unsettled migration rows')
    return {row[0]: row[1] for row in values}


def workflows(services):
    fixture, _, temporal = services
    result = json.loads(fixture.docker('exec', temporal, 'temporal', '--address', '127.0.0.1:7233', '-o', 'json', 'workflow', 'count'))
    verify(result == {} or ('count' in result and int(result['count']) == 0), 'A fixture workflow was enqueued')


def prepare(fixture, both):
    fixture.network = fixture.docker('network', 'create', '--internal', '--label', f'{LABEL}={fixture.name}', fixture.name)
    pg = fixture.run('pg', PG, ['--user=70:70', '--tmpfs', '/var/lib/postgresql/data:rw,nosuid,noexec,size=256m,uid=70,gid=70,mode=0700',
        '--tmpfs', '/var/run/postgresql:rw,nosuid,noexec,size=8m,uid=70,gid=70,mode=0700', '-e', 'POSTGRES_USER=isolated',
        '-e', 'POSTGRES_DB=isolated', '-e', 'POSTGRES_PASSWORD=isolated'], [])
    retry(lambda: fixture.docker('exec', pg, 'pg_isready', '-h', '127.0.0.1', '-U', 'isolated'))
    redis = fixture.run('redis', REDIS, ['--user=999:999', '--entrypoint', 'redis-server',
        '--tmpfs', '/data:rw,nosuid,noexec,size=64m,uid=999,gid=999'], ['--save', '', '--appendonly', 'no'])
    retry(lambda: fixture.docker('exec', redis, 'redis-cli', 'ping'))
    temporal = fixture.run('temporal', TEMPORAL, ['--entrypoint', 'temporal', '--tmpfs', '/tmp:rw,nosuid,size=128m'],
        ['server', 'start-dev', '--ip', '0.0.0.0', '--headless', '--search-attribute', 'organizationId=Keyword', '--search-attribute', 'postId=Keyword'])
    retry(lambda: fixture.docker('exec', temporal, 'temporal', '--address', '127.0.0.1:7233', 'operator', 'cluster', 'health'))
    setup = ['--workdir', '/app', '--entrypoint', 'node', '--tmpfs', '/tmp:rw,nosuid,noexec,size=64m', '-e', f'DATABASE_URL={DB}']
    services = (fixture, pg, temporal)
    before = None
    if both:
        fixture.run('baseline', PREVIOUS, setup, ['-'], data=migration_inputs(), wait=True)
        before = ledger(services)
        verify(len(before) == 21, 'Unexpected prior ledger')
    fixture.run('upgrade', CANDIDATE, setup, ['-'], data=migration_inputs(), wait=True)
    after = ledger(services)
    verify(len(after) == 22 and tuple(MIGRATION) in after.items() and (before is None or after == (before | dict([MIGRATION]))),
           'Expected only the pinned receipt migration')
    fixture.run('seed', PREVIOUS if both else CANDIDATE, [*setup, '-e', f'FIXTURE_EMAIL={AUTH["email"]}',
        '-e', f'FIXTURE_PASSWORD={AUTH["password"]}'], ['-'], data=SEED, wait=True)
    workflows(services)
    return services, after


def check(port, method, path, expected, body=None, headers=None):
    status, reply, data = exchange('127.0.0.1', port, method, path, body, headers)
    verify(status == expected, f'{method} {path} returned {status}; expected {expected}')
    return dict((key.lower(), value) for key, value in reply), data


def drain(gate):
    entered, released = threading.Event(), threading.Event()

    def deferred(*args):
        entered.set()
        verify(released.wait(8), 'Synthetic in-flight request timed out')
        return exchange(*args)

    gate.forward = deferred
    try:
        with ThreadPoolExecutor(2) as worker:
            request = worker.submit(check, gate.server_port, 'GET', '/auth/login', 200)
            try:
                verify(entered.wait(5), 'Synthetic request did not enter the gate')
                draining = worker.submit(gate.drain)
                with gate.condition:
                    verify(gate.condition.wait_for(lambda: gate.target is None, 5), 'Gate did not close')
                verify(not draining.done(), 'Drain completed before in-flight request settled')
                check(gate.server_port, 'GET', '/auth/login', 503)
            finally:
                released.set()
            request.result(timeout=10)
            draining.result(timeout=10)
    finally:
        gate.forward = exchange


def exercise(services, gate, role, image):
    fixture, _, _ = services
    origin = f'http://127.0.0.1:{gate.server_port}'
    env = {'DATABASE_URL': DB, 'REDIS_URL': 'redis://redis:6379', 'TEMPORAL_ADDRESS': 'temporal:7233',
        'MAIN_URL': origin, 'FRONTEND_URL': origin, 'NEXT_PUBLIC_BACKEND_URL': origin + '/api',
        'BACKEND_INTERNAL_URL': 'http://127.0.0.1:3000', 'JWT_SECRET': 'synthetic-held-fixture-only', 'NOT_SECURED': 'true',
        'DISABLE_POSTIZ_MCP': 'true', 'DISABLE_REGISTRATION': 'true', 'NEXT_TELEMETRY_DISABLED': '1',
        'STORAGE_PROVIDER': 'local', 'UPLOAD_DIRECTORY': '/uploads', 'OPENAI_API_KEY': 'synthetic-only', 'IS_GENERAL': 'true'}
    flags = [part for key, value in env.items() for part in ('-e', f'{key}={value}')]
    app = fixture.run(role, image, [*flags, '--mount', f'type=bind,src={ROOT / "launch.sh"},dst=/launch-held.sh,readonly',
        '--tmpfs', '/tmp:rw,nosuid,size=96m', '--entrypoint', '/bin/sh'], ['/launch-held.sh'])
    row = fixture.inspect(app)
    networks = row['NetworkSettings']['Networks']
    net = json.loads(fixture.docker('network', 'inspect', fixture.network))[0]
    verify(row['Image'] == image and list(networks) == [fixture.name] and net['Internal'] and not net['EnableIPv6']
           and not row['HostConfig']['PortBindings'], 'App fixture image or routing mismatch')
    address = networks[fixture.name]['IPAddress']
    verify(ipaddress.ip_address(address).is_private, 'Application has an unexpected address')
    gate.admit(address)
    retry(lambda: check(gate.server_port, 'GET', '/api/auth/can-register', 200))
    _, page = retry(lambda: check(gate.server_port, 'GET', '/auth/login', 200))
    verify(b'password' in page.lower() and b'sign in' in page.lower(), 'Packaged login controls absent')
    headers, _ = check(gate.server_port, 'POST', '/api/auth/login', 200, json.dumps(AUTH), JSON)
    _, body = check(gate.server_port, 'GET', '/api/user/self', 200, headers={'auth': headers['auth']})
    verify(json.loads(body)['email'] == AUTH['email'], 'Unexpected synthetic account')
    for method, path in [('POST', '/api/posts'), ('POST', '/api/auth/register'), ('POST', '/api/posts/id/facebook-published'),
                         ('DELETE', '/api/posts/id'), ('POST', '/public/v1/posts'), ('GET', '/api/integrations/facebook'),
                         ('GET', '/_next/static/../api/posts'), ('GET', '/api/%70osts'), ('GET', '/api/user/impersonate')]:
        check(gate.server_port, method, path, 405, '{}' if method == 'POST' else None, JSON)
    check(gate.server_port, 'POST', '/api/auth/login', 405, '{"provider":"GITHUB","providerToken":"fixture"}', JSON)
    check(gate.server_port, 'GET', '/api/user/self', 405, headers={'X-HTTP-Method-Override': 'POST'})
    processes = fixture.docker('top', app, '-eo', 'pid,args')
    verify('/apps/orchestrator/' not in processes and '/apps/backend/' in processes and 'next' in processes, 'Unexpected application processes')
    workflows(services)
    build = fixture.docker('exec', app, 'cat', '/app/apps/frontend/.next/BUILD_ID')
    drain(gate)
    fixture.docker('stop', '--time', '15', app, timeout=22)
    state = fixture.inspect(app)['State']
    verify(state['Status'] == 'exited' and state['ExitCode'] == 0 and not state['OOMKilled'], 'Held launcher did not stop cleanly')
    return {'role': role, 'image': image, 'buildId': build, 'signedInSelf': True, 'blockedMutations': True,
            'ingressDrained': True, 'launcherExit': state['ExitCode']}


def main():
    local = os.environ.get('WSL_DISTRO_NAME') == 'Ubuntu' and os.getuid() == 1000
    hosted = os.environ.get('GITHUB_ACTIONS') == 'true' and os.environ.get('RUNNER_ENVIRONMENT') == 'github-hosted'
    verify(local or hosted, 'Only the development engine and hosted disposable runner are admitted')
    verify(sys.argv[1:] in ([], ['--candidate-only']) and (sys.argv[1:] == [] or local), 'Unexpected invocation mode')
    both = not sys.argv[1:]
    fixture = Fixture(['docker', '--host', 'unix:///var/run/docker.sock'])
    if local:
        verify(fixture.docker('info', '--format', '{{.ID}}') == 'ae69896a-24a0-4492-8e0a-375db3ec719e', 'Not the development engine')
    if hosted:
        auth = Path(os.environ['DOCKER_CONFIG'])
        verify(auth.parent == Path(os.environ['RUNNER_TEMP']) and not auth.exists(), 'Registry login must be gone')
    for image in ([PREVIOUS, CANDIDATE] if both else [CANDIDATE]):
        meta = fixture.inspect(image)
        verify(meta['Id'] == image and REPO + '@' + image in meta['RepoDigests'] and meta['Os'] == 'linux' and meta['Architecture'] == 'amd64',
               'Exact published image identity could not be verified')
    phases = []
    try:
        services, initial = prepare(fixture, both)
        with Gate() as gate:
            relay = threading.Thread(target=gate.serve_forever, daemon=True)
            relay.start()
            try:
                check(gate.server_port, 'GET', '/auth/login', 503)
                if both:
                    phases.append(exercise(services, gate, 'prior-held', PREVIOUS))
                phases.append(exercise(services, gate, 'candidate-held', CANDIDATE))
                if both:
                    phases.append(exercise(services, gate, 'rollback-held', PREVIOUS))
                    verify(phases[0]['buildId'] == phases[-1]['buildId'], 'Prior build changed during rollback')
            finally:
                gate.shutdown()
                relay.join(timeout=5)
        workflows(services)
        verify(ledger(services) == initial, 'Migration ledger changed during held application starts')
        verify(scalar(services, 'SELECT (SELECT count(*) FROM "Post"),(SELECT count(*) FROM "FacebookPublicationReceipt")') == '0|0',
               'A post or receipt was created')
    finally:
        fixture.cleanup()
    print(json.dumps({'syntheticOnly': True, 'phases': phases, 'workflowCount': 0, 'postsAndReceipts': [0, 0],
        'rollbackPreservedUpgradedSchema': both, 'fixtureCleanup': True,
        'fingerprints': {name: sha256((ROOT / name).read_bytes()).hexdigest() for name in ('launch.sh', 'ingress.py', 'verify.py')}}, indent=2))


if __name__ == '__main__':
    main()
