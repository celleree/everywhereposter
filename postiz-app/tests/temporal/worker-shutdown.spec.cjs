jest.mock('@temporalio/worker', () => ({
  Worker: { create: jest.fn() },
  NativeConnection: { connect: jest.fn() },
}));

const {
  TemporalWorkerManagerService: Manager,
} = require('nestjs-temporal-core');
const { Worker, NativeConnection } = require('@temporalio/worker');
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const tick = () => new Promise(setImmediate);
function worker() {
  const completion = deferred();
  let state = 'INITIALIZED';
  return {
    getState: () => state,
    run: jest.fn(() => {
      state = 'RUNNING';
      return completion.promise;
    }),
    shutdown: jest.fn(() => {
      state = 'DRAINING';
    }),
    finish: () => {
      state = 'STOPPED';
      completion.resolve();
    },
    fail: (error) => {
      state = 'FAILED';
      completion.reject(error);
    },
  };
}
function setup(count = 1, options = {}) {
  const queues = Array.from({ length: count }, (_, i) =>
    i ? `queue-${i}` : 'main'
  );
  const workers = queues.map(worker);
  const connection = { close: jest.fn(async () => {}) };
  NativeConnection.connect.mockResolvedValue(connection);
  Worker.create.mockImplementation(
    async ({ taskQueue }) => workers[queues.indexOf(taskQueue)]
  );
  const manager = new Manager(
    {
      getAllActivities: () => ({}),
      getHealthStatus: () => ({ isComplete: true }),
    },
    {
      connection: { address: 'fixture.invalid:7233' },
      workers: queues.map((taskQueue) => ({ taskQueue })),
      enableLogger: false,
      autoRestart: false,
      ...options,
    }
  );
  return { manager, workers, connection };
}
async function start(fixture) {
  await fixture.manager.onModuleInit();
  await fixture.manager.onApplicationBootstrap();
}
afterEach(() => jest.useRealTimers());

test('waits for main and all 31 activity run completions before clearing or closing', async () => {
  const f = setup(32);
  await start(f);
  let done = false;
  const closing = f.manager.onModuleDestroy().then(() => {
    done = true;
  });
  await tick();
  expect(f.workers.every((w) => w.shutdown.mock.calls.length === 1)).toBe(true);
  f.workers.slice(1).forEach((w) => w.finish());
  await tick();
  expect(done).toBe(false);
  expect(f.manager.getAllWorkers().totalWorkers).toBe(32);
  expect(f.connection.close).not.toHaveBeenCalled();
  f.workers[0].finish();
  await closing;
  expect(f.connection.close).toHaveBeenCalledTimes(1);
  expect(f.manager.getAllWorkers().totalWorkers).toBe(0);
});

test('concurrent and repeated lifecycle hooks initiate shutdown only once', async () => {
  const f = setup();
  await start(f);
  const calls = [
    f.manager.shutdown(),
    f.manager.onModuleDestroy(),
    f.manager.beforeApplicationShutdown('SIGTERM'),
  ];
  await tick();
  expect(f.workers[0].shutdown).toHaveBeenCalledTimes(1);
  f.workers[0].finish();
  await Promise.all(calls);
  await f.manager.shutdown();
  expect(f.connection.close).toHaveBeenCalledTimes(1);
});

test('startup run rejection is observed and propagated at shutdown', async () => {
  const f = setup();
  await start(f);
  f.workers[0].fail(new Error('startup run failure'));
  await tick();
  expect(f.manager.getWorkerStatusByTaskQueue('main').lastError).toBe(
    'startup run failure'
  );
  await expect(f.manager.shutdown()).rejects.toThrow('workers failed');
  expect(f.connection.close).not.toHaveBeenCalled();
});

test('waits for other drains even when one run rejects', async () => {
  const f = setup(2);
  await start(f);
  let settled = false;
  const closing = f.manager.shutdown().catch((error) => {
    settled = true;
    return error;
  });
  await tick();
  f.workers[0].fail(new Error('drain failure'));
  await tick();
  expect(settled).toBe(false);
  f.workers[1].finish();
  expect(await closing).toBeInstanceOf(AggregateError);
  expect(f.connection.close).not.toHaveBeenCalled();
});

test('shutdown during worker creation drains the newly allocated native worker', async () => {
  const f = setup();
  const creating = deferred();
  Worker.create.mockReturnValueOnce(creating.promise);
  const initialization = f.manager.onModuleInit();
  await tick();
  const closing = f.manager.shutdown();
  await tick();
  expect(f.connection.close).not.toHaveBeenCalled();
  creating.resolve(f.workers[0]);
  await initialization;
  await tick();
  expect(f.workers[0].run).toHaveBeenCalledTimes(1);
  expect(f.workers[0].shutdown).toHaveBeenCalledTimes(1);
  f.workers[0].finish();
  await closing;
  await f.manager.onApplicationBootstrap();
  expect(f.manager.getAllWorkers().totalWorkers).toBe(0);
});

