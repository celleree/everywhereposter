"""Run the actual Windows CLI and guest installer against one owned WSL fixture."""

from hashlib import file_digest
import json
import os
from pathlib import Path
import socket
import ssl
import subprocess
import sys
from tempfile import TemporaryDirectory
import time
from uuid import uuid4
import winreg

from channel import LOOPBACK, config, local_windows, require, tls_context, windows_root


SOURCE = Path(__file__).resolve().parent
SYSTEM = Path(os.environ['SystemRoot']) / 'System32'
WSL = SYSTEM / 'wsl.exe'
ROOTFS_HASH = '8251e27ffff381a4af5f41dcb94d867de3e0d9774a9241908ab34555d99315ea'
GUEST_APP = '/home/ep-meta/.ep-maint-metadata/channel.py'
BOOT_HOOK = b'''set -eu
useradd --create-home --uid 1100 --shell /bin/sh ep-meta
mkdir -m 700 /opt/ep-meta-test
cat >/opt/ep-meta-test/on-boot <<'EOF'
#!/bin/sh
printf 'boot\n' >>/opt/ep-meta-test/boots
printf 'simulated publishing only\n' >>/opt/ep-meta-test/publishes
EOF
printf '[boot]\ncommand=/bin/sh /opt/ep-meta-test/on-boot\n' >/etc/wsl.conf
'''


def run(argv, expected=0, timeout=35, data=None, env=None):
    result = subprocess.run(argv, input=data, env=env, timeout=timeout, capture_output=True,
                            creationflags=subprocess.CREATE_NO_WINDOW)
    encoding = 'utf-16-le' if b'\0' in result.stdout[:80] else 'utf-8'
    stdout = result.stdout.decode(encoding, errors='replace').strip('\ufeff \t\r\n')
    if result.returncode != expected:
        stderr = result.stderr.decode(errors='replace').replace('\x00', '').strip()
        raise RuntimeError(f'Expected exit {expected}, got {result.returncode}: {stderr[-500:]}')
    return stdout


def names(*options):
    return {line.strip('\ufeff \t\r') for line in run([WSL, '--list', '--quiet', *options]).splitlines()}


def registration(fixture):
    records = []
    with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r'Software\Microsoft\Windows\CurrentVersion\Lxss') as key:
        for position in range(winreg.QueryInfoKey(key)[0]):
            name = winreg.EnumKey(key, position)
            with winreg.OpenKey(key, name) as item:
                try:
                    if winreg.QueryValueEx(item, 'DistributionName')[0] == fixture:
                        path = winreg.QueryValueEx(item, 'BasePath')[0].removeprefix('\\\\?\\')
                        records.append((name, Path(path).resolve()))
                except FileNotFoundError:
                    continue
    require(len(records) == 1, 'Could not bind disposable WSL registration')
    return records[0]


def guest_path(path):
    path = local_windows(path)
    return '/mnt/' + path.drive[0].lower() + '/' + '/'.join(path.parts[1:])


def binding(port, process):
    script = f'Get-NetTCPConnection -State Listen -LocalPort {port} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty LocalAddress'
    for _ in range(15):
        require(process.poll() is None, 'Fixture listener exited early')
        addresses = set(run([SYSTEM / 'WindowsPowerShell/v1.0/powershell.exe', '-NoProfile', '-NonInteractive',
                             '-Command', script]).splitlines())
        if addresses:
            require(addresses == {LOOPBACK}, 'A non-loopback listener was observed')
            return sorted(addresses)
        time.sleep(0.3)
    raise RuntimeError('The paused fixture did not expose its loopback listener')


def refused_frame(folder, pairing, authenticated, payload):
    if authenticated:
        context = tls_context(folder, server=False)
    else:
        context = ssl.create_default_context(cafile=folder / 'ca.pem')
    try:
        with socket.create_connection((LOOPBACK, pairing['port']), timeout=4) as tcp:
            with context.wrap_socket(tcp, server_hostname=LOOPBACK) as connection:
                connection.sendall(payload)
                require(connection.recv(1024) == b'', 'Refused frame returned data')
    except (ConnectionResetError, ssl.SSLError):
        pass


