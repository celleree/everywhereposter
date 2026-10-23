// Preloaded before Jest: permit only the disposable PostgreSQL TCP endpoint.
const net = require('node:net');
const connect = net.Socket.prototype.connect;
let blocked = false;
net.Socket.prototype.connect = function (...args) {
  let options = Array.isArray(args[0]) ? args[0][0] : args[0];
  if (typeof options !== 'object' || options === null) {
    options = { port: args[0], host: typeof args[1] === 'string' ? args[1] : '127.0.0.1' };
  }
  if (options.path || !['127.0.0.1', '::1'].includes(options.host) ||
      String(options.port) !== process.env.EP_OFFLINE_PG_PORT) {
    blocked = true;
    throw Error('Offline acceptance blocked non-fixture network access.');
  }
  return connect.apply(this, args);
};
process.on('exit', () => { if (blocked) process.exitCode = 1; });
