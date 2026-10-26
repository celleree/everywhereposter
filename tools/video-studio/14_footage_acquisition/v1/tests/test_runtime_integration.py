"""Opt-in Linux boundary smoke; absence is a SKIP, never readiness evidence."""
import os,subprocess,sys,tempfile,unittest
from pathlib import Path
from unittest import mock
from runtime.launch import Runtime,pinned

@unittest.skipUnless(os.environ.get('FOOTAGE_TEST_IMAGE'),'Requires reviewed digest-pinned image and Linux Docker')
class Tests(unittest.TestCase):
    def test_direct_child_network_has_no_route(self):
        image=pinned(os.environ['FOOTAGE_TEST_IMAGE'])
        # TEST-NET destination: no private-network service is contacted.
        code="import socket; s=socket.socket(); s.settimeout(1)\ntry: s.connect(('192.0.2.1',443))\nexcept OSError: print('NO_ROUTE')\nelse: raise SystemExit('unexpected route')"
        r=subprocess.run(['docker','run','--rm','--network','none','--cap-drop','ALL','--security-opt','no-new-privileges:true',image,'python','-c',code],check=True,capture_output=True,timeout=20)
        self.assertIn(b'NO_ROUTE',r.stdout)

    def test_copy_from_real_container_tmpfs(self):
        image=pinned(os.environ['FOOTAGE_TEST_IMAGE'])
        runtime=Runtime({'downloaderImage':image,'offlineImage':image})
        with tempfile.TemporaryDirectory() as directory, runtime:
            name=runtime.spawn('transport',image,['--network','none'])
            runtime.call(['exec',name,'python','-c',"open('/job/download.bin','wb').write(b'tmpfs transport')"])
            target=Path(directory)/'download.bin'
            runtime.copy(name,'/job/download.bin',target,100)
            self.assertEqual(target.read_bytes(),b'tmpfs transport')

class SyntheticTransportTests(unittest.TestCase):
    def test_copy_reads_single_member_from_exec_stream(self):
        # Synthetic local tar stream: this does not exercise Linux Docker/tmpfs.
        code="import sys,tarfile,io; t=tarfile.open(fileobj=sys.stdout.buffer,mode='w|'); i=tarfile.TarInfo('download.bin'); i.size=4; t.addfile(i,io.BytesIO(b'data')); t.close()"
        original=subprocess.Popen
        with tempfile.TemporaryDirectory() as directory:
            target=Path(directory)/'download.bin'
            with mock.patch('runtime.launch.subprocess.Popen',side_effect=lambda *a,**kw: original([sys.executable,'-c',code],**kw)) as spawn:
                Runtime.copy(None,'container','/job/download.bin',target,10)
            self.assertEqual(target.read_bytes(),b'data')
            self.assertEqual(spawn.call_args.args[0][:3],['docker','exec','container'])

    def test_failed_stream_does_not_expose_stderr(self):
        code="import sys; sys.stderr.write('secret-url'); sys.exit(1)"
        original=subprocess.Popen
        with tempfile.TemporaryDirectory() as directory:
            with mock.patch('runtime.launch.subprocess.Popen',side_effect=lambda *a,**kw: original([sys.executable,'-c',code],**kw)):
                with self.assertRaisesRegex(ValueError,'producer_stderr_present') as error:
                    Runtime.copy(None,'container','/job/download.bin',Path(directory)/'out',10)
            self.assertNotIn('secret-url',str(error.exception))
