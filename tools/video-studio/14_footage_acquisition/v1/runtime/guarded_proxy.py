"""CONNECT-only gateway. Pinned IPv4 dialing; no TLS interception."""
import json, os, select, socket, socketserver, sys, threading, time
sys.path.insert(0,os.path.dirname(os.path.dirname(__file__)))
from contract import hostname, public_ipv4, checked_policy

def destination(authority,hosts,resolver=socket.getaddrinfo):
    if authority.count(':')!=1: raise ValueError('blocked_destination')
    host,port=authority.split(':')
    if port!='443' or hostname(host) not in hosts: raise ValueError('blocked_destination')
    answers=resolver(host,443,socket.AF_INET,socket.SOCK_STREAM)
    ips={a[4][0] for a in answers}
    if not ips or any(not public_ipv4(ip) for ip in ips): raise ValueError('blocked_destination')
    return sorted(ips)[0]

class Budget:
    def __init__(self,policy): self.policy=policy;self.bytes=0;self.connections=0;self.start=time.monotonic();self.lock=threading.Lock()
    def check(self,size=0,new=False):
        with self.lock:
            self.bytes+=size;self.connections+=int(new)
            if self.bytes>self.policy['trafficBytes'] or self.connections>self.policy['connections'] or time.monotonic()-self.start>self.policy['acquisitionSeconds']: raise ValueError('over_budget')

class Gateway(socketserver.StreamRequestHandler):
    def handle(self):
        self.connection.settimeout(15)
        try:
            self.server.budget.check(new=True)
            line=self.rfile.readline(4097)
            if len(line)>4096: raise ValueError('headers_too_large')
            method,authority,version=line.decode('ascii').strip().split(' ')
            if method!='CONNECT' or version not in ['HTTP/1.0','HTTP/1.1']: raise ValueError('blocked_method')
            size=len(line)
            while True:
                header=self.rfile.readline(4097);size+=len(header)
                if size>8192 or not header: raise ValueError('headers_too_large')
                if header==b'\r\n': break
            ip=destination(authority,self.server.policy['hosts'])
            # Numeric address only: no DNS lookup between validation and connect.
            with socket.socket(socket.AF_INET,socket.SOCK_STREAM) as upstream:
                upstream.settimeout(15);upstream.connect((ip,443))
                self.wfile.write(b'HTTP/1.1 200 Connection Established\r\n\r\n');self.wfile.flush()
                while True:
                    self.server.budget.check()
                    readable,_,_=select.select([self.connection,upstream],[],[],1)
                    for src in readable:
                        data=src.recv(65536)
                        if not data: return
                        self.server.budget.check(len(data));(upstream if src is self.connection else self.connection).sendall(data)
        except (OSError,ValueError,UnicodeError):
            try: self.wfile.write(b'HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');self.wfile.flush()
            except OSError: pass

class Server(getattr(socketserver,'ThreadingUnixStreamServer',socketserver.ThreadingTCPServer)): daemon_threads=True

if __name__=='__main__':
    if not hasattr(socketserver,'ThreadingUnixStreamServer'): raise SystemExit('Linux Unix-socket runtime required')
    policy=checked_policy(json.loads(sys.argv[1]));socket_path='/ipc/proxy.sock'
    with Server(socket_path,Gateway) as server:
        os.chmod(socket_path,0o600);server.policy=policy;server.budget=Budget(policy);server.serve_forever()
