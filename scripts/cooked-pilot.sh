#!/usr/bin/env bash
# Operator data is environment data, never shell source.
set -euo pipefail
exec python3 - "$@" <<'PY'
import fcntl, hashlib, json, os, pathlib, re, stat, subprocess, sys, time
phase = 'validation'
lock_fd = None
def require(ok):
    if not ok: raise ValueError('prerequisite failed')
def command(*args, env=None):
    return subprocess.check_output(args, text=True, stderr=subprocess.DEVNULL, timeout=210, env=env).strip()
def pairs(items):
    result = {}
    for key, value in items:
        require(key not in result); result[key] = value
    return result
def keys(value, expected):
    require(type(value) is dict and set(value) == set(expected.split()))
# Docker projects only these fields; no full inspect, raw environment or logs.
def field(kind, identity, template):
    return command('docker', kind, 'inspect', '--format', template, identity)
def value(kind, identity, name):
    return json.loads(field(kind, identity, '{{json .' + name + '}}'))
def app_settings():
    return field('container', 'postiz', '{{range .Config.Env}}{{$k := index (split . "=") 0}}{{if or (eq $k "COOKED_EDITOR_ENABLED") (eq $k "COOKED_EDITOR_SOCKET") (eq $k "COOKED_EDITOR_ORGANIZATIONS")}}{{println .}}{{end}}{{end}}').splitlines()
def snapshot(identity):
    return {name: value('container', identity, name) for name in ('Image', 'State.Running', 'State.Health.Status', 'RestartCount', 'Mounts')}
def owned(identity, service):
    for label, expected in [('project', 'publish-everywhere'), ('service', service)]:
        require(field('container', identity, '{{index .Config.Labels "com.docker.compose.' + label + '"}}') == expected)
def healthy(identity):
    s = snapshot(identity)
    require(s['State.Running'] and s['State.Health.Status'] == 'healthy' and s['RestartCount'] == 0)
    return s
def wait(identity, worker=False):
    deadline = time.monotonic() + 180
    while True:
        if worker: worker_check(identity)
        s = snapshot(identity)
        require(s['State.Running'] and s['RestartCount'] == 0 and s['State.Health.Status'] in ('starting', 'healthy'))
        if s['State.Health.Status'] == 'healthy': return s
        require(time.monotonic() < deadline); time.sleep(2)
def mount(s, target, writable):
    return any(m['Type'] == 'bind' and m['Source'] == r['ipcDirectory'] and m['Destination'] == target and m['RW'] == writable for m in s['Mounts'])
def worker_check(identity):
    owned(identity, 'cooked-editor')
    expected = {'Image': worker_id, 'Config.User': '10001:0', 'HostConfig.NetworkMode': 'none', 'HostConfig.ReadonlyRootfs': True, 'HostConfig.Memory': 536870912, 'HostConfig.MemorySwap': 536870912, 'HostConfig.NanoCpus': 1000000000, 'HostConfig.PidsLimit': 128, 'HostConfig.Ulimits': [{'Name': 'fsize', 'Hard': 536870912, 'Soft': 536870912}], 'HostConfig.CapDrop': ['ALL'], 'HostConfig.Privileged': False, 'HostConfig.Init': True, 'HostConfig.Tmpfs': {'/work': 'rw,noexec,nosuid,nodev,size=512m,uid=10001,gid=0,mode=0700', '/tmp': 'rw,noexec,nosuid,nodev,size=128m'}, 'HostConfig.LogConfig': {'Type': 'json-file', 'Config': {'max-size': '1m', 'max-file': '2'}}}
    for name, wanted in expected.items(): require(value('container', identity, name) == wanted)
    require(value('container', identity, 'HostConfig.SecurityOpt') == ['no-new-privileges:true'])
    require(not value('container', identity, 'HostConfig.CapAdd'))
    require(all(m['Destination'] in ('/ipc', '/work', '/tmp') and (m['Type'] == 'tmpfs' or m['Destination'] == '/ipc') for m in snapshot(identity)['Mounts']))
    require(mount(snapshot(identity), '/ipc', True))
def receipt(result):
    print(json.dumps(dict(schema=1, operation=operation, result=result, phase=phase, acceptanceSHA256=digest, appSHA=r['appSHA'], appImage=r['appImage'], workerImage=r['workerImage'], profile='one-session', productAcceptance='NOT_RUN'), sort_keys=True))
