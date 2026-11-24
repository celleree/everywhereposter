const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync(__dirname + '/network-guard.cjs', 'utf8');
function guard() {
  const calls = [];
  const net = { Socket: function () {} };
  net.Socket.prototype.connect = function (...args) { calls.push(args); return this; };
  vm.runInNewContext(source, { require(name) { assert.equal(name, 'node:net'); return net; }, Map, Number, Error });
  return { socket: new net.Socket(), calls };
}
test('only owned exact service/port pairs can connect', () => {
  const { socket, calls } = guard();
  for (const [host, port] of [['qa-postgres', 5432], ['qa-redis', 6379], ['qa-temporal', 7233], ['qa-backend', 3000], ['127.0.0.1', 4317]]) socket.connect({ host, port });
  assert.equal(calls.length, 5);
});
test('internet, host gateway, wrong ports, and arbitrary IPC fail closed', () => {
  const { socket, calls } = guard();
  for (const options of [{ host: 'example.com', port: 443 }, { host: '172.17.0.1', port: 5432 }, { host: 'qa-postgres', port: 443 }, { path: '/var/run/docker.sock' }]) assert.throws(() => socket.connect(options), /blocked/);
  assert.equal(calls.length, 0);
});
test('Next temporary worker IPC remains local and permitted', () => {
  const { socket, calls } = guard();
  socket.connect({ path: '/tmp/next-worker.sock' });
  assert.equal(calls.length, 1);
});
