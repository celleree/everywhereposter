// Loaded only by the disposable frontend process, never by the real backend.
const net = require('node:net');
const original = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  let options = args[0];
  if (Array.isArray(options)) options = options[0];
  const host = typeof options === 'object' ? options.host : typeof args[1] === 'string' ? args[1] : undefined;
  const port = Number(typeof options === 'object' ? options.port : options);
  const path = typeof options === 'object' ? options.path : typeof options === 'string' && Number.isNaN(Number(options)) ? options : undefined;
  if (!path && ((host && !['127.0.0.1', 'localhost', '::1'].includes(host)) || ![4217, 4218].includes(port))) {
    throw new Error('Browser fixture runtime blocked a destination outside its owned ports');
  }
  return original.apply(this, args);
};
