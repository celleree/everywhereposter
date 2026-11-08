// Requires a separately approved, disposable loopback Temporal dev server.
// Never loads dotenv or application modules. No customer/provider activities run.
const assert = require('node:assert/strict');
const { fork } = require('node:child_process');
const { once } = require('node:events');
const { randomUUID } = require('node:crypto');
const path = require('node:path');

const address = '127.0.0.1:17233';
const namespace = process.env.DRAIN_PROOF_NAMESPACE;
assert(
  /^drain-proof-[0-9a-f-]{36}$/.test(namespace),
  'Supervisor-owned namespace required'
);
const prefix = `drain-proof-${randomUUID()}`;
const queues = Array.from(
  { length: 32 },
  (_, i) => `${prefix}-${i ? i : 'main'}`
);

async function child() {
  const { Module } = require('@nestjs/common');
  const { NestFactory } = require('@nestjs/core');
  const {
    TemporalWorkerManagerService: Manager,
  } = require('nestjs-temporal-core');
  const { bundleWorkflowCode } = require('@temporalio/worker');
  const queueNames = JSON.parse(process.env.DRAIN_PROOF_QUEUES);
  const held = new Map();
  const workflowBundle = await bundleWorkflowCode({
    workflowsPath: path.join(__dirname, 'drain-workflow.cjs'),
  });
  const manager = new Manager(
    {
      getAllActivities: () => ({
        hold: (queue) =>
          new Promise((resolve) => {
            held.set(queue, resolve);
            process.send({ type: 'activity-started', queue });
          }),
      }),
      getHealthStatus: () => ({ isComplete: true }),
    },
    {
      connection: { address, namespace },
      shutdownTimeout: 60000,
      autoRestart: false,
      enableLogger: false,
      workers: queueNames.map((taskQueue, i) => ({
        taskQueue,
        ...(i === 0 ? { workflowBundle } : {}),
        workerOptions: {
          maxConcurrentActivityTaskExecutions: 2,
          maxConcurrentActivityTaskPolls: 1,
          ...(i === 0
            ? {
                maxConcurrentWorkflowTaskExecutions: 2,
                maxConcurrentWorkflowTaskPolls: 1,
                workflowThreadPoolSize: 1,
              }
            : {}),
        },
      })),
    }
  );
  process.on('disconnect', () => process.exit(1));
  process.on('message', (message) => {
    if (message.type === 'release')
      for (const queue of message.queues) held.get(queue)?.();
  });
  const destroy = manager.onModuleDestroy.bind(manager);
  manager.onModuleDestroy = async () => {
    process.send({ type: 'destroy-entered' });
    await destroy();
    process.send({ type: 'destroy-completed' });
  };
  class TestModule {}
  Module({ providers: [{ provide: Manager, useValue: manager }] })(TestModule);
  const app = await NestFactory.createApplicationContext(TestModule, {
    logger: false,
  });
  app.enableShutdownHooks(['SIGTERM']);
  for (const queue of queueNames) {
    const worker = manager.getWorker(queue);
    manager.workerRuns.get(worker).then(
      () =>
        process.send({
          type: 'run-completed',
          queue,
          state: worker.getState(),
        }),
      (error) =>
        process.send({ type: 'run-failed', queue, error: String(error) })
    );
  }
  process.send({
    type: 'ready',
    workers: manager.getAllWorkers().totalWorkers,
  });
}

