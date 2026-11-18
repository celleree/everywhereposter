# Temporal worker shutdown regression

The pnpm patch targets `nestjs-temporal-core@3.2.3` and is applied in both
development and production dependency stages. No SDK version changes.
Remove the patch only after equivalent upstream lifecycle coverage passes.

Run focused tests with:

```sh
corepack pnpm exec jest --config jest.temporal.config.cjs --runInBand
```

Tests use the installed patched manager, including a real Nest application
context. They cover all 32 completion promises, delayed main drain, creation and
connection races, legacy startup, normal restart, terminal restart suppression,
concurrent/repeated hooks, rejection, connection-close error, and timeout.
Both Nest hooks share one terminal shutdown promise. Timeout rejects; it never
asserts STOPPED. An unfinished drain can still complete later, but repeated
shutdown callers retain the timeout failure. A failed worker blocks successful
manager completion and connection closure.

## Isolated native proof (explicit operator approval required)

`native-shutdown.cjs` uses real SDK workers and a real Nest SIGTERM lifecycle,
not mocked Worker.run. It deliberately starts 32 synthetic hold activities,
including one on main, with retries disabled. It releases the 31 other workers
first, verifies Nest remains alive for another second, then releases main.
All 32 raw run completions must report native STOPPED before Nest exits by
SIGTERM. A workflow may remain incomplete after worker shutdown; that is
expected and belongs only to the disposable server.

The reviewed launcher is `run-native-shutdown.py`. It downloads only the pinned
official CLI 1.4.1 Linux-amd64 archive and verifies its SHA256 before extraction.
It creates its own private HOME, temp directory, SQLite storage and UUID
namespace. Server and harness receive only allowlisted environment variables.
All server listeners must belong to the owned process group and bind loopback.
Fixed fixture ports are 17233 (gRPC), 17234 (HTTP), and 17235 (metrics); occupied
ports cause failure before download. The UI is disabled.

**Version limitation:** official CLI 1.4.1 embeds server **1.28.0**, so this is
separately labelled **INTERIM**, not production parity with server **1.28.1**.
The live server version, SDK 1.15.0 and patched manager SHA256 are checked.
Exact 1.28.1 evidence remains unresolved; no product dependency version changes
are part of this fixture.

After explicit source-review, download, and resource approval:

```sh
env -i PATH=/usr/bin:/bin /usr/bin/python3 -I \
  tests/temporal/run-native-shutdown.py --approved-isolated-fixture
```

The supervisor applies two-CPU affinity to every owned fixture process, samples
aggregate RSS (including itself) every 100ms, and aborts above 2 GiB. This is a
supervised abort threshold, not an OS-enforced memory cgroup; short sampling
overshoot is possible. A 180-second wall deadline covers download, server and
harness. Each Node process additionally has a 1 GiB V8 heap cap; those individual
caps are not claimed as the combined memory bound.

Only owned process groups are signalled. Cleanup awaits TERM then, if needed,
KILL and verifies no owned PID remains. Forced cleanup makes the report FAIL.
Parent-death signals stop the owned server/harness leaders if the supervisor
dies, and the worker child exits if its IPC parent disconnects. No other server,
Docker daemon, container, credential, application environment or production
resource is read or modified.

Evidence stays in the newly created private temporary directory: CLI checksum
and version, logs, observed server/SDK/manager identities, peak combined RSS,
CPU affinity, queue events, and cleanup outcome. The launcher prints its
report path. No fixture data is deleted automatically. Any unexpected
version, worker identity, duplicate/missing queue event, timeout, resource
limit, rejected drain, premature exit or incomplete cleanup is a failed proof.

## Independently verifiable fixture inputs

- Official release metadata:
  https://api.github.com/repos/temporalio/cli/releases/tags/v1.4.1
  The `temporal_cli_1.4.1_linux_amd64.tar.gz` asset's digest is
  `sha256:e2063feade24d90cec1590dd9a46b0ccf838433b013738a348af1c01a9cb3874`.
- Official checksum listing:
  https://github.com/temporalio/cli/releases/download/v1.4.1/checksums.txt
- Official CLI source at commit `9bc3d31a00c2786b3af01f1fb9cc87d26538448a`:
  https://github.com/temporalio/cli/blob/9bc3d31a00c2786b3af01f1fb9cc87d26538448a/temporalcli/devserver/server.go
  Listener bindings use FrontendIP; the launcher explicitly sets loopback,
  disables UI and uses local SQLite. Archival is disabled by the dev server.
- Server version-check implementation:
  https://github.com/temporalio/temporal/blob/v1.28.0/service/frontend/version_checker.go
  The launcher always sets `TEMPORAL_VERSION_CHECK_DISABLED=1`, overriding
  ambient settings, to disable the otherwise automatic outbound version check.

The child installs its IPC-disconnect exit handler before imports and the first
await, including workflow bundling. An offline VM regression leaves bundling
pending and verifies disconnect immediately requests exit; it launches no
workers, servers, or network connections.