test('shutdown during connection creation prevents later worker admission', async () => {
  const f = setup();
  const connecting = deferred();
  NativeConnection.connect.mockReturnValueOnce(connecting.promise);
  const initialization = f.manager.onModuleInit();
  const observed = initialization.catch((error) => error);
  const closing = f.manager.shutdown();
  connecting.resolve(f.connection);
  await expect(observed).resolves.toBeInstanceOf(Error);
  await closing;
  expect(Worker.create).not.toHaveBeenCalled();
  expect(f.connection.close).toHaveBeenCalledTimes(1);
});

test('timeout rejects every shutdown hook without clearing pending workers', async () => {
  jest.useFakeTimers();
  const f = setup(1, { shutdownTimeout: 20 });
  await start(f);
  const closing = expect(f.manager.onModuleDestroy()).rejects.toThrow(
    'drain is not complete'
  );
  await jest.advanceTimersByTimeAsync(20);
  await closing;
  expect(f.manager.getAllWorkers().totalWorkers).toBe(1);
  expect(f.connection.close).not.toHaveBeenCalled();
  await expect(f.manager.beforeApplicationShutdown()).rejects.toThrow(
    'drain is not complete'
  );
  f.workers[0].finish();
  await jest.advanceTimersByTimeAsync(0);
  expect(f.connection.close).toHaveBeenCalledTimes(1);
});

test('queued auto-restart cannot create a worker after terminal shutdown', async () => {
  jest.useFakeTimers();
  const f = setup(1, { autoRestart: true });
  await start(f);
  f.workers[0].fail(new Error('run failed'));
  await jest.advanceTimersByTimeAsync(0);
  await expect(f.manager.shutdown()).rejects.toThrow('workers failed');
  await jest.advanceTimersByTimeAsync(2000);
  expect(Worker.create).toHaveBeenCalledTimes(1);
});

test('normal auto-restart remains available before terminal shutdown', async () => {
  jest.useFakeTimers();
  const f = setup(1, { autoRestart: true });
  await start(f);
  const replacement = worker();
  Worker.create.mockResolvedValueOnce(replacement);
  f.workers[0].fail(new Error('recoverable'));
  await jest.advanceTimersByTimeAsync(1600);
  expect(replacement.run).toHaveBeenCalledTimes(1);
  const closing = f.manager.shutdown();
  await jest.advanceTimersByTimeAsync(0);
  replacement.finish();
  await closing;
});

test('stop waits for completion before declaring the worker not running', async () => {
  const f = setup();
  await start(f);
  const stopping = f.manager.stopWorkerByTaskQueue('main');
  await tick();
  expect(f.manager.getWorkerStatusByTaskQueue('main').isRunning).toBe(true);
  f.workers[0].finish();
  await stopping;
  expect(f.manager.getWorkerStatusByTaskQueue('main').isRunning).toBe(false);
  await f.manager.shutdown();
});

test('legacy deferred startup cannot escape shutdown', async () => {
  const f = setup();
  f.manager.worker = f.workers[0];
  const starting = f.manager.startWorker();
  const closing = f.manager.shutdown();
  await tick();
  f.workers[0].finish();
  await Promise.all([starting, closing]);
  expect(f.workers[0].run).toHaveBeenCalledTimes(1);
  expect(f.workers[0].shutdown).toHaveBeenCalledTimes(1);
});

test('connection-close failures propagate and are not retried as a successful shutdown', async () => {
  const f = setup();
  await start(f);
  f.connection.close.mockRejectedValue(new Error('close failure'));
  const closing = f.manager.shutdown();
  await tick();
  f.workers[0].finish();
  await expect(closing).rejects.toThrow('close failure');
  await expect(f.manager.shutdown()).rejects.toThrow('close failure');
  expect(f.connection.close).toHaveBeenCalledTimes(1);
});

test('real Nest app.close waits for every worker lifecycle completion', async () => {
  const { Module } = require('@nestjs/common');
  const { NestFactory } = require('@nestjs/core');
  const f = setup(32);
  class TestModule {}
  Module({ providers: [{ provide: Manager, useValue: f.manager }] })(
    TestModule
  );
  const app = await NestFactory.createApplicationContext(TestModule, {
    logger: false,
  });
  let closed = false;
  const closing = app.close().then(() => {
    closed = true;
  });
  await tick();
  f.workers.slice(1).forEach((w) => w.finish());
  await tick();
  expect(closed).toBe(false);
  f.workers[0].finish();
  await closing;
  expect(closed).toBe(true);
});