def rehearse(archive, openssl):
    with archive.open('rb') as file:
        require(file_digest(file, 'sha256').hexdigest() == ROOTFS_HASH, 'Unexpected Canonical root filesystem hash')
    os.environ['WSL_UTF8'] = '1'
    fixture = 'ep-maint-meta-' + uuid4().hex[:12]
    before = names('--running')
    require(fixture not in names(), 'Disposable name collision')
    admin = [WSL, '--distribution', fixture, '--user', 'root', '--cd', '/', '--exec']
    guest = [WSL, '--distribution', fixture, '--user', 'ep-meta', '--cd', '/', '--exec', '/usr/bin/python3', '-B']
    python = [sys.executable, '-B']
    pair = [*python, SOURCE / 'pair.py']
    probe = [*python, SOURCE / 'channel.py', 'probe', fixture]
    with TemporaryDirectory(prefix='ep-maint-meta-wsl-') as directory:
        disk = local_windows(Path(directory)) / 'disk'
        disk.mkdir()
        paired = False
        owned = None
        processes = []
        try:
            windows_pairing = json.loads(run([*pair, 'pair', fixture, openssl]))
            paired = True
            folder = windows_root() / fixture / 'client'
            profile = folder / 'config.json'
            pairing = config(folder, fixture)
            run([WSL, '--import', fixture, disk, archive, '--version', '2'], timeout=180)
            candidate = registration(fixture)
            require(candidate[1] == disk.resolve(), 'Unexpected fixture ownership')
            owned = candidate
            run([*admin, '/bin/sh', '-s'], data=BOOT_HOOK)
            script = guest_path(SOURCE / 'channel.py')
            run([*guest, script, 'install', guest_path(Path(windows_pairing['guestBundle']))])
            run([*guest, script, 'install', guest_path(Path(windows_pairing['guestBundle']))], expected=1)
            run([*pair, 'clear-guest', fixture])
            expected_boot = run([*admin, '/bin/cat', '/proc/sys/kernel/random/boot_id'])

            def activate():
                listener = subprocess.Popen([*guest, GUEST_APP, 'serve'], creationflags=subprocess.CREATE_NO_WINDOW)
                processes.append(listener)
                return listener, binding(pairing['port'], listener)

            listener, addresses = activate()
            run([*guest, GUEST_APP, 'uninstall'], expected=1)
            for key, incorrect in [('peerSha256', '0' * 64), ('instance', '0' * 32)]:
                try:
                    profile.write_text(json.dumps(pairing | {key: incorrect}), encoding='ascii')
                    require(run(probe, expected=1) == '', 'Wrong target returned metadata')
                finally:
                    profile.write_text(json.dumps(pairing), encoding='ascii')
            refused_frame(folder, pairing, False, b'EP-METADATA/1\n')
            refused_frame(folder, pairing, True, b'PUBLISH\n')
            require(run([*probe, 'arbitrary-input'], expected=1) == '', 'Unexpected input was accepted')
            metadata = json.loads(run(probe))
            require(metadata == {'kind': 'FIXTURE_MAINTENANCE_METADATA', 'fixture': fixture, 'instance': pairing['instance'],
                                 'bootId': expected_boot, 'uid': 1100}, 'Metadata did not match the actual fixture')
            require(listener.wait(timeout=10) == 0 and run(probe, expected=1) == '', 'One-shot access did not close')

            activate()
            run([WSL, '--terminate', fixture])
            require(fixture not in names('--running'), 'Disposable fixture did not stop')
            require(run(probe, expected=1) == '' and fixture not in names('--running'), 'Stopped fixture was entered')
            unc = os.environ | {'LOCALAPPDATA': rf'\\wsl.localhost\{fixture}\home\ep-meta'}
            require(run(probe, expected=1, env=unc) == '' and fixture not in names('--running'), 'UNC profile caused entry')
            # Only the test harness deliberately restarts the disposable fixture to count its boot markers.
            counts = 'for i in 1 2 3 4 5; do test -s /opt/ep-meta-test/publishes && break; sleep 1; done; '
            counts += 'wc -l </opt/ep-meta-test/boots; wc -l </opt/ep-meta-test/publishes'
            require(run([*admin, '/bin/sh', '-c', counts]).splitlines() == ['1', '1'],
                    'The query caused an extra boot or simulated publishing start')
            run([*guest, GUEST_APP, 'uninstall'])
            run([*admin, '/usr/bin/test', '!', '-e', '/home/ep-meta/.ep-maint-metadata'])
            run([*guest, script, 'serve'], expected=1)
            run([*pair, 'unpair', fixture])
            require(not (windows_root() / fixture).exists(), 'Windows pairing remained installed')
            paired = False
        finally:
            if owned:
                require(registration(fixture) == owned and owned[1] == disk.resolve(), 'Disposable registration changed')
                if fixture in names('--running'):
                    run([WSL, '--terminate', fixture])
                run([WSL, '--unregister', fixture])
            for process in processes:
                process.wait(timeout=10)
            if paired:
                run([*pair, 'unpair', fixture])
    require(names('--running') == before and fixture not in names(), 'Fixture cleanup was not verified')
    print(json.dumps({'kind': 'DISPOSABLE_WSL_ONE_SHOT_MAINTENANCE', 'fixture': fixture, 'windowsListenerAddresses': addresses,
                      'windowsOperatorCli': True, 'actualTargetIdentityMatched': True, 'missingClientCertificateRefused': True,
                      'wrongServerPinRefused': True, 'wrongInstanceRefused': True, 'publishAndExtraInputRefused': True,
                      'oneShotAndActiveUninstallRefusal': True, 'noBootOrSimulatedPublishFromStoppedProbe': True,
                      'uncProfileRefusedWithoutBoot': True,
                      'guestInstallUninstallAndWindowsUnpair': True, 'fixtureRemoved': True}, indent=2))


if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit('Usage: python -B test-wsl.py ROOTFS OPENSSL')
    rehearse(local_windows(Path(sys.argv[1])), local_windows(Path(sys.argv[2])))
