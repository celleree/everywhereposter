"""Trusted host launcher only. Docker socket/config is never mounted into jobs."""
import io,json,os,re,subprocess,tarfile,time,uuid,threading
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
        if source not in ('/job/download.bin','/job/asset.mp4'): raise ValueError('invalid_output_path')
        # The job directory is tmpfs: docker cp cannot export it. Stream a
        # single regular file from the unprivileged container instead.
        producer="""import os,stat,sys,tarfile
path=sys.argv[1]
fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
with os.fdopen(fd,'rb') as f:
 st=os.fstat(f.fileno())
 if not stat.S_ISREG(st.st_mode): raise ValueError('not_regular')
 info=tarfile.TarInfo(os.path.basename(path)); info.size=st.st_size
 with tarfile.open(fileobj=sys.stdout.buffer,mode='w|') as archive: archive.addfile(info,f)
"""
        p=subprocess.Popen(['docker','exec',name,'python','-c',producer,source],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
        # Drain stderr to avoid blocking the producer, retaining only its presence.
        # Never expose container diagnostics, which may contain sensitive values.
        stderr_seen=[]
        def drain():
            while True:
                block=p.stderr.read(4096)
                if not block: break
                if not stderr_seen: stderr_seen.append(True)
        reader=threading.Thread(target=drain,daemon=True);reader.start()
        watchdog=threading.Timer(20,p.kill);watchdog.daemon=True;watchdog.start()
        try:
            try:
                with tarfile.open(fileobj=p.stdout,mode='r|') as archive:
                    members=iter(archive);member=next(members)
                    if member.name!=os.path.basename(source) or not member.isfile() or member.size<=0 or member.size>limit: raise ValueError('unsafe_or_oversize_output')
                    stream=archive.extractfile(member)
                    with open(target,'xb') as out:
                        remaining=member.size
                        while remaining:
                            block=stream.read(min(65536,remaining))
                            if not block: raise ValueError('truncated_output')
                            out.write(block);remaining-=len(block)
                    if next(members,None) is not None: raise ValueError('unexpected_output')
            except (tarfile.TarError,StopIteration) as exc:
                raise ValueError('invalid_or_truncated_output_stream') from exc
            if p.wait(timeout=10): raise ValueError('copy_failed')
        except ValueError as exc:
            if p.poll() is None: p.kill()
            p.wait();reader.join()
            # Report only a fixed classification, never raw stderr.
            if stderr_seen: raise ValueError(str(exc)+': producer_stderr_present') from exc
            raise
        finally:
            watchdog.cancel()
            if p.poll() is None: p.kill();p.wait()
            reader.join();p.stdout.close();p.stderr.close()
    def acquire(self,request,policy,job):
        self.call(['volume','create',self.volume]);self.created=True
        gateway=self.spawn('proxy',self.image,['--network','bridge','--mount',f'type=volume,src={self.volume},dst=/ipc'])
        self.call(['exec','-d',gateway,'python','runtime/guarded_proxy.py',json.dumps(policy)])
        self.call(['exec',gateway,'python','-c',"import time,os; deadline=time.monotonic()+5\nwhile not os.path.exists('/ipc/proxy.sock'):\n assert time.monotonic()<deadline; time.sleep(.05)"])
        worker=self.spawn('download',self.image,['--network','none','--mount',f'type=volume,src={self.volume},dst=/ipc,readonly'])
        spec=json.dumps({'request':request,'policy':policy}).encode()
        meta=json.loads(self.call(['exec','-i',worker,'python','runtime/worker.py'],input=spec,timeout=policy['acquisitionSeconds']+5))
        self.copy(worker,'/job/download.bin',job/'download.bin',policy['trafficBytes'])
        offline=self.spawn('offline',self.offline,['--network','none','--mount',f'type=bind,src={Path(__file__).resolve().parent.parent},dst=/adapter,readonly'])
        # Host job remains mode0700. Transfer bounded bytes into UID10001's own
        # tmpfs, rather than making a private host directory world-readable.
        with open(job/'download.bin','rb') as source:
            self.call(['exec','-i',offline,'python','-c',"import sys,shutil; f=open('/job/download.bin','xb'); shutil.copyfileobj(sys.stdin.buffer,f,65536); f.close()"],stdin=source,timeout=30)
        facts=json.loads(self.call(['exec','-i',offline,'python','/adapter/validate_media.py'],input=spec,timeout=policy['normalizeSeconds']+5))
        if facts.get('fullDecode')!='PASS': raise ValueError('invalid_media')
        self.copy(offline,'/job/asset.mp4',job/'asset.mp4',policy['assetBytes'])
        return meta,facts
    def close(self):
        failed=[]
        for name in reversed(self.names):
            try: self.call(['rm','-f',name])
            except (OSError,subprocess.SubprocessError): failed.append(name)
        if self.created:
            try: self.call(['volume','rm',self.volume])
            except (OSError,subprocess.SubprocessError): failed.append(self.volume)
        if failed: raise ValueError('owned_runtime_cleanup_failed: '+','.join(failed))
    def __enter__(self): return self
    def __exit__(self,*args): self.close()
