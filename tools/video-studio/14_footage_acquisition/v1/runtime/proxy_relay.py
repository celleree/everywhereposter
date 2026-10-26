"""Fixed loopback TCP -> pathname Unix socket; no destination resolution here."""
import socket, socketserver, threading

def pump(source,target):
    try:
        while data:=source.recv(65536): target.sendall(data)
    except OSError: pass
    finally:
        try: target.shutdown(socket.SHUT_WR)
        except OSError: pass

class Relay(socketserver.BaseRequestHandler):
    def handle(self):
        with socket.socket(socket.AF_UNIX,socket.SOCK_STREAM) as upstream:
            upstream.settimeout(15);upstream.connect('/ipc/proxy.sock')
            thread=threading.Thread(target=pump,args=(self.request,upstream),daemon=True);thread.start()
            pump(upstream,self.request);thread.join(timeout=1)

class Server(socketserver.ThreadingTCPServer):
    daemon_threads=True
    allow_reuse_address=True

def start():
    server=Server(('127.0.0.1',18080),Relay)
    threading.Thread(target=server.serve_forever,daemon=True).start()
    return server