async function parent() {
  const { Client, Connection } = require('@temporalio/client');
  const connection = await Connection.connect({ address });
  const info = await connection.workflowService.getSystemInfo({});
  assert.equal(
    info.serverVersion,
    process.env.DRAIN_PROOF_SERVER_VERSION,
    'Explicit server version confirmation is required'
  );
  const client = new Client({ connection, namespace });
  assert.equal(require('@temporalio/worker/package.json').version, '1.15.0');
  assert.equal(require('nestjs-temporal-core/package.json').version, '3.2.3');
  const { readFileSync } = require('node:fs');
  const { createHash } = require('node:crypto');
  const managerPath = require.resolve(
    'nestjs-temporal-core/dist/services/temporal-worker.service.js'
  );
  const managerHash = createHash('sha256')
    .update(readFileSync(managerPath))
    .digest('hex');
  assert.equal(
    managerHash,
    'a223f8ff3779c49235e866d95498b6b6142e7480d88928e8eb8d6e744bcf59bb'
  );
  console.log(
    JSON.stringify({
      type: 'identities',
      namespace,
      serverVersion: info.serverVersion,
      managerHash,
      sdkVersion: '1.15.0',
      managerVersion: '3.2.3',
    })
  );
  const messages = [];
  const processChild = fork(__filename, ['child'], {
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      TMPDIR: process.env.TMPDIR,
      DRAIN_PROOF_NAMESPACE: namespace,
      NODE_OPTIONS: '--max-old-space-size=1024',
      DRAIN_PROOF_QUEUES: JSON.stringify(queues),
    },
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
  });
  const exit = once(processChild, 'exit');
  let exited = false;
  processChild.on('exit', () => {
    exited = true;
  });
  processChild.on('message', (message) => {
    messages.push({ ...message, at: Date.now() });
    console.log(JSON.stringify(message));
  });
  const waitFor = async (predicate) => {
    const deadline = Date.now() + 90000;
    while (!predicate()) {
      assert(
        !exited,
        'Worker process exited before the expected lifecycle event'
      );
      assert(Date.now() < deadline, 'Timed out waiting for lifecycle event');
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  };
  try {
    await waitFor(() => messages.some((m) => m.type === 'ready'));
    assert.equal(messages.find((m) => m.type === 'ready').workers, 32);
    await client.workflow.start('drainProof', {
      workflowId: prefix,
      taskQueue: queues[0],
      args: [queues],
      workflowExecutionTimeout: '2 minutes',
    });
    await waitFor(
      () => messages.filter((m) => m.type === 'activity-started').length === 32
    );
    const queueSet = (type) =>
      messages
        .filter((m) => m.type === type)
        .map((m) => m.queue)
        .sort();
    assert.deepEqual(queueSet('activity-started'), [...queues].sort());
    processChild.kill('SIGTERM');
    await waitFor(() => messages.some((m) => m.type === 'destroy-entered'));
    processChild.send({ type: 'release', queues: queues.slice(1) });
    await waitFor(
      () => messages.filter((m) => m.type === 'run-completed').length === 31
    );
    await new Promise((resolve) => setTimeout(resolve, 1000));
    assert(
      !exited,
      'Nest exited while main business activity was still running'
    );
    assert(
      !messages.some((m) => m.type === 'destroy-completed'),
      'Nest hook completed before main drained'
    );
    assert.deepEqual(queueSet('run-completed'), queues.slice(1).sort());
    processChild.send({ type: 'release', queues: [queues[0]] });
    const [code, signal] = await exit;
    assert.equal(code, null);
    assert.equal(signal, 'SIGTERM');
    const completed = messages.filter((m) => m.type === 'run-completed');
    assert.deepEqual(queueSet('run-completed'), [...queues].sort());
    assert.deepEqual(queueSet('activity-started'), [...queues].sort());
    assert(completed.every((m) => m.state === 'STOPPED'));
    assert(!messages.some((m) => m.type === 'run-failed'));
    assert(messages.some((m) => m.type === 'destroy-completed'));
    console.log(
      JSON.stringify({
        result: 'PASS',
        workers: 32,
        activeActivities: 32,
        delayedMain: true,
        serverVersion: info.serverVersion,
        sdkVersion: require('@temporalio/worker/package.json').version,
        managerVersion: require('nestjs-temporal-core/package.json').version,
        signal,
        code,
      })
    );
  } finally {
    // Only this harness's own child is eligible for cleanup.
    if (!exited) {
      processChild.kill('SIGKILL');
      await exit;
    }
    await connection.close();
  }
}

const childMode = process.argv[2] === 'child';
(childMode ? child() : parent()).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
