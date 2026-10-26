import contextlib, hashlib, json, os, time
from pathlib import Path

def sha(file):
    with open(file,'rb') as f: return hashlib.file_digest(f,'sha256').hexdigest()

@contextlib.contextmanager
def owner(root,timeout=10):
    """One local owner. No stale lease takeover or distributed-lock claims."""
    root=Path(root);root.mkdir(parents=True,exist_ok=True)
    lock=root/'owner.lock'
    deadline=time.monotonic()+timeout
    while True:
        try: fd=os.open(lock,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600);break
        except FileExistsError:
            if time.monotonic()>=deadline: raise ValueError('acquisition_owner_busy_or_stale')
            time.sleep(.05)
    try:
        os.write(fd,str(os.getpid()).encode());yield root
    finally:
        os.close(fd);lock.unlink()

def ready(root,key):
    folder=Path(root)/key
    try:
        receipt=json.loads((folder/'receipt.json').read_text())
        file=folder/'asset.mp4'
        if folder.is_symlink() or file.is_symlink() or receipt['status']!='ready' or receipt['cacheKey']!=key or sha(file)!=receipt['sha256']: return None
        return receipt|{'path':str(file.resolve())}
    except (OSError,ValueError,KeyError): return None
