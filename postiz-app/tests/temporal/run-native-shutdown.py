#!/usr/bin/env python3
# Explicitly approved, isolated fixture only. Importing this file starts nothing.
import argparse
import ctypes
import hashlib
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.request
import uuid

CLI_VERSION = "1.4.1"
ARCHIVE_URL = "https://github.com/temporalio/cli/releases/download/v1.4.1/temporal_cli_1.4.1_linux_amd64.tar.gz"
ARCHIVE_SHA256 = "e2063feade24d90cec1590dd9a46b0ccf838433b013738a348af1c01a9cb3874"
# INTERIM evidence only. Exact production-server 1.28.1 parity remains unresolved.
# Official CLI 1.4.1 source pins server 1.28.0; verify the actual running version.
SERVER_VERSION = "1.28.0"
RSS_LIMIT = 2 * 1024 * 1024 * 1024
TIME_LIMIT = 180
PORTS = (17233, 17234, 17235)
HERE = Path(__file__).resolve().parent


def members(groups):
    found = []
    for entry in Path("/proc").iterdir():
        if not entry.name.isdecimal():
            continue
        try:
            fields = (entry / "stat").read_text().split(") ", 1)[1].split()
            if int(fields[2]) in groups and int(fields[3]) == int(fields[2]):
                rss = max(0, int(fields[21])) * os.sysconf("SC_PAGE_SIZE")
                found.append((int(entry.name), rss, int(fields[2])))
        except (FileNotFoundError, ProcessLookupError, PermissionError):
            continue
    return found


def verify_listeners(groups, require_frontend=False):
    inodes = set()
    for pid, _, _ in members(groups):
        try:
            for fd in Path(f"/proc/{pid}/fd").iterdir():
                try:
                    target = os.readlink(fd)
                    if target.startswith("socket:["):
                        inodes.add(target[8:-1])
                except (FileNotFoundError, PermissionError):
                    pass
        except (FileNotFoundError, PermissionError):
            pass
    frontend = False
    for table in ("tcp", "tcp6"):
        for row in Path(f"/proc/net/{table}").read_text().splitlines()[1:]:
            fields = row.split()
            if fields[3] != "0A" or fields[9] not in inodes:
                continue
            address, port = fields[1].split(":")
            allowed = "0100007F" if table == "tcp" else "00000000000000000000000001000000"
            if address != allowed:
                raise RuntimeError("Owned fixture opened a non-loopback listener")
            frontend |= int(port, 16) == PORTS[0]
    if require_frontend and not frontend:
        raise RuntimeError("Frontend listener does not belong to the owned fixture")


class Supervisor:
    def __init__(self, root):
        self.root = root
        self.processes = []
        self.groups = set()
        self.handles = []
        self.peak_rss = 0
        self.deadline = time.monotonic() + TIME_LIMIT
        self.cpus = sorted(os.sched_getaffinity(0))[:2]
        if len(self.cpus) != 2:
            raise RuntimeError("Two available fixture CPUs are required")
        home, temporary = root / "home", root / "tmp"
        home.mkdir()
        temporary.mkdir()
        self.env = {"PATH": "/usr/bin:/bin", "HOME": str(home), "TMPDIR": str(temporary),
                    "LANG": "C.UTF-8", "GOMAXPROCS": "2",
                    "TEMPORAL_VERSION_CHECK_DISABLED": "1",
                    "NODE_OPTIONS": "--max-old-space-size=1024",
                    "DRAIN_PROOF_NAMESPACE": "drain-proof-" + str(uuid.uuid4()),
                    "DRAIN_PROOF_SERVER_VERSION": SERVER_VERSION}

    def launch(self, name, command):
        parent_pid = os.getpid()
        def isolate():
            os.setsid()
            os.sched_setaffinity(0, self.cpus)
            # Kill the exact child leader if this supervisor dies, including SIGKILL.
            if ctypes.CDLL(None).prctl(1, signal.SIGKILL) != 0:
                raise RuntimeError("Unable to enforce parent-death cleanup")
            if os.getppid() != parent_pid:
                os.kill(os.getpid(), signal.SIGKILL)
        log = (self.root / (name + ".log")).open("wb")
        self.handles.append(log)
        proc = subprocess.Popen(command, cwd=HERE, env=self.env, stdin=subprocess.DEVNULL,
                                stdout=log, stderr=subprocess.STDOUT, preexec_fn=isolate)
        self.processes.append(proc)
        self.groups.add(proc.pid)
        return proc

    def check(self):
        self_rss = int(Path("/proc/self/stat").read_text().split(") ", 1)[1].split()[21]) * os.sysconf("SC_PAGE_SIZE")
        self.peak_rss = max(self.peak_rss, self_rss + sum(rss for _, rss, _ in members(self.groups)))
        if self.peak_rss > RSS_LIMIT:
            raise RuntimeError("Combined fixture RSS exceeded 2 GiB supervised abort threshold")
        if time.monotonic() > self.deadline:
            raise RuntimeError("Fixture exceeded 180-second wall-clock limit")
        verify_listeners(self.groups)

    def wait(self, proc):
        while proc.poll() is None:
            self.check()
            time.sleep(0.1)
        self.check()
        if proc.returncode != 0:
            raise RuntimeError(f"Fixture command failed with exit {proc.returncode}; inspect retained logs")

    def cleanup(self):
        forced = False
        for group in self.groups:
            if members({group}):
                try:
                    os.killpg(group, signal.SIGTERM)
                except ProcessLookupError:
                    pass
        until = time.monotonic() + 10
        while members(self.groups) and time.monotonic() < until:
            for proc in self.processes:
                proc.poll()
            time.sleep(0.1)
        for group in self.groups:
            if members({group}):
                forced = True
                try:
                    os.killpg(group, signal.SIGKILL)
                except ProcessLookupError:
                    pass
        for proc in self.processes:
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                forced = True
        remaining = members(self.groups)
        for handle in self.handles:
            handle.close()
        return {"forced": forced, "remaining_pids": [pid for pid, _, _ in remaining]}


