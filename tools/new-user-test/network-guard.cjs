// Task-local development processes only. Never preload into the deployed app.
const net = require('node:net');
const connect = net.Socket.prototype.connect;
const allowed = new Map([
  ['qa-postgres', [5432]], ['qa-redis', [6379]],
  ['qa-temporal', [7233]], ['qa-backend', [3000]],
  ['localhost', [3000, 4317]], ['127.0.0.1', [3000, 4317]],
  ['::1', [3000, 4317]],
]);
net.Socket.prototype.connect = function (...args) {
  let options = args[0];
  if (Array.isArray(options)) options = options[0];
  const host = typeof options === 'object' ? options.host : typeof args[1] === 'string' ? args[1] : 'localhost';
  const port = Number(typeof options === 'object' ? options.port : options);
  const socket = typeof options === 'object' ? options.path : typeof options === 'string' && !Number.isFinite(port) ? options : undefined;
  if (socket) {
    if (!socket.startsWith('/tmp/')) throw new Error('New-user fixture blocked non-temporary IPC');
  } else if (!allowed.get(host || 'localhost')?.includes(port)) {
    throw new Error('New-user fixture blocked an unowned network destination');
  }
  return connect.apply(this, args);
};
