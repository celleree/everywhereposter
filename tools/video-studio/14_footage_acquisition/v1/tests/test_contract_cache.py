import copy,json,tempfile,threading,time,unittest
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from acquire import acquire
from cache import sha
from contract import LIMITS,checked_policy,validate

def fixture():
    p=LIMITS|{'hosts':['media.example.com']}
    r={'schemaVersion':1,'requestId':'req','projectId':'project','revision':1,'authorizationScope':'owner1',
       'url':'https://media.example.com/owned.mp4','interval':[1,3],'outputFrom':30,'anchorWord':'w0',
       'context':'Illustrate the narrated work','use':'illustrative',
       'rights':{'status':'approved','scope':'owner1','basis':'owned','evidence':'Owned generated fixture','attribution':'Owner'}}
    return r,p

class FakeRuntime:
    count=0
    def __init__(self,config): pass
    def __enter__(self):return self
    def __exit__(self,*args):pass
    def acquire(self,r,p,job):
        type(self).count+=1;time.sleep(.1)
        (job/'download.bin').write_bytes(b'generated original');(job/'asset.mp4').write_bytes(b'generated test derivative')
        return {'status':'downloaded','sourceId':'generated'}, {'sha256':sha(job/'asset.mp4'),'acquiredSha256':sha(job/'download.bin'),'duration':2,'fps':30,'width':720,'height':1280,'fullDecode':'PASS'}

class Tests(unittest.TestCase):
    def test_context_independent_identity_and_concurrent_cache(self):
        r,p=fixture();FakeRuntime.count=0
        with tempfile.TemporaryDirectory() as root:
            with ThreadPoolExecutor(2) as pool: results=list(pool.map(lambda _:acquire(r,p,{},root,FakeRuntime),[1,2]))
            self.assertEqual(FakeRuntime.count,1);self.assertEqual(results[0]['sha256'],results[1]['sha256'])
            other=copy.deepcopy(r);other['context']='Another appropriate context';self.assertEqual(validate(r,p),validate(other,p))
    def test_rights_and_scope(self):
        r,p=fixture()
        for change in [lambda x:x['rights'].update(status='pending'),lambda x:x['rights'].update(scope='someone-else')]:
            q=copy.deepcopy(r);change(q)
            with self.assertRaisesRegex(ValueError,'rights_missing'):validate(q,p)
        q=copy.deepcopy(r);q['rights']['evidence']='Revised permission';self.assertNotEqual(validate(q,p),validate(r,p))
    def test_unsafe_urls_options_and_intervals(self):
        r,p=fixture()
        for url in ['http://media.example.com/x','https://user:pass@media.example.com/a','https://127.0.0.1/a','https://media.example.com:444/a','file:///etc/passwd','--exec touch file','https://media.example.com\\@evil.test/a']:
            with self.assertRaises(ValueError):validate(r|{'url':url},p)
        for interval in [[-1,2],[3,2],[0,31],[0,float('nan')]]:
            with self.assertRaises(ValueError):validate(r|{'interval':interval},p)
        with self.assertRaises(ValueError):validate(r|{'headers':{'Authorization':'secret'}},p)
    def test_corrupt_cache_no_reuse_and_failure_cleanup(self):
        r,p=fixture()
        with tempfile.TemporaryDirectory() as root:
            record=acquire(r,p,{},root,FakeRuntime);Path(record['path']).write_bytes(b'corrupt')
            with self.assertRaisesRegex(ValueError,'corrupt_cache'):acquire(r,p,{},root,FakeRuntime)
        class Bad(FakeRuntime):
            def acquire(self,r,p,job):
                (job/'partial').write_bytes(b'x');raise TimeoutError()
        with tempfile.TemporaryDirectory() as root:
            with self.assertRaises(TimeoutError):acquire(r,p,{},root,Bad)
            self.assertEqual(list(Path(root).iterdir()),[])
    def test_policy_boundaries(self):
        _,p=fixture();checked_policy(p)
        for patch in [{'trafficBytes':0},{'acquisitionSeconds':9999},{'hosts':['127.0.0.1']},{'coverageSeconds':601}]:
            with self.assertRaises(ValueError):checked_policy(p|patch)
