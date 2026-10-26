"""One local acquisition owner; immutable ready receipts, no app/storage service."""
import argparse, json, os, shutil, signal, tempfile, time
from pathlib import Path
from urllib.parse import urlsplit,urlunsplit
from cache import owner, ready, sha
from contract import checked_policy, digest, validate
from runtime.launch import Runtime

def acquire(request,policy,config,root,runtime_factory=Runtime):
    policy=checked_policy(policy);key=validate(request,policy);root=Path(root).resolve()
    with owner(root,timeout=policy['acquisitionSeconds']+policy['normalizeSeconds']+20):
        hit=ready(root,key)
        if hit: return hit
        if (root/key).exists(): raise ValueError('corrupt_cache_requires_owner_review')
        job=Path(tempfile.mkdtemp(prefix='job-',dir=root))
        try:
            with runtime_factory(config) as runtime: meta,facts=runtime.acquire(request,policy,job)
            if facts.get('fullDecode')!='PASS' or facts.get('sha256')!=sha(job/'asset.mp4'): raise ValueError('invalid_media')
            if (job/'asset.mp4').stat().st_size>policy['assetBytes']: raise ValueError('over_budget')
            if facts.get('acquiredSha256')!=sha(job/'download.bin'): raise ValueError('invalid_media')
            u=urlsplit(request['url']);source_url=urlunsplit((u.scheme,u.netloc,u.path,'',''))
            receipt={'schemaVersion':1,'status':'ready','cacheKey':key,'assetId':'acquired-'+key[:24],
                     'sha256':facts['sha256'],'facts':facts,'source':{'urlWithoutQuery':source_url,'urlDigest':digest(request['url']),**meta},
                     'rights':request['rights'],'rightsDigest':digest(request['rights']),'context':request['context'],
                     'use':request['use'],'contentReview':'PENDING','policy':policy,'runtime':config,
                     'toolsLockSha256':sha(Path(__file__).parent/'runtime/tools.lock.json'),'retrievedAt':int(time.time())}
            # No unverified partial may be published; retained cache is derived coverage only.
            (job/'download.bin').unlink()
            (job/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
            os.rename(job,root/key)
            return ready(root,key)
        finally:
            if job.exists(): shutil.rmtree(job)

def main():
    p=argparse.ArgumentParser();p.add_argument('--request',required=True);p.add_argument('--policy',required=True);p.add_argument('--runtime',required=True);p.add_argument('--cache',required=True);a=p.parse_args()
    result=acquire(json.loads(Path(a.request).read_text()),json.loads(Path(a.policy).read_text()),json.loads(Path(a.runtime).read_text()),a.cache)
    print(json.dumps(result))
class Terminated(Exception):
    pass

def cli():
    previous=signal.getsignal(signal.SIGTERM)
    def terminate(signum,frame):
        # Let the first signal unwind all owned cleanup without interruption.
        signal.signal(signal.SIGTERM,signal.SIG_IGN)
        raise Terminated()
    signal.signal(signal.SIGTERM,terminate)
    try:
        try: main()
        except Exception as error:
            # Never echo URLs, source descriptions or subprocess arguments on failures.
            print(json.dumps({'status':'failed','reason':str(error) if isinstance(error,ValueError) else type(error).__name__}));raise SystemExit(1)
    finally:
        signal.signal(signal.SIGTERM,previous)
if __name__=='__main__': cli()
