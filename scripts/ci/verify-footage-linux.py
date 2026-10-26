#!/usr/bin/env python3
"""Disposable Linux acceptance for generated footage; never a production launcher.

Only the gateway's test network/DNS and image trust store are instrumented. The
product downloader, destination guards, byte transfer and validator run unchanged.
"""
import argparse
import copy
import hashlib
import importlib
import json
import os
from pathlib import Path
import re
import runpy
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import types
import unittest
import uuid

# Official library/registry:3.0.0 index, verified against Docker Hub metadata.
REGISTRY = 'registry:3.0.0@sha256:6c5666b861f3505b116bb9aa9b25175e71210414bd010d92035ff64018f9457e'
REQUIRED_UNIT_TESTS = 19  # Seventeen contract/synthetic tests plus two real Linux tests.
REQUIRED_REAL_TESTS = {
    'tests.test_runtime_integration.Tests.test_direct_child_network_has_no_route',
    'tests.test_runtime_integration.Tests.test_copy_from_real_container_tmpfs',
}
REQUIRED_CASES = {
    'official-tool-hash-and-real-unit-smoke','real-https-acquisition-normalization-and-cache',
    'untrusted-tls-certificate-rejected','redirect-unknown','redirect-private',
    'encrypted-traffic-budget','connection-count-budget','acquisition-deadline',
    'normalization-deadline-real-delayed-child','owned-tmpfs-exhaustion',
    'real-destination-mixed-rebinding-and-forwarding-denials','actual-worker-and-child-cannot-bypass-proxy',
    'fresh-positive-control-after-denials',
    'product-cancellation-SIGINT','product-cancellation-SIGTERM',
}
PUBLIC_IP = '11.250.0.10'
NETWORK = '11.250.0.0/24'


