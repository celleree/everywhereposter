"""Loopback TLS gate with a pinned private route to the held application."""

from functools import partial
import http.client
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from ipaddress import IPv4Address, IPv4Network
import json
import re
import ssl
import threading
from urllib.parse import urlsplit


def select_route(method, target):
    if len(target) > 2048 or not target.startswith('/') or target.startswith('//'):
        return None
    path = urlsplit(target).path
    if any(part in {'..', '.'} for part in path.split('/')) or not re.fullmatch(r'/[A-Za-z0-9_./-]*', path):
        return None
    if method == 'POST' and path == '/api/auth/login' and target == path:
        return 3000, '/auth/login'
    if method not in {'GET', 'HEAD'}:
        return None
    if path in {'/api/user/self', '/api/auth/can-register'} and target == path:
        return 3000, path[4:]
    if path in {'/', '/auth', '/auth/login', '/favicon.ico', '/manifest.webmanifest'} or path.startswith(('/_next/static/', '/branding/')):
        return 4200, target
    return None


def exchange(ip, port, method, path, body=None, headers=None, *, source_address):
    connection = http.client.HTTPConnection(ip, port, timeout=8, source_address=source_address)
    try:
        connection.request(method, path, body=body, headers=headers or {})
        response = connection.getresponse()
        data = response.read(8 * 1024 * 1024 + 1)
        if len(data) > 8 * 1024 * 1024:
            raise OSError('Fixture response exceeds bound')
        return response.status, response.getheaders(), data
    finally:
        connection.close()


class Gate(ThreadingHTTPServer):
    def __init__(self, hostname, tls, proxy_ip, private_network):
        self.proxy_ip = IPv4Address(proxy_ip)
        self.private_network = IPv4Network(private_network)
        if (not self.private_network.is_private or self.private_network.is_loopback
                or not self.bridge_host(self.proxy_ip)):
            raise ValueError('Proxy source must belong to the private application bridge')
        self.condition = threading.Condition()
        self.inflight = 0
        self.target = None
        self.forward = partial(exchange, source_address=(str(self.proxy_ip), 0))
        self.tls = tls
        super().__init__(('127.0.0.1', 0), Handler)
        self.authority = f'{hostname}:{self.server_port}'
        self.origin = f'https://{self.authority}'

    def get_request(self):
        connection, peer = super().get_request()
        connection.settimeout(5)
        try:
            return self.tls.wrap_socket(connection, server_side=True, do_handshake_on_connect=False), peer
        except OSError:
            connection.close()
            raise

    def bridge_host(self, address):
        network = self.private_network
        return address in network and address not in (network.network_address, network.broadcast_address)

    def admit(self, target):
        address = IPv4Address(target)
        if address == self.proxy_ip or not self.bridge_host(address):
            raise ValueError('Held application must belong to the private bridge')
        with self.condition:
            if self.target or self.inflight:
                raise RuntimeError('Previous ingress has not drained')
            self.target = target

    def take(self):
        with self.condition:
            if self.target:
                self.inflight += 1
            return self.target

    def release(self):
        with self.condition:
            self.inflight -= 1
            self.condition.notify_all()

    def drain(self, timeout=10):
        with self.condition:
            self.target = None
            self.condition.notify_all()
            if not self.condition.wait_for(lambda: self.inflight == 0, timeout):
                raise TimeoutError('Ingress is closed; a request is still in flight')


class Handler(BaseHTTPRequestHandler):
    forwarded = {'content-type', 'accept', 'cookie', 'user-agent'}

    def log_message(self, *args):
        pass

    def handle(self):
        try:
            self.connection.do_handshake()
        except (ssl.SSLError, TimeoutError):
            return
        super().handle()

    def handle_held(self):
        self.connection.settimeout(5)
        try:
            route = select_route(self.command, self.path)
        except ValueError:
            route = None
        lengths = self.headers.get_all('content-length', [])
        if (not route or self.requestline.split()[1] != self.path
                or self.headers.get_all('host') != [self.server.authority] or self.headers.get('transfer-encoding')
                or len(lengths) > 1 or any(len(self.headers.get_all(name, [])) > 1 for name in self.forwarded)
                or (self.command == 'POST' and self.headers.get_all('origin') != [self.server.origin])
                or any(name in self.headers for name in ('auth', 'showorg', 'x-http-method-override',
                                                         'x-original-url', 'x-rewrite-url'))):
            self.send_error(405)
            return
        target = self.server.take()
        if not target:
            self.send_error(503)
            return
        try:
            length = lengths[0] if lengths else '0'
            if not re.fullmatch(r'[0-9]{1,4}', length) or int(length) > 4096 or (self.command != 'POST' and int(length)):
                self.send_error(413)
                return
            body = self.rfile.read(int(length))
            if self.command == 'POST' and not local_login(body):
                self.send_error(405)
                return
            headers = {k: v for k, v in self.headers.items() if k.lower() in self.forwarded}
            # Caller-supplied forwarding headers are outside the allowlist.
            # Only this gate's TLS socket peer determines the upstream client address.
            headers['Host'] = self.server.authority
            headers['X-Forwarded-For'] = self.client_address[0]
            headers['X-Forwarded-Proto'] = 'https'
            status, reply, data = self.server.forward(target, route[0], self.command, route[1], body, headers)
            self.send_response(status)
            for key, value in reply:
                if key.lower() not in {'connection', 'transfer-encoding', 'content-length', 'keep-alive', 'date', 'server'}:
                    self.send_header(key, value)
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            if self.command != 'HEAD':
                self.wfile.write(data)
        except (OSError, http.client.HTTPException):
            self.close_connection = True
        finally:
            self.server.release()

    do_GET = do_HEAD = do_POST = do_PUT = do_DELETE = do_PATCH = handle_held


def local_login(body):
    try:
        data = json.loads(body)
    except (UnicodeError, ValueError, RecursionError):
        return False
    return (isinstance(data, dict) and set(data) == {'provider', 'email', 'password'} and data['provider'] == 'LOCAL'
            and all(isinstance(data[field], str) and 0 < len(data[field]) < 320 for field in ('email', 'password')))
