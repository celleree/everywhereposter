"""Trusted host launcher only. Docker socket/config is never mounted into jobs."""
import io,json,os,re,subprocess,tarfile,time,uuid
from pathlib import Path

def pinned(image):
    if not isinstance(image,str) or not re.fullmatch(r'[a-zA-Z0-9./_:-]+@sha256:[a-f0-9]{64}',image): raise ValueError('digest_pinned_image_required')
    return image

class Runtime:
    def __init__(self,config):
        if set(config)!={'downloaderImage','offlineImage'}: raise ValueError('invalid_runtime_configuration')
        self.image=pinned(config['downloaderImage']);self.offline=pinned(config['offlineImage']);self.names=[];self.volume='footage-'+uuid.uuid4().hex;self.created=False
    def call(self,args,**kwargs):
        return subprocess.run(['docker',*args],check=True,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=kwargs.pop('timeout',20),**kwargs).stdout
    def common(self,name):
        return ['--name',name,'--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true','--user','10001:10001','--memory','768m','--memory-swap','768m','--cpus','1','--pids-limit','64','--log-driver','none','--tmpfs','/tmp:rw,noexec,nosuid,size=16m','--tmpfs','/job:rw,nosuid,size=512m,uid=10001,gid=10001,mode=0700']
    def spawn(self,role,image,args):
        name=self.volume+'-'+role;self.names.append(name)
        self.call(['run','-d',*self.common(name),*args,image,'python','-c','import time; time.sleep(360)'])
        return name
    def copy(self,name,source,target,limit):
        # Stream only the requested regular tar member; never extract remote paths.
        p=subprocess.Popen(['docker','cp',name+':'+source,'-'],stdout=subprocess.PIPE,stderr=subprocess.DEVNULL)
        try:
            with tarfile.open(fileobj=p.stdout,mode='r|') as archive:
                members=iter(archive);member=next(members)
                if not member.isfile() or member.size<=0 or member.size>limit: raise ValueError('unsafe_or_oversize_output')
                stream=archive.extractfile(member)
                with open(target,'xb') as out:
                    remaining=member.size
                    while remaining:
                        block=stream.read(min(65536,remaining))
                        if not block: raise ValueError('truncated_output')
                        out.write(block);remaining-=len(block)
                if next(members,None) is not None: raise ValueError('unexpected_output')
            if p.wait(timeout=10): raise ValueError('copy_failed')
        finally:
            if p.poll() is None: p.kill();p.wait()
    def acquire(self,request,policy,job):
        self.call(['volume','create',self.volume]);self.created=True
        gateway=self.spawn('proxy',self.image,['--network','bridge','--mount',f'type=volume,src={self.volume},dst=/ipc'])
        self.call(['exec','-d',gateway,'python','runtime/guarded_proxy.py',json.dumps(policy)])
        self.call(['exec',gateway,'python','-c',"import time,os; deadline=time.monotonic()+5\nwhile not os.path.exists('/ipc/proxy.sock'):\n assert time.monotonic()<deadline; time.sleep(.05)"])
        worker=self.spawn('download',self.image,['--network','none','--mount',f'type=volume,src={self.volume},dst=/ipc,readonly'])
        spec=json.dumps({'request':request,'policy':policy}).encode()
        meta=json.loads(self.call(['exec','-i',worker,'python','runtime/worker.py'],input=spec,timeout=policy['acquisitionSeconds']+5))
        self.copy(worker,'/job/download.bin',job/'download.bin',policy['trafficBytes'])
        offline=self.spawn('offline',self.offline,['--network','none','--mount',f'type=bind,src={job.resolve()},dst=/input,readonly','--mount',f'type=bind,src={Path(__file__).resolve().parent.parent},dst=/adapter,readonly'])
        facts=json.loads(self.call(['exec','-i',offline,'python','/adapter/validate_media.py'],input=spec,timeout=policy['normalizeSeconds']+5))
        if facts.get('fullDecode')!='PASS': raise ValueError('invalid_media')
        self.copy(offline,'/job/asset.mp4',job/'asset.mp4',policy['assetBytes'])
        return meta,facts
    def close(self):
        for name in reversed(self.names):
            try: self.call(['rm','-f',name])
            except (OSError,subprocess.SubprocessError): pass
        if self.created:
            try: self.call(['volume','rm',self.volume])
            except (OSError,subprocess.SubprocessError): pass
    def __enter__(self): return self
    def __exit__(self,*args): self.close()
