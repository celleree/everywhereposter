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

Before running, arrange a dedicated, disposable standalone Temporal dev server
on **127.0.0.1:17233**, with a new temporary SQLite database and no credentials,
cloud connection, production Docker daemon, production volumes, or application
environment files. Verify the listening PID belongs to that exact dev-server
process and that no listener existed before starting it. Record the official
CLI binary checksum, CLI version, and embedded server version. Production's
comparison version is **Temporal Server 1.28.1**, with **TypeScript SDK 1.15.0**.
Any version difference must be disclosed rather than called a matching proof.

The harness accepts no arbitrary address or namespace and loads no dotenv.
Each run uses UUID-prefixed task queues/workflow IDs in the disposable server.
The parent and child use synthetic activities only, never application modules.
A child is force-stopped only on harness failure, which is not passing evidence.

Example after the separately approved server is running:

```sh
DRAIN_PROOF_SERVER_VERSION=1.28.1 NODE_OPTIONS=--max-old-space-size=1024   timeout --kill-after=10s 180s taskset -c 0,1 node tests/temporal/native-shutdown.cjs
```

Keep the fixture server and worker processes within an agreed resource budget
(2 CPU and approximately 2 GiB combined target), retain logs/version/checksum
evidence, and stop only the exact fixture process created for this test.
Do not deploy or change any production service as part of this test.