def sha(path):
    with open(path, 'rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def write(path, value):
    Path(path).write_text(json.dumps(value, indent=2) + '\n', encoding='utf-8')


def command(args, *, timeout=60, check=True, data=None, cwd=None):
    result = subprocess.run([str(x) for x in args], input=data, cwd=cwd,
                            capture_output=True, timeout=timeout)
    if check and result.returncode:
        # Test-only paths/hosts; no inherited command environment or credentials.
        raise RuntimeError(f'{Path(str(args[0])).name} failed ({result.returncode}): '
                           + result.stderr.decode(errors='replace')[-2000:])
    return result


def docker(*args, **kwargs):
    return command(['docker', *args], **kwargs)


def inspect(kind, name):
    result = docker(kind, 'inspect', name, check=False, timeout=10)
    if result.returncode:
        # A daemon/access failure is not evidence that a resource disappeared.
        absent = {
            'container': [f'Error: No such container: {name}',f'Error: No such object: {name}',
                          f'Error response from daemon: No such container: {name}'],
            'volume': [f'Error response from daemon: get {name}: no such volume',f'Error: No such volume: {name}'],
            'network': [f'Error response from daemon: network {name} not found',f'Error: No such network: {name}'],
        }
        message=result.stderr.decode(errors='replace').strip()
        if message.lower() in [x.lower() for x in absent.get(kind,[])]:return None
        raise RuntimeError('Resource inspection is uncertain: '+message[:1000])
    return json.loads(result.stdout)[0]


class Evidence:
    def __init__(self, out):
        self.out = Path(out).resolve()
        self.state_path = self.out / 'state.json'
        self.state = json.loads(self.state_path.read_text())
        assert re.fullmatch(r'ci-footage-[a-f0-9]{32}',self.state['owner'])

    def valid_resource(self,kind,name):
        owner=self.state['owner']
        if kind=='container':
            return name in [owner+'-'+role for role in ('registry','fixture','smoke','tool-hash','generator','asset-probe','asset-decode')] or bool(re.fullmatch(r'footage-[a-f0-9]{32}-(proxy|download|offline|transport)',name))
        if kind=='volume':return bool(re.fullmatch(r'footage-[a-f0-9]{32}',name))
        return kind=='network' and name==owner+'-network'

    def record(self, kind, name):
        if not self.valid_resource(kind,name):
            raise AssertionError('Invalid owned resource name')
        if inspect(kind, name) is not None:
            raise AssertionError('Resource already exists; ownership uncertain')
        with open(self.out / 'owned.jsonl', 'a', encoding='utf-8') as stream:
            stream.write(json.dumps({'kind': kind, 'name': name}) + '\n')

    def resources(self):
        path = self.out / 'owned.jsonl'
        entries=[json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []
        assert all(self.valid_resource(x['kind'],x['name']) for x in entries),'Invalid ownership journal'
        assert len({(x['kind'],x['name']) for x in entries})==len(entries),'Duplicate ownership entry'
        return entries

    def remaining(self):
        return [entry for entry in self.resources() if inspect(entry['kind'], entry['name']) is not None]

    def cleanup(self):
        failures = []
        for entry in reversed(self.resources()):
            kind, name = entry['kind'], entry['name']
            if kind not in ('container', 'volume', 'network'):
                raise AssertionError('Unknown resource kind')
            current = inspect(kind, name)
            if current is None:
                continue
            labels = current.get('Labels') if kind != 'container' else current['Config'].get('Labels')
            if (labels or {}).get('ci.footage.owner') != self.state['owner']:
                raise AssertionError('Refusing cleanup: resource ownership mismatch')
            args = [kind, 'rm', '-f', name] if kind == 'container' else [kind, 'rm', name]
            result = docker(*args, check=False, timeout=20)
            if result.returncode:
                failures.append(entry)
        if self.remaining():
            failures.extend(self.remaining())
        if failures:
            raise AssertionError('Owned resources remain after cleanup: ' + json.dumps(failures))


def modules(repo):
    package = Path(repo) / 'tools/video-studio/14_footage_acquisition/v1'
    sys.path.insert(0, str(package))
    return package, importlib.import_module('acquire'), importlib.import_module('runtime.launch')


def checked_runtime(repo, evidence):
    package, acquisition, launch = modules(repo)

    class CheckedRuntime(launch.Runtime):
        def __init__(self, config):
            super().__init__(config)
            assert re.fullmatch(r'footage-[a-f0-9]{32}', self.volume)

        def call(self, args, **kwargs):
            args = list(args)
            if args[:2] == ['volume', 'create']:
                assert args[2:] == [self.volume]
                evidence.record('volume', self.volume)
                args = ['volume', 'create', '--label', 'ci.footage.owner=' + evidence.state['owner'], self.volume]
            if args[:2] == ['run', '-d']:
                name = args[args.index('--name') + 1]
                assert name in [self.volume + '-' + role for role in ('proxy', 'download', 'offline', 'transport')]
                evidence.record('container', name)
                args[2:2] = ['--label', 'ci.footage.owner=' + evidence.state['owner']]
                if name.endswith('-proxy'):
                    index = args.index('--network') + 1
                    assert args[index] == 'bridge'
                    args[index] = evidence.state['network']
                    args[2:2] = ['--dns', PUBLIC_IP]
            if args[:2] == ['rm', '-f']:
                assert len(args) == 3 and args[2] in self.names
                if args[2].endswith('-offline'):
                    marker=docker('exec',args[2],'python','-c',"from pathlib import Path; print(Path('/job/ffmpeg-started').exists())",check=False,timeout=10)
                    if marker.returncode==0 and marker.stdout.strip()==b'True':
                        with open(evidence.out/'normalization-child-started.jsonl','a') as stream:
                            stream.write(json.dumps({'container':args[2],'realDelayedChildStarted':True})+'\n')
            if args[:2] == ['volume', 'rm']:
                assert args[2:] == [self.volume]
            result = super().call(args, **kwargs)
            if args[:2] == ['run', '-d']:
                meta = inspect('container', args[args.index('--name') + 1])
                host = meta['HostConfig']
                assert meta['Config']['User'] == '10001:10001' and host['ReadonlyRootfs']
                assert host['CapDrop'] == ['ALL'] and 'no-new-privileges:true' in host['SecurityOpt']
                assert host['Memory'] == 768 * 1024 ** 2 and host['PidsLimit'] == 64
                assert host['NanoCpus'] == 1_000_000_000 and not host.get('PortBindings')
                role = meta['Name'].rsplit('-', 1)[-1]
                assert host['NetworkMode'] == (evidence.state['network'] if role == 'proxy' else 'none')
                assert all(m['Destination'] in ('/ipc', '/adapter', '/tmp', '/job') for m in meta['Mounts'])
                if role == 'download':
                    assert all(not m.get('RW', False) for m in meta['Mounts'] if m['Destination'] == '/ipc')
                with open(evidence.out / 'isolation.jsonl', 'a', encoding='utf-8') as stream:
                    stream.write(json.dumps({'name': meta['Name'], 'role': role, 'network': host['NetworkMode'],
                                             'user': meta['Config']['User'], 'readonly': True,
                                             'capsDropped': host['CapDrop'], 'memory': host['Memory'],
                                             'pids': host['PidsLimit'], 'cpu': host['NanoCpus']}) + '\n')
            return result

    return package, acquisition, CheckedRuntime


SERVER = r'''
import http.server,json,socket,socketserver,ssl,struct,threading,time
from pathlib import Path
lock=threading.Lock(); stats={'dns':{},'http':[],'tlsErrors':0}
def save():
    Path('/job/stats.tmp').write_text(json.dumps(stats));Path('/job/stats.tmp').replace('/job/stats.json')
def dns_answer(data):
    labels=[];at=12
    while data[at]:
        n=data[at];at+=1;labels.append(data[at:at+n].decode());at+=n
    host='.'.join(labels);end=at+5
    with lock:
        stats['dns'][host]=stats['dns'].get(host,0)+1; count=stats['dns'][host];save()
    addresses=['11.250.0.10']
    if host=='private.fixture.test': addresses=['127.0.0.1']
    if host=='mixed.fixture.test': addresses=['11.250.0.10','127.0.0.1']
    if host=='rebind.fixture.test' and count>1: addresses=['127.0.0.1']
    question=data[12:end];answers=b''
    if data[end-4:end-2]==b'\x00\x01':
        for ip in addresses: answers+=b'\xc0\x0c'+struct.pack('!HHIH',1,1,0,4)+socket.inet_aton(ip)
    return data[:2]+b'\x81\x80'+struct.pack('!HHHH',1,len(addresses) if answers else 0,0,0)+question+answers
class DNS(socketserver.BaseRequestHandler):
    def handle(self): data,sock=self.request;sock.sendto(dns_answer(data),self.client_address)
class Web(http.server.BaseHTTPRequestHandler):
    def log_message(self,*args): pass
    def do_HEAD(self): self.serve(False)
    def do_GET(self): self.serve(True)
    def serve(self,body):
        with lock: stats['http'].append({'path':self.path,'method':self.command});save()
        if self.path.startswith('/redirect'):
            target='private.fixture.test' if 'private' in self.path else 'unknown.fixture.test'
            self.send_response(302);self.send_header('Location','https://'+target+'/source.mp4');self.end_headers();return
        payload=Path('/fixture/source.mp4').read_bytes();self.send_response(200)
        self.send_header('Content-Type','video/mp4');self.send_header('Content-Length',str(len(payload)));self.end_headers()
        if body:
            if self.path.startswith('/slow') or self.path.startswith('/hang'): time.sleep(10)
            try:self.wfile.write(payload)
            except (BrokenPipeError,ConnectionResetError,ssl.SSLError): pass
class HTTPS(http.server.ThreadingHTTPServer):
    daemon_threads=True
    def get_request(self):
        sock,addr=super().get_request()
        try:return context.wrap_socket(sock,server_side=True),addr
        except ssl.SSLError:
            with lock:stats['tlsErrors']+=1;save()
            sock.close();raise
context=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER);context.load_cert_chain('/fixture/server.crt','/fixture/server.key')
save();dns=socketserver.ThreadingUDPServer(('0.0.0.0',53),DNS)
threading.Thread(target=dns.serve_forever,daemon=True).start()
HTTPS(('0.0.0.0',443),Web).serve_forever()
'''


def build(evidence, context, name, dockerfile='Dockerfile'):
    reference = evidence.state['registry'] + '/ci/' + name + ':test'
    recipe=(context/dockerfile).resolve()
    assert recipe.is_relative_to(context.resolve()) and recipe.is_file()
    result = docker('build', '--pull=false', '-f', str(recipe), '-t', reference, str(context), timeout=600, check=False)
    (evidence.out / ('build-' + name + '.log')).write_bytes(result.stdout + result.stderr)
    if result.returncode:
        raise AssertionError('Image build failed: ' + name)
    docker('push', reference, timeout=180)
    digests = json.loads(docker('image', 'inspect', reference, '--format', '{{json .RepoDigests}}').stdout)
    matches = [x for x in digests if x.startswith(reference.rsplit(':', 1)[0] + '@sha256:')]
    assert len(matches) == 1
    docker('pull', matches[0], timeout=60)
    return matches[0]


def media_tool(evidence,image,role,args,data=None):
    """Real FFmpeg tools in the already approved offline image, with pipe I/O."""
    assert role in ('generator','asset-probe','asset-decode')
    name=evidence.state['owner']+'-'+role;evidence.record('container',name)
    options=['run','--rm','--name',name,'--label','ci.footage.owner='+evidence.state['owner'],
             '--network','none','--read-only','--user','10001:10001','--cap-drop','ALL',
             '--security-opt','no-new-privileges:true','--memory','512m','--memory-swap','512m',
             '--cpus','1','--pids-limit','64','--tmpfs','/tmp:rw,noexec,nosuid,size=16m']
    if data is not None:options.append('-i')
    return docker(*options,image,*args,data=data,timeout=45)


def case(report, name, operation):
    started = time.monotonic()
    try:
        detail = operation()
        report['checks'].append({'name': name, 'status': 'PASS', 'seconds': round(time.monotonic()-started, 3), 'detail': detail})
    except Exception as error:
        report['checks'].append({'name': name, 'status': 'FAIL', 'error': type(error).__name__ + ': ' + str(error)[:2000]})
        raise


def require_complete(report):
    checks=report['checks']
    assert len(checks)==len(REQUIRED_CASES) and {x['name'] for x in checks}==REQUIRED_CASES
    assert all(x['status']=='PASS' for x in checks)
    assert report['unitTests']['executed']==REQUIRED_UNIT_TESTS and report['unitTests']['skipped']==0


def runtime_acceptance(repo, out):
    repo = Path(repo).resolve(); out = Path(out).resolve()
    assert not out.exists();out.mkdir(mode=0o700)
    workspace = Path(tempfile.mkdtemp(prefix='footage-ci-', dir=os.environ['RUNNER_TEMP']))
    owner = 'ci-footage-' + uuid.uuid4().hex
    state = {'owner': owner, 'workspace': str(workspace), 'network': owner + '-network',
             'head': os.environ['ACCEPTANCE_HEAD_SHA'], 'base': os.environ['ACCEPTANCE_BASE_SHA'],
             'run': os.environ['GITHUB_RUN_ID'], 'attempt': os.environ['GITHUB_RUN_ATTEMPT'],
             'checkout': command(['git','rev-parse','HEAD'],cwd=repo).stdout.decode().strip(),
             'tree': command(['git','rev-parse','HEAD^{tree}'],cwd=repo).stdout.decode().strip()}
    assert re.fullmatch('[a-f0-9]{40}',state['head']) and re.fullmatch('[a-f0-9]{40}',state['base'])
    assert state['tree'] == command(['git','rev-parse',state['head']+'^{tree}'],cwd=repo).stdout.decode().strip()
    write(out/'state.json',state);evidence=Evidence(out)
    report={'status':'RUNNING','identity':state.copy(),'checks':[], 'fixture':'generated patterns and tones only',
            'scope':'Test network/DNS and trust instrumentation; product code unchanged'}
    try:
        prepare_runtime(repo,evidence,report)
        exercise_runtime(repo,evidence,report)
        require_complete(report)
        report['status']='PASS'
    except BaseException as error:
        report['status']='FAIL';report['error']=type(error).__name__+': '+str(error)[:2000]
        raise
    finally:
        try:evidence.cleanup();report['cleanup']='PASS'
        except Exception as error:report['cleanup']='FAIL';report['cleanupError']=str(error);raise
        finally:
            report['cleanupScope']='Exact owned containers, IPC volumes, fixture network and loopback registry; tool/image build caches expire with the disposable GitHub runner, no global prune'
            write(out/'runtime-acceptance.json',report)


def prepare_runtime(repo, evidence, report):
    package, acquisition, factory = checked_runtime(repo, evidence)
    root = Path(evidence.state['workspace']);owner=evidence.state['owner']
    registry=owner+'-registry';evidence.record('container',registry)
    docker('run','-d','--name',registry,'--label','ci.footage.owner='+owner,
           '--network','bridge','-p','127.0.0.1::5000','--read-only','--cap-drop','ALL',
           '--security-opt','no-new-privileges:true','--memory','2g','--cpus','1','--pids-limit','64',
           '--tmpfs','/var/lib/registry:rw,nosuid,size=1536m','--tmpfs','/tmp:rw,noexec,nosuid,size=16m',
           '-e','OTEL_TRACES_EXPORTER=none',REGISTRY,timeout=180)
    ports=inspect('container',registry)['NetworkSettings']['Ports']['5000/tcp']
    assert len(ports)==1 and ports[0]['HostIp']=='127.0.0.1'
    evidence.state['registry']='127.0.0.1:'+ports[0]['HostPort'];write(evidence.state_path,evidence.state)
    context=root/'contexts';context.mkdir()
    downloader=context/'downloader';shutil.copytree(package,downloader,ignore=shutil.ignore_patterns('__pycache__'))
    original=build(evidence,downloader,'downloader-original',dockerfile='runtime/Dockerfile')
    lock=json.loads((package/'runtime/tools.lock.json').read_text())
    hash_container=owner+'-tool-hash';evidence.record('container',hash_container)
    result=docker('run','--rm','--name',hash_container,'--label','ci.footage.owner='+owner,
                  '--network','none','--cap-drop','ALL','--security-opt','no-new-privileges:true',
                  original,'python','-c',"import hashlib; print(hashlib.file_digest(open('/opt/yt-dlp','rb'),'sha256').hexdigest())")
    assert result.stdout.decode().strip()==lock['ytDlpSha256']
    report['toolsLockSha256']=sha(package/'runtime/tools.lock.json');report['registryImage']=REGISTRY
    tls=root/'tls';tls.mkdir(mode=0o700)
    command(['openssl','req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=Footage CI Test CA',
             '-keyout',tls/'ca.key','-out',tls/'ca.crt'])
    command(['openssl','req','-newkey','rsa:2048','-nodes','-subj','/CN=media.fixture.test',
             '-keyout',tls/'server.key','-out',tls/'server.csr'])
    (tls/'extensions').write_text('subjectAltName=DNS:media.fixture.test,DNS:rebind.fixture.test\nextendedKeyUsage=serverAuth\n')
    command(['openssl','x509','-req','-in',tls/'server.csr','-CA',tls/'ca.crt','-CAkey',tls/'ca.key',
             '-CAcreateserial','-days','1','-extfile',tls/'extensions','-out',tls/'server.crt'])
    trusted=context/'trusted';trusted.mkdir();shutil.copyfile(tls/'ca.crt',trusted/'ci.crt')
    (trusted/'Dockerfile').write_text(f'FROM {original}\nUSER 0:0\nCOPY ci.crt /usr/local/share/ca-certificates/footage-ci.crt\nRUN update-ca-certificates\nENV SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt REQUESTS_CA_BUNDLE=/etc/ssl/certs/ca-certificates.crt\nUSER 10001:10001\n')
    trusted_image=build(evidence,trusted,'downloader-trusted')
    offline=context/'offline';offline.mkdir()
    (offline/'Dockerfile').write_text(f"FROM {lock['pythonImage']}\nRUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates && rm -rf /var/lib/apt/lists/*\nUSER 10001:10001\n")
    offline_image=build(evidence,offline,'offline')
    media=root/'source.mp4'
    generated=media_tool(evidence,offline_image,'generator',['/usr/bin/ffmpeg','-v','error','-f','lavfi','-i','testsrc2=size=360x640:rate=30',
             '-f','lavfi','-i','sine=frequency=220:sample_rate=48000','-t','6','-c:v','libx264',
             '-preset','ultrafast','-crf','18','-c:a','aac','-fs',str(20*1024**2),
             '-movflags','frag_keyframe+empty_moov','-f','mp4','pipe:1'])
    assert 0<len(generated.stdout)<=20*1024**2
    media.write_bytes(generated.stdout)
    shutil.copyfile(media,evidence.out/'generated-source.mp4')
    fixture=context/'fixture';fixture.mkdir()
    for filename in ('server.crt','server.key'):shutil.copyfile(tls/filename,fixture/filename)
    shutil.copyfile(media,fixture/'source.mp4');(fixture/'server.py').write_text(SERVER)
    (fixture/'Dockerfile').write_text(f'FROM {offline_image}\nCOPY --chown=10001:10001 . /fixture/\nCMD ["python","/fixture/server.py"]\n')
    fixture_image=build(evidence,fixture,'fixture')
    # A deterministic delayed real FFmpeg child exercises the unchanged timeout.
    slow=context/'slow';slow.mkdir()
    (slow/'ffmpeg').write_text('#!/usr/local/bin/python\nimport os,sys,time\nopen("/job/ffmpeg-started","x").close()\ntime.sleep(3)\nos.execv("/usr/bin/ffmpeg.real",["ffmpeg",*sys.argv[1:]])\n')
    (slow/'Dockerfile').write_text(f'FROM {offline_image}\nUSER 0:0\nRUN mv /usr/bin/ffmpeg /usr/bin/ffmpeg.real\nCOPY --chmod=755 ffmpeg /usr/bin/ffmpeg\nUSER 10001:10001\n')
    slow_image=build(evidence,slow,'offline-delayed')
    evidence.record('network',evidence.state['network'])
    docker('network','create','--driver','bridge','--internal','--subnet',NETWORK,
           '--label','ci.footage.owner='+owner,evidence.state['network'])
    network=inspect('network',evidence.state['network']);assert network['Internal'] and network['IPAM']['Config'][0]['Subnet']==NETWORK
    server=owner+'-fixture';evidence.record('container',server)
    docker('run','-d','--name',server,'--label','ci.footage.owner='+owner,'--network',evidence.state['network'],
           '--ip',PUBLIC_IP,'--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true',
           '--user','10001:10001','--memory','256m','--cpus','1','--pids-limit','64',
           '--tmpfs','/job:rw,nosuid,size=16m,uid=10001,gid=10001,mode=0700',fixture_image)
    deadline=time.monotonic()+15
    while time.monotonic()<deadline:
        if docker('exec',server,'python','-c',"import socket; s=socket.create_connection(('127.0.0.1',443),1);s.close()",check=False).returncode==0:break
        time.sleep(.1)
    else:raise AssertionError('Generated HTTPS/DNS fixture did not become ready')
    config={'downloaderImage':trusted_image,'offlineImage':offline_image}
    evidence.state.update(config=config,untrustedImage=original,slowImage=slow_image,fixture=server,
                          sourceSha256=sha(media),sourceBytes=media.stat().st_size)
    write(evidence.state_path,evidence.state);report['images']={'original':original,**config,'delayedOffline':slow_image,'fixture':fixture_image}
    report['testTrust']='Disposable CA added to derivative only; downloader bytes/TLS verification unchanged'
    os.environ['FOOTAGE_TEST_IMAGE']=trusted_image
    suite=unittest.defaultTestLoader.discover(str(package/'tests'),top_level_dir=str(package))
    # Preserve the smoke's actual network test, adding only owned lifecycle IDs.
    smoke=importlib.import_module('tests.test_runtime_integration');smoke_calls=[]
    original_subprocess=smoke.subprocess;original_runtime=smoke.Runtime
    def owned_smoke(args,**kwargs):
        assert args[:2]==['docker','run'] and '--rm' in args and '--network' in args
        assert args[args.index('--network')+1]=='none'
        name=owner+'-smoke';evidence.record('container',name);smoke_calls.append(name)
        return subprocess.run(args[:2]+['--name',name,'--label','ci.footage.owner='+owner]+args[2:],**kwargs)
    smoke.subprocess=types.SimpleNamespace(**vars(original_subprocess))
    smoke.subprocess.run=owned_smoke;smoke.Runtime=factory
    class RecordingResult(unittest.TextTestResult):
        def __init__(self,*args,**kwargs):
            super().__init__(*args,**kwargs);self.success_ids=[]
        def addSuccess(self,test):
            super().addSuccess(test);self.success_ids.append(test.id())
    try:
        with open(evidence.out/'unit-tests.log','w') as log:
            result=unittest.TextTestRunner(stream=log,verbosity=2,resultclass=RecordingResult).run(suite)
    finally:
        smoke.subprocess=original_subprocess;smoke.Runtime=original_runtime
    assert result.testsRun==REQUIRED_UNIT_TESTS and result.wasSuccessful() and not result.skipped
    assert len(smoke_calls)==1 and REQUIRED_REAL_TESTS <= set(result.success_ids)
    report['unitTests']={'executed':result.testsRun,'skipped':len(result.skipped),'contractAndSyntheticTests':17,
                         'realNoRouteSmoke':1,'realTmpfsTransport':1,'successfulTestIds':result.success_ids}
    case(report,'official-tool-hash-and-real-unit-smoke',lambda:report['unitTests'])


def fixture_stats(evidence):
    return json.loads(docker('exec',evidence.state['fixture'],'python','-c',"print(open('/job/stats.json').read())").stdout)


def probe_worker(worker, code):
    return json.loads(docker('exec','-i',worker,'python','-c',code,timeout=30).stdout)


def exercise_runtime(repo, evidence, report):
    package, acquisition, factory=checked_runtime(repo,evidence)
    contract=importlib.import_module('contract');cache=importlib.import_module('cache')
    policy=contract.LIMITS|{'hosts':['media.fixture.test','private.fixture.test','mixed.fixture.test','rebind.fixture.test'],
                           'acquisitionSeconds':30,'normalizeSeconds':15}
    request={'schemaVersion':1,'requestId':'generated','projectId':'synthetic-1','revision':1,'authorizationScope':'ci-owner',
             'url':'https://media.fixture.test/source.mp4?generated=1','interval':[1,3],'outputFrom':30,'anchorWord':'w1',
             'context':'Generated supporting test pattern','use':'illustrative',
             'rights':{'status':'approved','scope':'ci-owner','basis':'owned','evidence':'Generated by this CI job','attribution':'CI generated fixture'}}
    config=evidence.state['config'];root=Path(evidence.state['workspace'])
    positive=root/'cache-positive';positive.mkdir(mode=0o700)
    sentinel=root/'untouched-sentinel';sentinel.write_text('owned sentinel')
    def accepted():
        asset=acquisition.acquire(request,policy,config,positive,factory)
        facts=asset['facts'];assert facts['fullDecode']=='PASS' and facts['fps']==30 and facts['codec']=='h264'
        assert abs(facts['duration']-2)<=1/30+.002 and facts['sha256']==sha(asset['path'])
        assert facts['acquiredSha256']==evidence.state['sourceSha256']
        assert 'generated=1' not in asset['source']['urlWithoutQuery'] and asset['contentReview']=='PENDING'
        contents=Path(asset['path']).read_bytes();assert 0<len(contents)<=policy['assetBytes']
        streams=json.loads(media_tool(evidence,config['offlineImage'],'asset-probe',
            ['/usr/bin/ffprobe','-v','error','-protocol_whitelist','file,pipe','-show_streams','-of','json','pipe:0'],contents).stdout)['streams']
        assert len(streams)==1 and streams[0]['codec_type']=='video' and streams[0]['codec_name']=='h264'
        assert streams[0]['avg_frame_rate']=='30/1' and int(streams[0]['nb_frames'])==60
        media_tool(evidence,config['offlineImage'],'asset-decode',
                   ['/usr/bin/ffmpeg','-v','error','-protocol_whitelist','file,pipe','-i','pipe:0','-f','null','-'],contents)
        # Reuse must not start another downloader, even if presentation context differs.
        before=len(evidence.resources())
        reused=acquisition.acquire(request|{'context':'Different generated placement'},policy,config,positive,factory)
        assert reused['sha256']==asset['sha256'] and len(evidence.resources())==before
        receipt=Path(asset['path']).parent/'receipt.json'
        shutil.copyfile(asset['path'],evidence.out/'acquired-generated.mp4')
        shutil.copyfile(receipt,evidence.out/'acquired-receipt.json')
        return {'assetSha256':asset['sha256'],'acquiredSha256':facts['acquiredSha256'],
                'receiptSha256':sha(receipt),'duration':facts['duration'],'cacheReuse':True}
    case(report,'real-https-acquisition-normalization-and-cache',accepted)
    evidence.state.update(request=request,policy=policy,positiveCache=str(positive));write(evidence.state_path,evidence.state)

    def failed(name,patch=None,configuration=None,req=None,runtime_factory=None):
        folder=root/('cache-'+name);folder.mkdir(mode=0o700)
        initial=len(evidence.resources())
        try:acquisition.acquire(req or request,policy|(patch or {}),configuration or config,folder,runtime_factory or factory)
        except Exception:pass
        else:raise AssertionError('Expected real failure: '+name)
        assert list(folder.iterdir())==[],'Partial ready cache or lock remained: '+name
        roles={entry['name'].rsplit('-',1)[-1] for entry in evidence.resources()[initial:] if entry['kind']=='container'}
        assert {'proxy','download'} <= roles,'Failure never reached the real downloader'
        if name in ('normalize','storage'):assert 'offline' in roles
        assert sentinel.read_text()=='owned sentinel'
        # Infra stays running; every runtime-owned object must already be gone.
        assert not [x for x in evidence.remaining() if x['name'].startswith('footage-')]
        return {'noReadyOrPartial':True,'productRuntimeCleanup':True}
    before=fixture_stats(evidence)['tlsErrors']
    case(report,'untrusted-tls-certificate-rejected',lambda:failed('untrusted',configuration=config|{'downloaderImage':evidence.state['untrustedImage']}))
    assert fixture_stats(evidence)['tlsErrors']>before
    for label,path in [('redirect-unknown','/redirect-unknown.mp4'),('redirect-private','/redirect-private.mp4')]:
        case(report,label,lambda label=label,path=path:failed(label,req=request|{'url':'https://media.fixture.test'+path}))
    case(report,'encrypted-traffic-budget',lambda:failed('traffic',{'trafficBytes':4096}))
    connection_before=fixture_stats(evidence)
    case(report,'connection-count-budget',lambda:failed('connections',{'connections':1}))
    connection_after=fixture_stats(evidence)
    assert connection_after['dns'].get('media.fixture.test',0)-connection_before['dns'].get('media.fixture.test',0)==1
    assert len(connection_after['http'])>len(connection_before['http'])
    def acquisition_deadline():
        before=sum(x['path'].startswith('/slow') for x in fixture_stats(evidence)['http'])
        detail=failed('deadline',{'acquisitionSeconds':5},req=request|{'url':'https://media.fixture.test/slow.mp4'})
        after=sum(x['path'].startswith('/slow') for x in fixture_stats(evidence)['http'])
        assert after>before,'Acquisition deadline did not reach the slow fixture'
        return detail
    case(report,'acquisition-deadline',acquisition_deadline)
    case(report,'normalization-deadline-real-delayed-child',lambda:failed('normalize',{'normalizeSeconds':1},configuration=config|{'offlineImage':evidence.state['slowImage']}))
    assert (evidence.out/'normalization-child-started.jsonl').exists(),'Normalization failure never reached delayed FFmpeg'
    def storage_factory(configuration):
        class Exhausted(factory):
            def call(self,args,**kwargs):
                # Actual bounded tmpfs exhaustion, immediately before staged input.
                if args[:3]==['exec','-i',self.volume+'-offline'] and args[-2:]==['-c',"import sys,shutil; f=open('/job/download.bin','xb'); shutil.copyfileobj(sys.stdin.buffer,f,65536); f.close()"]:
                    full=docker('exec',self.volume+'-offline','python','-c',"import os\nf=os.open('/job/full',os.O_CREAT|os.O_WRONLY,0o600);b=b'x'*1048576\ntry:\n while True:os.write(f,b)\nexcept OSError as e:\n assert e.errno==28\n print('ENOSPC')\nfinally:os.close(f)",timeout=20)
                    assert full.stdout.strip()==b'ENOSPC'
                return super().call(args,**kwargs)
        return Exhausted(configuration)
    case(report,'owned-tmpfs-exhaustion',lambda:failed('storage',runtime_factory=storage_factory))
    boundary_probes(repo,evidence,report,factory,policy,config)
    def fresh_positive():
        target=root/'cache-final-control';target.mkdir(mode=0o700)
        asset=acquisition.acquire(request|{'url':'https://media.fixture.test/source.mp4?final=control'},policy,config,target,factory)
        assert asset['facts']['fullDecode']=='PASS' and asset['facts']['acquiredSha256']==evidence.state['sourceSha256']
        return {'assetSha256':asset['sha256'],'freshAcquisition':True}
    case(report,'fresh-positive-control-after-denials',fresh_positive)
    cancellation(repo,evidence,report)


def boundary_probes(repo,evidence,report,factory,policy,config):
    with factory(config) as runtime:
        runtime.call(['volume','create',runtime.volume]);runtime.created=True
        gateway=runtime.spawn('proxy',runtime.image,['--network','bridge','--mount',f'type=volume,src={runtime.volume},dst=/ipc'])
        runtime.call(['exec','-d',gateway,'python','runtime/guarded_proxy.py',json.dumps(policy)])
        runtime.call(['exec',gateway,'python','-c',"import time,os; end=time.monotonic()+5\nwhile not os.path.exists('/ipc/proxy.sock'):\n assert time.monotonic()<end;time.sleep(.05)"])
        # Reachable private loopback canary belongs only to this test gateway.
        runtime.call(['exec','-d',gateway,'python','-c',"import socket,json\nfrom pathlib import Path\ns=socket.socket();s.bind(('127.0.0.1',443));s.listen();Path('/job/canary.json').write_text('0')\nn=0\nwhile True:\n c,a=s.accept();n+=1;Path('/job/canary.json').write_text(str(n));c.close()"])
        runtime.call(['exec',gateway,'python','-c',"import time,socket\nfrom pathlib import Path\nend=time.monotonic()+5\nwhile not Path('/job/canary.json').exists():\n assert time.monotonic()<end;time.sleep(.05)\ns=socket.create_connection(('127.0.0.1',443),1);s.close()\nwhile Path('/job/canary.json').read_text()!='1':\n assert time.monotonic()<end;time.sleep(.05)"])
        worker=runtime.spawn('download',runtime.image,['--network','none','--mount',f'type=volume,src={runtime.volume},dst=/ipc,readonly'])
        def destination_checks():
            result=probe_worker(worker,"""import json,socket,time
from runtime.proxy_relay import start
start()
def connect(authority,method='CONNECT'):
 s=socket.create_connection(('127.0.0.1',18080),2);s.settimeout(3)
 s.sendall((method+' '+authority+' HTTP/1.1\\r\\nHost: '+authority+'\\r\\n\\r\\n').encode())
 response=s.recv(4096).decode().split('\\r\\n')[0];s.close();return response
answers={host:connect(host) for host in ['media.fixture.test:443','private.fixture.test:443','mixed.fixture.test:443','unknown.fixture.test:443','127.0.0.1:443','[::1]:443','media.fixture.test:444']}
answers['forward']=connect('https://media.fixture.test/source.mp4','GET')
answers['rebindFirst']=connect('rebind.fixture.test:443');answers['rebindSecond']=connect('rebind.fixture.test:443')
print(json.dumps(answers))
""")
            assert ' 200 ' in result['media.fixture.test:443'] and ' 200 ' in result['rebindFirst']
            assert all(' 403 ' in value for key,value in result.items() if key not in ('media.fixture.test:443','rebindFirst'))
            stats=fixture_stats(evidence);assert stats['dns']['rebind.fixture.test']==2
            assert 'unknown.fixture.test' not in stats['dns']
            canary=runtime.call(['exec',gateway,'python','-c',"print(open('/job/canary.json').read())"]).strip()
            assert canary==b'1','A rejected destination reached the proven-reachable private canary'
            return {'responses':result,'rebindDNSQueries':2,'privateCanaryConnectionsAfterControl':0}
        case(report,'real-destination-mixed-rebinding-and-forwarding-denials',destination_checks)
        def bypass():
            code="""import json,os,socket,subprocess,sys
for key in list(os.environ):
 if 'proxy' in key.lower():del os.environ[key]
def direct():
 s=socket.socket();s.settimeout(1)
 try:s.connect(('11.250.0.10',443))
 except OSError:return True
 finally:s.close()
 return False
assert direct()
child=subprocess.run([sys.executable,'-c',"import socket; s=socket.socket();s.settimeout(1)\\ntry:s.connect(('11.250.0.10',443))\\nexcept OSError:print('NO_ROUTE')\\nelse:raise SystemExit('bypass')"],capture_output=True,timeout=3)
assert child.returncode==0 and child.stdout.strip()==b'NO_ROUTE'
print(json.dumps({'direct':'NO_ROUTE','child':'NO_ROUTE','proxyEnvironmentRemoved':True}))
"""
            return probe_worker(worker,code)
        case(report,'actual-worker-and-child-cannot-bypass-proxy',bypass)


def cancellation(repo,evidence,report):
    for sig in (signal.SIGINT,signal.SIGTERM):
        before=len(fixture_stats(evidence)['http'])
        log=evidence.out/('cancel-'+sig.name+'.log')
        with open(log,'wb') as output:
            child=subprocess.Popen([sys.executable,str(Path(__file__).resolve()),'--mode','cancel-child',
                                    '--repo',str(repo),'--evidence',str(evidence.out)],stdout=output,stderr=output,start_new_session=True)
            try:
                deadline=time.monotonic()+20
                while time.monotonic()<deadline:
                    if child.poll() is not None:raise AssertionError('Cancellation fixture exited before acquisition')
                    requests=fixture_stats(evidence)['http'][before:]
                    if any(x['path'].startswith('/hang') for x in requests):break
                    time.sleep(.1)
                else:raise AssertionError('Cancellation never reached controlled HTTPS request')
                child.send_signal(sig);child.wait(timeout=15)
                leftovers=[x for x in evidence.remaining() if x['name'].startswith('footage-')]
                cache=Path(evidence.state['workspace'])/'cache-cancel'
                files=[p.name for p in cache.iterdir()] if cache.exists() else []
                detail={'signal':sig.name,'exit':child.returncode,'productResourceLeftovers':leftovers,
                        'productCacheLeftovers':files,'emergencyCleanupCountsAsProductPass':False}
                write(evidence.out/('cancellation-'+sig.name+'.json'),detail)
                case(report,'product-cancellation-'+sig.name,
                     lambda detail=detail: assert_clean_cancellation(detail))
            finally:
                if child.poll() is None:child.kill();child.wait(timeout=10)


def assert_clean_cancellation(detail):
    assert detail['exit']!=0,'Cancellation did not terminate the acquisition'
    assert not detail['productResourceLeftovers'] and not detail['productCacheLeftovers'],json.dumps(detail)
    return detail


def cancel_child(repo,evidence):
    package,_,factory=checked_runtime(repo,evidence)
    config=evidence.state['config'];root=Path(evidence.state['workspace'])
    request=evidence.state['request']|{'url':'https://media.fixture.test/hang.mp4'}
    # Run the canonical CLI, including its own signal setup. Only its imported
    # launcher gets the same isolated test-network/ownership instrumentation.
    for name,value in [('request',request),('policy',evidence.state['policy']),('runtime',config)]:
        write(root/('cancel-'+name+'.json'),value)
    launch=importlib.import_module('runtime.launch');original=launch.Runtime
    previous_argv=sys.argv;launch.Runtime=factory
    sys.argv=[str(package/'acquire.py'),'--request',str(root/'cancel-request.json'),
              '--policy',str(root/'cancel-policy.json'),'--runtime',str(root/'cancel-runtime.json'),
              '--cache',str(root/'cache-cancel')]
    try:runpy.run_path(str(package/'acquire.py'),run_name='__main__')
    finally:launch.Runtime=original;sys.argv=previous_argv


def join_acceptance(repo,evidence):
    package,_,_=checked_runtime(repo,evidence)
    compose=importlib.import_module('compose_manifest').compose
    assert json.loads((evidence.out/'runtime-acceptance.json').read_text())['status']=='PASS'
    studio=Path(repo)/'tools/video-studio/13_editing_pipeline/v1'
    existing=Path(os.environ['STUDIO_EVIDENCE']);runtime=existing/'runtime.json'
    original=json.loads((existing/'fixtures/manifest-1.json').read_text())
    result=compose(original,evidence.state['request'],evidence.state['policy'],evidence.state['positiveCache'])
    for key in ('audio','font'):assert result['inputs'][key]==original['inputs'][key]
    for key in ('source','cuts'):assert result['project'][key]==original['project'][key]
    assert result['project']['revision']==original['project']['revision']+1
    acquired=result['provenance']['acquiredAssets'];assert len(acquired)==1
    binding=next(iter(acquired.values()));assert sha(binding['receiptPath'])==binding['receiptSha256']
    manifest=Path(evidence.state['workspace'])/'composed-manifest.json';write(manifest,result)
    project=Path(evidence.state['workspace'])/'composed-project'
    config=json.loads(runtime.read_text());node=config['nodeExecutable'];python=config['pythonExecutable']
    command([python,studio/'prepare.py','--manifest',manifest,'--output',project,'--runtime',runtime],timeout=120)
    for mode in ('validate','stills','render'):
        run=command([node,studio/'run.mjs',mode,project,'--runtime',runtime],cwd=studio,timeout=240)
        (evidence.out/('joined-'+mode+'.log')).write_bytes(run.stdout+run.stderr)
    qa=command([python,studio/'qa.py',project,'--runtime',runtime],cwd=studio,timeout=120)
    (evidence.out/'joined-qa.log').write_bytes(qa.stdout+qa.stderr)
    facts=json.loads((project/'qa/final-verification.json').read_text())
    assert facts['status']=='PASS' and facts['fullDecode']=='PASS' and facts['frames']==180 and facts['fps']==30
    assert facts['creativeApproval']=='PENDING' and facts['sha256']==sha(project/'final.mp4')
    render=json.loads((project/'render-receipt.json').read_text());assert render['bindings']==facts['bindings']
    verify="""import fs from 'node:fs';import {createExportAcceptance,readRendererIdentity} from './export-acceptance.mjs';import {hash} from './runtime.mjs';
const [dir,runtimeFile]=process.argv.slice(1),p=JSON.parse(fs.readFileSync(dir+'/project.json'));
const {rendererHash}=await readRendererIdentity(process.cwd(),dir+'/public/font.ttf',p.profile);
const value=await createExportAcceptance({dir,root:process.cwd(),projectHash:await hash(dir+'/project.json'),rendererHash,profile:p.profile,runtimeFile})();
if(!value.ready||value.status!=='ACCEPTED')throw Error('Joined export not accepted');console.log(JSON.stringify(value));"""
    acceptance=json.loads(command([node,'--input-type=module','-e',verify,project,runtime],cwd=studio).stdout)
    shutil.copyfile(manifest,evidence.out/'composed-manifest.json')
    shutil.copyfile(project/'prepare-receipt.json',evidence.out/'joined-prepare-receipt.json')
    shutil.copyfile(project/'project.json',evidence.out/'joined-project.json')
    shutil.copyfile(project/'final.mp4',evidence.out/'joined-generated.mp4')
    write(evidence.out/'joined-acceptance.json',{'status':'PASS','identity':evidence.state,
          'manifestSha256':sha(manifest),'acquiredReceiptSha256':binding['receiptSha256'],
          'audioFontSourceCutsPreserved':True,'acceptance':acceptance,'qa':facts,'render':render,
          'finalSha256':sha(project/'final.mp4'),'limits':['Generated footage only','No spoken app journey','Creative review remains pending']})


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--repo',required=True);parser.add_argument('--evidence',required=True)
    parser.add_argument('--mode',choices=['runtime','join','cleanup','cancel-child'],required=True)
    args=parser.parse_args()
    if args.mode!='cancel-child':
        def interrupted(_signal,_frame):
            raise KeyboardInterrupt()
        signal.signal(signal.SIGTERM,interrupted)
    assert sys.platform=='linux','Genuine Linux Docker required'
    if args.mode=='runtime':runtime_acceptance(args.repo,args.evidence)
    elif args.mode=='cleanup':Evidence(args.evidence).cleanup()
    elif args.mode=='join':join_acceptance(args.repo,Evidence(args.evidence))
    else:cancel_child(args.repo,Evidence(args.evidence))


if __name__=='__main__':main()
