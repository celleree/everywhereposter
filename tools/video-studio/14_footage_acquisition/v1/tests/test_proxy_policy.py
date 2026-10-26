import socket,unittest,tempfile,json,subprocess
from pathlib import Path
from unittest.mock import patch
from contract import LIMITS,public_ipv4
from runtime.guarded_proxy import Budget,destination
from runtime.launch import Runtime,pinned
from runtime.worker import arguments,completed_download,check_metadata

def answers(*ips): return [(socket.AF_INET,socket.SOCK_STREAM,6,'',(ip,443)) for ip in ips]

class Tests(unittest.TestCase):
    def test_offline_input_streamed_into_private_tmpfs_without_host_job_mount(self):
        rt=Runtime({'downloaderImage':'x@sha256:'+'a'*64,'offlineImage':'y@sha256:'+'b'*64});calls=[];staged=[]
        def call(args,**kwargs):
            calls.append(args)
            if 'stdin' in kwargs:staged.append(kwargs['stdin'].read())
            if 'runtime/worker.py' in args:return b'{"status":"downloaded"}'
            if '/adapter/validate_media.py' in args:return b'{"fullDecode":"PASS"}'
            return b''
        rt.call=call;rt.copy=lambda name,source,target,limit:target.write_bytes(b'generated')
        with tempfile.TemporaryDirectory() as root:
            job=Path(root);rt.acquire({},LIMITS,job)
            self.assertEqual(staged,[b'generated'])
            self.assertFalse(any('src='+str(job.resolve()) in arg for cmd in calls for arg in cmd))
            self.assertTrue(any('/job/download.bin' in arg for cmd in calls for arg in cmd))
    def test_cleanup_failure_is_visible_not_a_ready_result(self):
        rt=Runtime({'downloaderImage':'x@sha256:'+'a'*64,'offlineImage':'y@sha256:'+'b'*64});rt.names=['owned-test'];rt.created=True
        def fail(*args,**kwargs):raise subprocess.TimeoutExpired('docker',20)
        rt.call=fail
        with self.assertRaisesRegex(ValueError,'owned_runtime_cleanup_failed'):rt.close()
    def test_missing_direct_media_duration_is_deferred_but_known_limits_still_fail(self):
        request={'interval':[1,3]};policy=LIMITS
        self.assertIsNone(check_metadata({'id':'direct-mp4'},request,policy))
        for meta in [{'duration':601},{'is_live':True},{'_type':'playlist'},{'duration':float('nan')},{'duration':2}]:
            with self.assertRaises(ValueError):check_metadata(meta,request,policy)
    def test_max_downloads_success_code_still_requires_regular_bounded_bytes(self):
        with tempfile.TemporaryDirectory() as root:
            file=Path(root)/'download.bin';file.write_bytes(b'fixture')
            completed_download(101,file,10);completed_download(0,file,10)
            for code,limit in [(1,10),(101,2)]:
                with self.assertRaises(ValueError):completed_download(code,file,limit)
            file.unlink()
            with self.assertRaises(ValueError):completed_download(101,file,10)
    def test_dns_answers_are_all_checked_then_numeric_dial_target_returned(self):
        calls=[]
        def resolver(*args):calls.append(args);return answers('93.184.216.34')
        self.assertEqual(destination('media.example.com:443',['media.example.com'],resolver),'93.184.216.34');self.assertEqual(len(calls),1)
        for ips in [('127.0.0.1',),('169.254.169.254',),('93.184.216.34','10.0.0.1'),('224.0.0.1',),('192.0.2.1',)]:
            with self.assertRaises(ValueError):destination('media.example.com:443',['media.example.com'],lambda *a:answers(*ips))
    def test_redirect_new_host_ip_literal_ipv6_and_wrong_port_denied(self):
        for value in ['evil.example:443','media.example.com:80','[::1]:443','127.0.0.1:443','media.example.com:443:443']:
            with self.assertRaises(ValueError):destination(value,['media.example.com'],lambda *a:answers('93.184.216.34'))
        self.assertFalse(public_ipv4('::ffff:93.184.216.34'))
    def test_traffic_connection_and_deadline_limits(self):
        p=LIMITS|{'hosts':['media.example.com'],'trafficBytes':4,'connections':1}
        b=Budget(p);b.check(4,new=True)
        with self.assertRaises(ValueError):b.check(1)
        with self.assertRaises(ValueError):Budget(p).check(new=True) or b.check(new=True)
        b=Budget(p);b.start-=121
        with self.assertRaises(ValueError):b.check()
    def test_fixed_downloader_flags_and_pinned_runtime(self):
        url='https://media.example.com/a?x=$(touch)';args=arguments(url)
        self.assertEqual(args[-2:],['--',url])
        for flag in ['--ignore-config','--no-plugin-dirs','--no-remote-components','--no-js-runtimes']:self.assertIn(flag,args)
        for image in ['python:latest','image@sha256:bad']:
            with self.assertRaises(ValueError):pinned(image)
        with self.assertRaises(ValueError):Runtime({'downloaderImage':'x@sha256:'+'a'*64,'offlineImage':'x@sha256:'+'b'*64,'env':{'secret':'x'}})
    def test_container_commands_keep_downloader_offline_without_broad_mounts(self):
        rt=Runtime({'downloaderImage':'x@sha256:'+'a'*64,'offlineImage':'y@sha256:'+'b'*64});captured=[]
        rt.call=lambda args,**kwargs:captured.append(args) or b''
        rt.spawn('download',rt.image,['--network','none','--mount',f'type=volume,src={rt.volume},dst=/ipc,readonly'])
        args=captured[0];self.assertEqual(args[args.index('--network')+1],'none')
        self.assertIn('--read-only',args);self.assertNotIn('host',args);self.assertNotIn('/var/run/docker.sock',' '.join(args))
