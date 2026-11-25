"""One-shot local WSL fixture metadata. The operator probe uses sockets only."""

from contextlib import contextmanager
import ctypes
from hashlib import sha256
from hmac import compare_digest
import json
import os
from pathlib import Path
import re
import socket
import ssl
import stat
import sys
import time
from uuid import UUID


LOOPBACK = '127.0.0.1'
PROFILE_ROOT = 'EP-Maintenance-Fixtures'
PROFILE_FILES = ('config.json', 'ca.pem', 'peer.pem', 'peer.key')
INSTALL_FILES = (*PROFILE_FILES, 'channel.py', 'active.lock')
LIMIT = 1024
WINDOW = 90
OPERATION = 'EP-METADATA/1'


class Refused(ValueError):
    pass


def require(condition, reason):
    if not condition:
        raise Refused(reason)


def fixture_name(value):
    require(isinstance(value, str) and re.fullmatch(r'ep-maint-meta-[0-9a-f]{12}', value), 'Expected a disposable fixture name')
    return value


def local_windows(path):
    require(sys.platform == 'win32' and path.is_absolute() and re.fullmatch(r'[A-Za-z]:', path.drive)
            and ctypes.windll.kernel32.GetDriveTypeW(path.anchor) == 3 and '..' not in path.parts,
            'Expected a fixed local Windows drive')
    for part in (*reversed(path.parents), path):
        require(not part.lstat().st_file_attributes & stat.FILE_ATTRIBUTE_REPARSE_POINT,
                'Reparse points are refused for Windows profile paths')
    return path


def windows_root():
    return local_windows(Path(os.environ.get('LOCALAPPDATA', ''))) / PROFILE_ROOT


def read_small(path, limit):
    info = path.lstat()
    require(stat.S_ISREG(info.st_mode) and info.st_size <= limit, 'Unexpected pairing file')
    with path.open('rb') as handle:
        require(os.path.samestat(info, os.fstat(handle.fileno())), 'Pairing file changed while opening')
        data = handle.read(limit + 1)
    require(len(data) == info.st_size, 'Pairing file changed while reading')
    return data


def config(folder, expected):
    try:
        value = json.loads(read_small(folder / 'config.json', LIMIT).decode('ascii'))
        require(set(value) == {'fixture', 'port', 'instance', 'peerSha256'} and value['fixture'] == expected
                and type(value['port']) is int and 1024 <= value['port'] <= 65535
                and re.fullmatch(r'[a-f0-9]{32}', value['instance'])
                and re.fullmatch(r'[a-f0-9]{64}', value['peerSha256']), 'Invalid target pairing')
        return value
    except (AttributeError, KeyError, TypeError, UnicodeError, json.JSONDecodeError):
        raise Refused('Invalid target pairing') from None


def tls_context(folder, server):
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER if server else ssl.PROTOCOL_TLS_CLIENT)
    context.minimum_version = ssl.TLSVersion.TLSv1_2
    context.verify_mode = ssl.CERT_REQUIRED
    context.load_verify_locations(folder / 'ca.pem')
    context.load_cert_chain(folder / 'peer.pem', folder / 'peer.key')
    return context


def check_peer(connection, pin):
    cert = connection.getpeercert(binary_form=True)
    require(cert and compare_digest(sha256(cert).hexdigest(), pin), 'Peer certificate pin mismatch')


def frame(connection, deadline):
    buffer = bytearray()
    while len(buffer) < LIMIT:
        remaining = deadline - time.monotonic()
        require(remaining > 0, 'Request deadline elapsed')
        connection.settimeout(remaining)
        block = connection.recv(LIMIT - len(buffer))
        require(block, 'Endpoint closed without an accepted frame')
        buffer.extend(block)
        if b'\n' in buffer:
            require(buffer.count(b'\n') == 1 and buffer[-1:] == b'\n', 'Invalid frame boundary')
            return bytes(buffer)
    raise Refused('Frame exceeds size limit')


def request_bytes(pairing):
    return f"{OPERATION} {pairing['fixture']} {pairing['instance']}\n".encode('ascii')


def probe(fixture):
    folder = windows_root() / fixture_name(fixture) / 'client'
    for name in PROFILE_FILES:
        local_windows(folder / name)
    pairing = config(folder, fixture)
    context = tls_context(folder, server=False)
    with socket.create_connection((LOOPBACK, pairing['port']), timeout=3) as tcp:
        with context.wrap_socket(tcp, server_hostname=LOOPBACK) as connection:
            check_peer(connection, pairing['peerSha256'])
            connection.sendall(request_bytes(pairing))
            raw = frame(connection, time.monotonic() + 3)
    try:
        reply = json.loads(raw)
        require(set(reply) == {'kind', 'fixture', 'instance', 'bootId', 'uid'}
                and reply['kind'] == 'FIXTURE_MAINTENANCE_METADATA' and reply['uid'] == 1100
                and reply['fixture'] == fixture and reply['instance'] == pairing['instance']
                and str(UUID(reply['bootId'])) == reply['bootId'], 'Unexpected target metadata')
    except (AttributeError, KeyError, TypeError, ValueError) as error:
        raise Refused('Unexpected target metadata') from error
    return reply


