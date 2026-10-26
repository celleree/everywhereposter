"""Opt-in Linux boundary smoke; absence is a SKIP, never readiness evidence."""
import os,subprocess,unittest
from runtime.launch import Runtime,pinned

@unittest.skipUnless(os.environ.get('FOOTAGE_TEST_IMAGE'),'Requires reviewed digest-pinned image and Linux Docker')
class Tests(unittest.TestCase):
    def test_direct_child_network_has_no_route(self):
        image=pinned(os.environ['FOOTAGE_TEST_IMAGE'])
        # TEST-NET destination: no private-network service is contacted.
        code="import socket; s=socket.socket(); s.settimeout(1)\ntry: s.connect(('192.0.2.1',443))\nexcept OSError: print('NO_ROUTE')\nelse: raise SystemExit('unexpected route')"
        r=subprocess.run(['docker','run','--rm','--network','none','--cap-drop','ALL','--security-opt','no-new-privileges:true',image,'python','-c',code],check=True,capture_output=True,timeout=20)
        self.assertIn(b'NO_ROUTE',r.stdout)