try:
    operation = sys.argv[1] if len(sys.argv) == 2 else ''
    require(operation in ('validate', 'activate', 'disable'))
    raw = os.environ.get('COOKED_ACCEPTANCE_JSON', '').encode()
    require(0 < len(raw) <= 16384)
    digest = hashlib.sha256(raw).hexdigest()
    require(re.fullmatch('[0-9a-f]{64}', os.environ.get('COOKED_ACCEPTANCE_SHA256', '')) and digest == os.environ['COOKED_ACCEPTANCE_SHA256'])
    r = json.loads(raw, object_pairs_hook=pairs)
    keys(r, 'schema appSHA appImage workerImage organizationId ipcDirectory profile sourceNoticeEvidence nonproductionEvidence resourceEvidence fixture')
    require(type(r['schema']) is int and r['schema'] == 1 and r['profile'] == 'one-session')
    require(re.fullmatch('[0-9a-f]{40}', r['appSHA']))
    require(re.fullmatch(r'ghcr\.io/celleree/publish-everywhere-postiz@sha256:[0-9a-f]{64}', r['appImage']))
    require(re.fullmatch(r'ghcr\.io/celleree/publish-everywhere-cooked-worker@sha256:[0-9a-f]{64}', r['workerImage']))
    require(re.fullmatch('[A-Za-z0-9_-]{1,128}', r['organizationId']))
    require(re.fullmatch('/[A-Za-z0-9_/-]+', r['ipcDirectory']) and all(p not in ('', '.', '..') for p in r['ipcDirectory'].split('/')[1:]))
    for f in ('sourceNoticeEvidence', 'nonproductionEvidence', 'resourceEvidence'): require(re.fullmatch('[0-9a-f]{64}', r[f]))
    keys(r['fixture'], 'sha256 owned durationSeconds width height'); f = r['fixture']
    require(re.fullmatch('[0-9a-f]{64}', f['sha256']) and f['owned'] is True and type(f['durationSeconds']) in (int, float) and 0 < f['durationSeconds'] <= 15 and type(f['width']) is int and f['width'] == 640 and type(f['height']) is int and f['height'] == 360)
    if operation == 'validate': receipt('RECORD_VALID_ONLY'); sys.exit(0)
    # Existing checkout inode is the lock: no lockfile or directory is created.
    lock_fd = os.open('.', os.O_RDONLY | os.O_DIRECTORY)
    fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    require(os.environ.get('COOKED_APPROVED_SOURCE_SHA') == command('git', 'rev-parse', 'HEAD'))
    require(command('git', 'branch', '--show-current') == 'main' and not command('git', 'status', '--porcelain'))
    require(command('git', 'rev-parse', 'HEAD') == command('git', 'rev-parse', 'origin/main'))
    command('git', 'merge-base', '--is-ancestor', r['appSHA'], 'HEAD')
    phase = 'admission'
    path = pathlib.Path(r['ipcDirectory'])
    for part in (path, *path.parents): require(not part.is_symlink())
    info = path.stat()
    require(stat.S_ISDIR(info.st_mode) and stat.S_IMODE(info.st_mode) == 0o710 and info.st_uid == 10001 and info.st_gid == 0)
    if operation == 'activate':
        require((os.cpu_count() or 0) >= 2)
        available = re.search(r'^MemAvailable:\s+(\d+) kB$', pathlib.Path('/proc/meminfo').read_text(), re.M)
        require(available and int(available[1]) >= 1048576)
    app_id = value('image', r['appImage'], 'Id'); worker_id = value('image', r['workerImage'], 'Id')
    for image in (r['appImage'], r['workerImage']):
        require(image in value('image', image, 'RepoDigests') and value('image', image, 'Os') == 'linux' and value('image', image, 'Architecture') == 'amd64')
    require(value('image', 'ghcr.io/celleree/publish-everywhere-postiz:' + r['appSHA'], 'Id') == app_id)
    require(value('image', r['workerImage'], 'Config.User') == '10001:0')
    require(value('image', 'publish-everywhere/postiz-app:custom', 'Id') == app_id)
    owned('postiz', 'postiz'); app = healthy('postiz'); require(app['Image'] == app_id)
    uid = command('docker', 'exec', 'postiz', 'id', '-u'); gids = command('docker', 'exec', 'postiz', 'id', '-G').split()
    require(uid in ('0', '10001') or '0' in gids)
    expected = sorted(['COOKED_EDITOR_ENABLED=true', 'COOKED_EDITOR_SOCKET=/run/cooked/cooked.sock', 'COOKED_EDITOR_ORGANIZATIONS=' + r['organizationId']])
    def off(settings):
        return all(line in ('COOKED_EDITOR_ENABLED=false', 'COOKED_EDITOR_ENABLED=', 'COOKED_EDITOR_SOCKET=', 'COOKED_EDITOR_ORGANIZATIONS=') for line in settings)
    current = app_settings(); enabled = sorted(current) == expected
    require(enabled or off(current))
    workers = command('docker', 'ps', '-aq', '--filter', 'label=com.docker.compose.project=publish-everywhere', '--filter', 'label=com.docker.compose.service=cooked-editor').split()
    require(len(workers) <= 1)
    worker = workers[0] if workers else None
    if worker: worker_check(worker)
    if enabled: require(worker and mount(app, '/run/cooked', False))
    else: require(not any(m['Destination'] == '/run/cooked' for m in app['Mounts']))
    env = os.environ.copy()
    for name in tuple(env):
        if name.startswith('COMPOSE_') or name.startswith('COOKED_EDITOR_'): del env[name]
    env.update(COOKED_PILOT_ORGANIZATIONS=r['organizationId'], COOKED_IPC_DIR=r['ipcDirectory'], COOKED_WORKER_IMAGE=r['workerImage'])
    base = ['docker', 'compose', '-f', 'docker-compose.yaml']
    pilot = base + ['-f', 'docker-compose.cooked-candidate.yaml', '-f', 'docker-compose.cooked-one-session.yaml', '--profile', 'cooked']
    def compose(args, tail): subprocess.run(args + tail, env=env, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=210)
    if operation == 'activate' and enabled: healthy(worker); receipt('ALREADY_ENABLED'); sys.exit(0)
    if operation == 'disable' and off(current) and not (worker and snapshot(worker)['State.Running']): receipt('ALREADY_DISABLED'); sys.exit(0)
    # Restart only a verified stopped namespace; never replace an active session.
    if operation == 'activate': require(not worker or not snapshot(worker)['State.Running'])
    phase = 'mutation_started'
    if operation == 'activate':
        compose(pilot, ['up', '-d', '--no-build', '--pull', 'never', '--no-deps', '--no-recreate', 'cooked-editor'])
        worker = command(*pilot, 'ps', '-q', 'cooked-editor', env=env); require(worker); wait(worker, True)
    compose(pilot if operation == 'activate' else base, ['up', '-d', '--no-build', '--pull', 'never', '--no-deps', '--force-recreate', 'postiz'])
    phase = 'app_recreated'; app = wait('postiz'); owned('postiz', 'postiz'); require(app['Image'] == app_id)
    require(sorted(app_settings()) == expected and mount(app, '/run/cooked', False) if operation == 'activate' else off(app_settings()) and not any(m['Destination'] == '/run/cooked' for m in app['Mounts']))
    command('docker', 'exec', 'publish-everywhere-web', 'nginx', '-t')
    command('docker', 'exec', 'publish-everywhere-web', 'nginx', '-s', 'reload')
    if operation == 'disable' and worker:
        phase = 'app_disabled_worker_stop_pending'; compose(pilot, ['stop', 'cooked-editor']); require(not snapshot(worker)['State.Running'])
    phase = 'complete'; receipt('ENABLED_ACCEPTANCE_PENDING' if operation == 'activate' else 'DISABLED')
except Exception:
    # External errors may contain configuration; emit only this allowlisted receipt.
    print(json.dumps(dict(result='FAILED_PARTIAL_STATE_POSSIBLE' if phase not in ('validation', 'admission') else 'REFUSED', phase=phase, productAcceptance='NOT_RUN')), file=sys.stderr)
    sys.exit(1)
finally:
    if lock_fd is not None: os.close(lock_fd)
PY