def guest():
    require(sys.platform.startswith('linux'), 'Guest operations require Linux')
    import pwd

    fixture = fixture_name(os.environ.get('WSL_DISTRO_NAME'))
    require(os.getuid() == os.geteuid() == 1100, 'Expected disposable UID 1100')
    account = pwd.getpwuid(os.getuid())
    require(account.pw_name == 'ep-meta' and account.pw_dir == '/home/ep-meta', 'Expected disposable ep-meta principal')
    home = Path(account.pw_dir)
    require(home.is_dir() and not home.is_symlink() and home.stat().st_uid == 1100, 'Unexpected fixture home')
    return fixture, home / '.ep-maint-metadata'


def install(source):
    fixture, root = guest()
    config(source, fixture)
    inputs = {name: read_small(source / name, 16384) for name in PROFILE_FILES}
    inputs['channel.py'] = Path(__file__).read_bytes()
    inputs['active.lock'] = b''
    os.umask(0o077)
    root.mkdir(mode=0o700)
    created = []
    try:
        for name, contents in inputs.items():
            with (root / name).open('xb') as file:
                created.append(name)
                file.write(contents)
    except OSError:
        for name in created:
            (root / name).unlink()
        root.rmdir()
        raise


@contextmanager
def installed(root):
    import fcntl

    info = root.lstat()
    require(stat.S_ISDIR(info.st_mode) and stat.S_IMODE(info.st_mode) == 0o700 and info.st_uid == 1100,
            'Unexpected installation directory')
    lock = root / 'active.lock'
    with os.fdopen(os.open(lock, os.O_RDONLY | os.O_NOFOLLOW), 'rb') as handle:
        info = os.fstat(handle.fileno())
        require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_uid == 1100, 'Unexpected installation lock')
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise Refused('The one-shot listener is active') from None
        require(os.path.samestat(info, lock.lstat()) and {p.name for p in root.iterdir()} == set(INSTALL_FILES),
                'Installation contents changed')
        for name in INSTALL_FILES:
            saved = (root / name).lstat()
            require(stat.S_ISREG(saved.st_mode) and stat.S_IMODE(saved.st_mode) == 0o600
                    and saved.st_nlink == 1 and saved.st_uid == 1100, 'Unexpected installation file')
        yield


def uninstall():
    _, root = guest()
    with installed(root):
        for name in INSTALL_FILES:
            (root / name).unlink()
        root.rmdir()


def serve():
    fixture, root = guest()
    with installed(root):
        pairing = config(root, fixture)
        context = tls_context(root, server=True)
        boot = Path('/proc/sys/kernel/random/boot_id').read_text(encoding='ascii').strip()
        response = json.dumps({'kind': 'FIXTURE_MAINTENANCE_METADATA', 'fixture': fixture,
                               'instance': pairing['instance'], 'bootId': str(UUID(boot)),
                               'uid': os.getuid()}).encode('ascii') + b'\n'
        end = time.monotonic() + WINDOW
        with socket.socket() as listener:
            listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            listener.bind((LOOPBACK, pairing['port']))
            listener.listen(4)
            while (remaining := end - time.monotonic()) > 0:
                listener.settimeout(remaining)
                try:
                    tcp, _ = listener.accept()
                except TimeoutError:
                    break
                with tcp:
                    deadline = min(end, time.monotonic() + 3)
                    tcp.settimeout(max(0.001, deadline - time.monotonic()))
                    try:
                        with context.wrap_socket(tcp, server_side=True) as connection:
                            check_peer(connection, pairing['peerSha256'])
                            require(frame(connection, deadline) == request_bytes(pairing), 'Request refused')
                            connection.settimeout(max(0.001, deadline - time.monotonic()))
                            connection.sendall(response)
                            return
                    except (OSError, Refused):
                        continue
        raise Refused('One-shot listener expired without an accepted request')


if __name__ == '__main__':
    try:
        match sys.argv[1:]:
            case ['probe', fixture]:
                print(json.dumps(probe(fixture)))
            case ['install', source]:
                install(Path(source))
            case ['serve']:
                serve()
            case ['uninstall']:
                uninstall()
            case _:
                raise Refused('Use probe FIXTURE, install BUNDLE, serve, or uninstall')
    except (OSError, ValueError) as error:
        print(str(error) if isinstance(error, Refused) else 'Endpoint or local pairing unavailable', file=sys.stderr)
        sys.exit(1)
