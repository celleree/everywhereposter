import copy,tempfile,unittest
from acquire import acquire
from compose_manifest import compose
from tests.test_contract_cache import fixture,FakeRuntime

class Tests(unittest.TestCase):
    def test_new_manifest_keeps_voice_inputs_and_registers_verified_asset(self):
        r,p=fixture();m={'project':{'id':'project','revision':1,'canvas':{'fps':30},'words':[{'id':'w0','start':1}],
            'cuts':[{'in':0,'out':180}],'assets':[],'broll':[]},'inputs':{'audio':{'sha256':'unchanged'},'font':{'sha256':'font'},'assets':[]},'provenance':{}}
        before=copy.deepcopy(m)
        with tempfile.TemporaryDirectory() as root:
            asset=acquire(r,p,{},root,FakeRuntime);result=compose(m,r,p,root)
            self.assertEqual(m,before);self.assertEqual(result['inputs']['audio'],before['inputs']['audio'])
            self.assertEqual(result['project']['revision'],2);self.assertEqual(result['inputs']['assets'][0]['sha256'],asset['sha256'])
            self.assertEqual(result['project']['broll'][0]['frames'],60)
            with self.assertRaisesRegex(ValueError,'content_review'):compose(m,r|{'use':'evidence'},p,root)
            with self.assertRaises(ValueError):compose(m,r|{'outputFrom':150},p,root)