def download_cli(root):
    # No proxy/environment credentials; trust only the pinned official release digest.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(ARCHIVE_URL, timeout=30) as response:
        data = response.read(100 * 1024 * 1024 + 1)
    if len(data) > 100 * 1024 * 1024 or hashlib.sha256(data).hexdigest() != ARCHIVE_SHA256:
        raise RuntimeError("Official CLI archive checksum/size mismatch")
    archive = root / "cli.tar.gz"
    archive.write_bytes(data)
    with tarfile.open(archive) as package:
        entries = [member for member in package.getmembers() if member.name == "temporal"]
        if len(entries) != 1 or not entries[0].isfile():
            raise RuntimeError("Expected one regular temporal binary")
        binary = root / "temporal"
        binary.write_bytes(package.extractfile(entries[0]).read())
    binary.chmod(0o700)
    return binary


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--approved-isolated-fixture", action="store_true",
                        help="Run only after explicit resource/download approval and source review")
    args = parser.parse_args()
    if not args.approved_isolated_fixture:
        parser.error("Explicit isolated fixture approval flag required")
    if not sys.flags.isolated:
        parser.error("Launch Python with -I to exclude ambient Python configuration")
    os.umask(0o077)
    root = Path(tempfile.mkdtemp(prefix="ep-temporal-proof-"))
    supervisor = Supervisor(root)
    os.environ.clear()
    os.environ.update(supervisor.env)
    report = {"result": "FAIL", "evidence": str(root), "archive_sha256": ARCHIVE_SHA256,
              "expected_server": SERVER_VERSION, "production_server": "1.28.1",
              "evidence_scope": "INTERIM nearest-version proof; NOT production parity", "namespace": supervisor.env["DRAIN_PROOF_NAMESPACE"],
              "cpu_affinity": supervisor.cpus, "rss_limit_bytes": RSS_LIMIT,
              "rss_sampling_seconds": 0.1, "wall_limit_seconds": TIME_LIMIT}
    def interrupted(signum, frame):
        raise RuntimeError(f"Fixture interrupted by signal {signum}")
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    signal.signal(signal.SIGALRM, interrupted)
    signal.alarm(TIME_LIMIT)
    try:
        # Fail before download if the fixed fixture ports are occupied.
        for port in PORTS:
            with socket.socket() as probe:
                probe.bind(("127.0.0.1", port))
        binary = download_cli(root)
        report["binary_sha256"] = hashlib.sha256(binary.read_bytes()).hexdigest()
        version = supervisor.launch("version", [str(binary), "--version"])
        supervisor.wait(version)
        report["cli_version_output"] = (root / "version.log").read_text().strip()
        if f" {CLI_VERSION} " not in report["cli_version_output"] + " ":
            raise RuntimeError("CLI version mismatch")
        server = supervisor.launch("server", [str(binary), "server", "start-dev",
            "--ip", "127.0.0.1", "--port", str(PORTS[0]), "--http-port", str(PORTS[1]),
            "--metrics-port", str(PORTS[2]), "--headless", "--db-filename", str(root / "fixture.sqlite"),
            "--namespace", supervisor.env["DRAIN_PROOF_NAMESPACE"]])
        ready = False
        while not ready:
            supervisor.check()
            if server.poll() is not None:
                raise RuntimeError("Owned server exited during startup")
            try:
                with socket.create_connection(("127.0.0.1", PORTS[0]), timeout=0.1):
                    verify_listeners({server.pid}, require_frontend=True)
                    ready = True
            except ConnectionRefusedError:
                time.sleep(0.1)
        harness = supervisor.launch("harness", ["/usr/bin/node", str(HERE / "native-shutdown.cjs")])
        supervisor.wait(harness)
        records = []
        for line in (root / "harness.log").read_text().splitlines():
            try:
                records.append(json.loads(line))
            except json.JSONDecodeError:
                pass
        if not any(record.get("result") == "PASS" for record in records):
            raise RuntimeError("Native harness did not emit passing graceful-drain evidence")
        report["observed"] = [r for r in records if r.get("type") == "identities" or r.get("result")]
        report["result"] = "PASS"
    except Exception as error:
        report["error"] = str(error)
    finally:
        # Cleanup must finish despite repeated operator interrupts.
        signal.alarm(0)
        signal.signal(signal.SIGTERM, signal.SIG_IGN)
        signal.signal(signal.SIGINT, signal.SIG_IGN)
        report["cleanup"] = supervisor.cleanup()
        report["peak_combined_rss_bytes"] = supervisor.peak_rss
        if report["cleanup"]["forced"] or report["cleanup"]["remaining_pids"]:
            report["result"] = "FAIL"
        (root / "report.json").write_text(json.dumps(report, indent=2) + "\n")
        print(json.dumps(report, indent=2))
    return 0 if report["result"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
