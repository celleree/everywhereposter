"""Mint and remove short-lived Windows/guest profiles for the disposable command."""

import csv
from hashlib import sha256
import json
import os
from pathlib import Path
import re
import socket
import ssl
import subprocess
import sys
from tempfile import TemporaryDirectory
from uuid import uuid4

from channel import LOOPBACK, PROFILE_FILES, Refused, fixture_name, local_windows, require, windows_root


def tool(argv, cwd=None, env=None):
    result = subprocess.run(argv, cwd=cwd, env=env, capture_output=True, timeout=20)
    require(result.returncode == 0, f'{Path(argv[0]).name} failed')
    return result.stdout.decode(errors='replace')


def secure(folder):
    system = Path(os.environ['SystemRoot']) / 'System32'
    _, sid = next(csv.reader(tool([system / 'whoami.exe', '/user', '/fo', 'csv', '/nh']).splitlines()))
    require(re.fullmatch(r'S-1-(?:\d+-)+\d+', sid), 'Could not bind the Windows operator SID')
    tool([system / 'icacls.exe', folder, '/inheritance:r', '/grant:r', f'*{sid}:(OI)(CI)F', '*S-1-5-18:(OI)(CI)F'])


def certificates(root, openssl):
    environment = os.environ | {'MSYS2_ARG_CONV_EXCL': '*'}
    with TemporaryDirectory(dir=root) as temporary:
        issuer = Path(temporary)

        def issue(*args):
            tool([openssl, *args], cwd=issuer, env=environment)

        issue('req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=WSL fixture CA',
              '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign,cRLSign',
              '-keyout', 'ca.key', '-out', 'ca.pem')
        pins = {}
        for side, usage in [('guest', 'serverAuth'), ('client', 'clientAuth')]:
            folder = root / side
            issue('req', '-new', '-newkey', 'rsa:2048', '-nodes', '-subj', f'/CN=WSL fixture {side}',
                  '-keyout', f'{side}.key', '-out', 'peer.csr')
            extensions = f'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage={usage}\n'
            if side == 'guest':
                extensions += 'subjectAltName=IP:127.0.0.1\n'
            (issuer / 'extensions').write_text(extensions, encoding='ascii')
            issue('x509', '-req', '-in', 'peer.csr', '-days', '1', '-CA', 'ca.pem', '-CAkey', 'ca.key',
                  '-CAcreateserial', '-extfile', 'extensions', '-out', 'peer.pem')
            pins[side] = sha256(ssl.PEM_cert_to_DER_cert((issuer / 'peer.pem').read_text(encoding='ascii'))).hexdigest()
            for name, source in [('ca.pem', 'ca.pem'), ('peer.pem', 'peer.pem'), ('peer.key', f'{side}.key')]:
                (folder / name).write_bytes((issuer / source).read_bytes())
    return pins


def pair(fixture, openssl):
    fixture_name(fixture)
    openssl = local_windows(openssl)
    base = windows_root()
    base.mkdir(exist_ok=True)
    root = local_windows(base) / fixture
    root.mkdir()
    try:
        secure(root)
        for side in ('guest', 'client'):
            (root / side).mkdir()
        pins = certificates(root, openssl)
        with socket.socket() as candidate:
            candidate.bind((LOOPBACK, 0))
            port = candidate.getsockname()[1]
        common = {'fixture': fixture, 'port': port, 'instance': uuid4().hex}
        for side, other in [('guest', 'client'), ('client', 'guest')]:
            (root / side / 'config.json').write_text(json.dumps(common | {'peerSha256': pins[other]}), encoding='ascii')
    except (OSError, Refused, subprocess.SubprocessError):
        for side in ('guest', 'client'):
            if (root / side).exists():
                for name in PROFILE_FILES:
                    (root / side / name).unlink(missing_ok=True)
                (root / side).rmdir()
        root.rmdir()
        raise
    return {'fixture': fixture, 'guestBundle': str(root / 'guest'), 'port': port}


def remove(fixture, include_client):
    root = local_windows(windows_root() / fixture_name(fixture))
    sides = ('guest', 'client') if include_client else ('guest',)
    require({path.name for path in root.iterdir()} <= {'guest', 'client'}, 'Unexpected pairing contents')
    folders = [local_windows(root / name) for name in sides if (root / name).exists()]
    for folder in folders:
        require({path.name for path in folder.iterdir()} == set(PROFILE_FILES), 'Unexpected profile contents')
        for name in PROFILE_FILES:
            require(local_windows(folder / name).is_file(), 'Unexpected profile entry')
    for folder in folders:
        for name in PROFILE_FILES:
            (folder / name).unlink()
        folder.rmdir()
    if include_client:
        root.rmdir()


if __name__ == '__main__':
    try:
        match sys.argv[1:]:
            case ['pair', fixture, openssl]:
                print(json.dumps(pair(fixture, Path(openssl))))
            case ['clear-guest', fixture]:
                remove(fixture, include_client=False)
            case ['unpair', fixture]:
                remove(fixture, include_client=True)
            case _:
                raise Refused('Use pair FIXTURE OPENSSL, clear-guest FIXTURE, or unpair FIXTURE')
    except (Refused, OSError, ValueError, subprocess.SubprocessError) as error:
        print(str(error) if isinstance(error, Refused) else 'Pairing operation could not complete', file=sys.stderr)
        sys.exit(1)
