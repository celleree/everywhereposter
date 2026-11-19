const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');

test('child exits on parent disconnect while workflow bundling is pending', () => {
  const fakeProcess = new EventEmitter();
  fakeProcess.argv = ['node', 'native-shutdown.cjs', 'child'];
  fakeProcess.env = {
    DRAIN_PROOF_NAMESPACE: 'drain-proof-00000000-0000-0000-0000-000000000000',
    DRAIN_PROOF_QUEUES: '[]',
  };
  fakeProcess.connected = true;
  fakeProcess.exit = jest.fn();
  const bundleWorkflowCode = jest.fn(() => new Promise(() => {}));
  const fakeRequire = (name) => {
    if (name === '@nestjs/common') return { Module: jest.fn() };
    if (name === '@nestjs/core') return { NestFactory: {} };
    if (name === 'nestjs-temporal-core')
      return { TemporalWorkerManagerService: jest.fn() };
    if (name === '@temporalio/worker') return { bundleWorkflowCode };
    if (name.startsWith('node:')) return require(name);
    throw new Error('Unexpected fixture import: ' + name);
  };
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, 'native-shutdown.cjs'), 'utf8'),
    { require: fakeRequire, process: fakeProcess, __dirname, console },
    { timeout: 1000 }
  );
  expect(bundleWorkflowCode).toHaveBeenCalledTimes(1);
  fakeProcess.emit('disconnect');
  expect(fakeProcess.exit).toHaveBeenCalledWith(1);
});
