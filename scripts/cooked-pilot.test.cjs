// All host facts and external commands are fixtures. No Docker/SSH/network runs.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {spawnSync} = require('node:child_process');
const {createHash} = require('node:crypto');
const path = require('node:path');
const helper = fs.readFileSync(path.join(__dirname, 'cooked-pilot.sh'), 'utf8');
const source = helper.split("<<'PY'\n")[1].replace(/\nPY\n$/, '');
const record = () => ({schema:1, appSHA:'a'.repeat(40), appImage:'ghcr.io/celleree/publish-everywhere-postiz@sha256:'+'b'.repeat(64), workerImage:'ghcr.io/celleree/publish-everywhere-cooked-worker@sha256:'+'c'.repeat(64), organizationId:'pilot-only', ipcDirectory:'/private/cooked', profile:'one-session', sourceNoticeEvidence:'d'.repeat(64), nonproductionEvidence:'e'.repeat(64), resourceEvidence:'f'.repeat(64), fixture:{sha256:'1'.repeat(64),owned:true,durationSeconds:15,width:640,height:360}});
const harness = String.raw`
import fcntl,os,sys,json,stat,types,subprocess,pathlib
from unittest.mock import patch
r=json.loads(os.environ['TEST_RECORD']); scenario=os.environ['TEST_SCENARIO']; calls=[]; enabled=scenario in ('enabled','disable','stopfail','foreign','wrongworker','lowresources'); worker=enabled or scenario in ('stopped','orphan'); stopped=scenario=='stopped'
app_id='sha256:app'; worker_id='sha256:worker'
competitor=None
if scenario=='contention':
 competitor=os.open('.',os.O_RDONLY|os.O_DIRECTORY); fcntl.flock(competitor,fcntl.LOCK_EX|fcntl.LOCK_NB)
def output(args,**kwargs):
 global enabled,worker,stopped
 calls.append(list(args))
 if args[0]=='git':
  if args[1:]==('status','--porcelain'): return ''
  if args[1]=='branch': return 'main'
  if args[1]=='merge-base': return ''
  if args[1]=='rev-parse': return 'a'*40 if scenario!='source' else '0'*40
 if args[:3]==('docker','exec','postiz'):
  return '10002' if scenario=='identity' else '0'
 if args[:3]==('docker','exec','publish-everywhere-web'):
  if scenario=='proxyfail': raise RuntimeError()
  return ''
 if args[:3]==('docker','ps','-aq'): return 'worker' if worker else ''
 if args[:2]==('docker','compose') and args[-3:]==('ps','-q','cooked-editor'):
  assert kwargs['env']['COOKED_PILOT_ORGANIZATIONS']==r['organizationId'] and kwargs['env']['COOKED_IPC_DIR']==r['ipcDirectory'] and kwargs['env']['COOKED_WORKER_IMAGE']==r['workerImage']
  assert not any(k.startswith('COMPOSE_') or k.startswith('COOKED_EDITOR_') for k in kwargs['env'])
  return 'worker'
 if args[0]=='docker' and args[2]=='inspect' and args[3]=='--format':
  kind,template,identity=args[1],args[4],args[5]
  if kind=='image':
   name=template.removeprefix('{{json .').removesuffix('}}')
   fields={'Id':worker_id if identity==r['workerImage'] else app_id,'RepoDigests':[identity], 'Os':'linux','Architecture':'amd64','Config.User':'10001:0'}
   if scenario=='image' and identity=='publish-everywhere/postiz-app:custom': fields['Id']='wrong'
   return json.dumps(fields[name])
  isworker=identity=='worker'
  if 'index .Config.Labels' in template:
   if 'project' in template:return 'foreign' if scenario=='foreign' else 'publish-everywhere'
   return 'cooked-editor' if isworker else 'postiz'
  if 'range .Config.Env' in template:
   return '\n'.join(['COOKED_EDITOR_ENABLED=true','COOKED_EDITOR_SOCKET=/run/cooked/cooked.sock','COOKED_EDITOR_ORGANIZATIONS='+r['organizationId']]) if enabled else ''
  mounts=[{'Type':'bind','Source':r['ipcDirectory'],'Destination':'/ipc' if isworker else '/run/cooked','RW':isworker}] if isworker or enabled else []
  fields={'Image':worker_id if isworker else app_id,'State.Running':not(isworker and stopped),'State.Health.Status':'healthy','RestartCount':0,'Mounts':mounts,'Config.User':'10001:0','HostConfig.NetworkMode':'none','HostConfig.ReadonlyRootfs':True,'HostConfig.Memory':536870912,'HostConfig.MemorySwap':536870912,'HostConfig.NanoCpus':1000000000,'HostConfig.PidsLimit':128,'HostConfig.Ulimits':[{'Name':'fsize','Hard':536870912,'Soft':536870912}],'HostConfig.CapDrop':['ALL'],'HostConfig.Privileged':False,'HostConfig.Init':True,'HostConfig.CapAdd':None,'HostConfig.Tmpfs':{'/work':'rw,noexec,nosuid,nodev,size=512m,uid=10001,gid=0,mode=0700','/tmp':'rw,noexec,nosuid,nodev,size=128m'},'HostConfig.LogConfig':{'Type':'json-file','Config':{'max-size':'1m','max-file':'2'}},'HostConfig.SecurityOpt':['no-new-privileges:true']}
  if scenario=='wrongworker':fields['HostConfig.Memory']=1073741824
  name=template.removeprefix('{{json .').removesuffix('}}')
  if name not in fields: raise AssertionError('unallowlisted field')
  return json.dumps(fields[name])
 raise AssertionError('unapproved command '+repr(args))
def run(args,**kwargs):
 global enabled,worker,stopped
 calls.append(list(args))
 assert kwargs['env']['COOKED_PILOT_ORGANIZATIONS']==r['organizationId'] and kwargs['env']['COOKED_IPC_DIR']==r['ipcDirectory'] and kwargs['env']['COOKED_WORKER_IMAGE']==r['workerImage']
 assert not any(k.startswith('COMPOSE_') or k.startswith('COOKED_EDITOR_') for k in kwargs['env'])
 probe=os.open('.',os.O_RDONLY|os.O_DIRECTORY)
 try:
  try: fcntl.flock(probe,fcntl.LOCK_EX|fcntl.LOCK_NB)
  except BlockingIOError: pass
  else: raise AssertionError('mutation without lifetime lock')
 finally: os.close(probe)
 assert args[:2]==['docker','compose'] and '--pull' in args or args[-2:]==['stop','cooked-editor']
 if args[-1]=='cooked-editor' and 'up' in args: worker=True; stopped=False
 if args[-1]=='postiz':
  if scenario=='recreatefail': raise RuntimeError()
  enabled='docker-compose.cooked-candidate.yaml' in args
 if args[-2:]==['stop','cooked-editor']:
  if scenario=='stopfail': raise RuntimeError()
  stopped=True
 return types.SimpleNamespace(returncode=0)
def metadata(p):return types.SimpleNamespace(st_mode=stat.S_IFDIR| (0o755 if scenario=='mode' else 0o710),st_uid=10001,st_gid=0)
try:
 with patch('subprocess.check_output',output),patch('subprocess.run',run),patch('pathlib.Path.stat',metadata),patch('pathlib.Path.is_symlink',lambda p:scenario=='symlink'),patch('pathlib.Path.read_text',lambda p:'MemAvailable: '+('1' if scenario in ('ram','lowresources') else '2097152')+' kB\n'),patch('os.cpu_count',lambda:1 if scenario in ('cpu','lowresources') else 2):
  exec(compile(os.environ['TEST_SOURCE'],'cooked-pilot.sh','exec'))
finally:
 if competitor is not None: os.close(competitor)
 probe=os.open('.',os.O_RDONLY|os.O_DIRECTORY)
 try: fcntl.flock(probe,fcntl.LOCK_EX|fcntl.LOCK_NB); print('LOCK_RELEASED',file=sys.stderr)
 finally: os.close(probe)
 print('TEST_CALLS='+json.dumps(calls),file=sys.stderr)
`;
function check({operation='activate', scenario='normal', mutate, raw, checksum}={}) {
 const r=record(); if(mutate)mutate(r); raw ??= JSON.stringify(r);
 const proc=spawnSync('python3',['-c',harness,operation],{encoding:'utf8',env:{PATH:process.env.PATH,COMPOSE_FILE:'/unapproved/compose.yml',COOKED_EDITOR_ENABLED:'true',TEST_RECORD:JSON.stringify(r),TEST_SCENARIO:scenario,TEST_SOURCE:source,COOKED_ACCEPTANCE_JSON:raw,COOKED_ACCEPTANCE_SHA256:checksum??createHash('sha256').update(raw).digest('hex'),COOKED_APPROVED_SOURCE_SHA:'a'.repeat(40)}});
 assert.match(proc.stderr,/LOCK_RELEASED/,proc.stderr);
 const match=proc.stderr.match(/TEST_CALLS=(.*)/); assert.ok(match,proc.stderr);
 return {...proc,calls:JSON.parse(match[1])};
}
test('valid record validation does not invoke external commands',()=>{const p=check({operation:'validate'});assert.equal(p.status,0,p.stderr);assert.deepEqual(p.calls,[]);assert.match(p.stdout,/RECORD_VALID_ONLY/)});
for(const [name,options] of Object.entries({checksum:{checksum:'0'.repeat(64)},duplicate:{raw:JSON.stringify(record()).replace('"schema":1','"schema":1,"schema":1')},oversize:{raw:' '.repeat(16385)},unknown:{mutate:r=>r.extra=true},wrongworkerrepo:{mutate:r=>r.workerImage=r.appImage},tag:{mutate:r=>r.appImage='ghcr.io/celleree/app:latest'},organizations:{mutate:r=>r.organizationId='one,two'},wildcard:{mutate:r=>r.organizationId='*'},path:{mutate:r=>r.ipcDirectory='/private/../cooked'},fullprofile:{mutate:r=>r.profile='full'},fixture:{mutate:r=>r.fixture.durationSeconds=16},evidence:{mutate:r=>r.resourceEvidence=true}}))test('rejects '+name+' before host calls',()=>{const p=check(options);assert.equal(p.status,1);assert.deepEqual(p.calls,[])});
for(const scenario of ['source','mode','symlink','cpu','ram','image','identity','foreign','wrongworker'])test('admission rejects '+scenario+' without mutation',()=>{const p=check({scenario});assert.equal(p.status,1,p.stderr);assert.ok(!p.calls.some(a=>a[1]==='compose'));assert.match(p.stderr,/REFUSED/)});
test('activate only worker then same app, never build/pull/migrate/provision',()=>{const p=check();assert.equal(p.status,0,p.stderr);const changes=p.calls.filter(a=>a[1]==='compose'&&a.includes('up'));assert.deepEqual(changes.map(a=>a.at(-1)),['cooked-editor','postiz']);assert.ok(changes.every(a=>a.includes('never')&&a.includes('--no-deps')&&a.includes('--no-build')));assert.match(p.stdout,/ENABLED_ACCEPTANCE_PENDING/);assert.doesNotMatch(JSON.stringify(p.calls),/"(pull|build|rm|mkdir|chown|chmod|logs|run)"/)});
test('repeat enabled activation preserves sessions',()=>{const p=check({scenario:'enabled'});assert.equal(p.status,0,p.stderr);assert.ok(!p.calls.some(a=>a[1]==='compose'));assert.match(p.stdout,/ALREADY_ENABLED/)});
test('disable recreates base app before stopping owned worker, preserves files',()=>{const p=check({operation:'disable',scenario:'disable'});assert.equal(p.status,0,p.stderr);const changes=p.calls.filter(a=>a[1]==='compose');assert.equal(changes[0].at(-1),'postiz');assert.ok(!changes[0].includes('docker-compose.cooked-candidate.yaml'));assert.deepEqual(changes[1].slice(-2),['stop','cooked-editor']);assert.match(p.stdout,/DISABLED/)});
for(const scenario of ['recreatefail','proxyfail','stopfail'])test('partial failure '+scenario+' is truthful and never auto-retries',()=>{const p=check({operation:scenario==='stopfail'?'disable':'activate',scenario});assert.equal(p.status,1);assert.match(p.stderr,/FAILED_PARTIAL_STATE_POSSIBLE/);assert.ok(p.calls.filter(a=>a.at(-1)==='postiz'&&a[1]==='compose').length<=1);assert.doesNotMatch(p.stdout,/ENABLED_ACCEPTANCE_PENDING|"result": "DISABLED"/)});
test('Docker inspection always uses projection and no raw environment/logs',()=>{const p=check();for(const a of p.calls){if(a[2]==='inspect')assert.equal(a[3],'--format');assert.ok(!a.includes('logs'));if(a.some(x=>x.includes('.Config.Env')))assert.ok(a.some(x=>x.includes('split . "="')&&x.includes('eq $k "COOKED_EDITOR_ENABLED"')))}});
test('shell syntax and workflow source safeguards',()=>{assert.equal(spawnSync('bash',['-n',path.join(__dirname,'cooked-pilot.sh')]).status,0);const w=fs.readFileSync(path.join(__dirname,'../.github/workflows/cooked-pilot.yml'),'utf8');for(const required of ['workflow_dispatch:','group: production-deployment','cancel-in-progress: false','name: production','StrictHostKeyChecking=yes','TRIGGERING_ACTOR',"p['merge_commit_sha'] == sha",'pull-request-ci.yml','build-postiz-ghcr.yml','bash scripts/cooked-pilot.sh validate'])assert.ok(w.includes(required),required);assert.ok(!w.includes('pull_request:')&&!w.includes('push:'));assert.ok(!w.includes('docker login'));assert.ok(!w.match(/run:.*\$\{\{\s*inputs\./));});
const workflow = fs.readFileSync(path.join(__dirname,'../.github/workflows/cooked-pilot.yml'),'utf8');
const gate = workflow.split("python3 - <<'GATE'\n")[1].split('\n          GATE')[0].split('\n').map(l=>l.replace(/^          /,'')).join('\n');
const gateHarness = String.raw`
import json,os,subprocess
from unittest.mock import patch
s=os.environ['GATE_SCENARIO']; sha='a'*40; head='b'*40; tree='c'*40; calls=[]
p={'merged_at':None if s=='unmerged' else 'date','merge_commit_sha':sha,'base':{'ref':'main','repo':{'full_name':'celleree/everywhereposter'}},'head':{'sha':head,'ref':'chore/pilot','repo':{'full_name':'other/repository' if s=='wrongrepo' else 'celleree/everywhereposter'}}}
def command(args,**kwargs):
 calls.append(args)
 if args[0]=='git':return tree
 path=args[-1]
 if path.endswith('/pulls'):return json.dumps([p])
 if '/git/commits/' in path:return json.dumps({'tree':{'sha':'0'*40 if s=='tree' else tree}})
 if 'pull-request-ci.yml/runs' in path:
  manual='event=workflow_dispatch' in path
  if manual and s!='manual':return json.dumps({'workflow_runs':[]})
  if not manual and s=='manual':return json.dumps({'workflow_runs':[]})
  return json.dumps({'workflow_runs':[{'head_sha':('0'*40 if s=='runhead' else sha if manual else head),'head_branch':'main' if manual else 'chore/pilot','event':'workflow_dispatch' if manual else 'pull_request','status':'completed','conclusion':'failure' if s=='conclusion' else 'success'}]})
 raise AssertionError('unexpected gate command')
with patch('subprocess.check_output',command):exec(os.environ['GATE_SOURCE'])
`;
for(const scenario of ['normal','manual','wrongrepo','unmerged','tree','runhead','conclusion'])test('source provenance fixture '+scenario,()=>{const p=spawnSync('python3',['-c',gateHarness],{encoding:'utf8',env:{PATH:process.env.PATH,GATE_SCENARIO:scenario,GATE_SOURCE:gate,GITHUB_REPOSITORY:'celleree/everywhereposter',SOURCE_SHA:'a'.repeat(40)}});assert.equal(p.status,['normal','manual'].includes(scenario)?0:1,p.stderr);if(p.status===0)assert.match(p.stdout,/ciHeadSHA/)});
test('later activation restarts preserved stopped worker without recreation',()=>{const p=check({scenario:'stopped'});assert.equal(p.status,0,p.stderr);const start=p.calls.find(a=>a[1]==='compose'&&a.at(-1)==='cooked-editor'&&a.includes('up'));assert.ok(start.includes('--no-recreate'));assert.match(p.stdout,/ENABLED_ACCEPTANCE_PENDING/)});
test('live orphan worker is refused before mutation',()=>{const p=check({scenario:'orphan'});assert.equal(p.status,1);assert.ok(!p.calls.some(a=>a[1]==='compose'));assert.match(p.stderr,/REFUSED/)});

test('contending direct invocation refuses before host admission and releases fd',()=>{const p=check({scenario:'contention'});assert.equal(p.status,1,p.stderr);assert.deepEqual(p.calls,[]);assert.match(p.stderr,/REFUSED/)});
test('explicit disable succeeds with one CPU and low available RAM',()=>{const p=check({operation:'disable',scenario:'lowresources'});assert.equal(p.status,0,p.stderr);assert.match(p.stdout,/DISABLED/);assert.deepEqual(p.calls.filter(a=>a[1]==='compose').map(a=>a.at(-1)),['postiz','cooked-editor'])});
