// Loaded only by the disposable frontend process, never by the real backend.
const net = require('node:net');
const original = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  let options = args[0];
  if (Array.isArray(options)) options = options[0];
  const host = typeof options === 'object' ? options.host : typeof args[1] === 'string' ? args[1] : undefined;
  const port = Number(typeof options === 'object' ? options.port : options);
  const path = typeof options === 'object' ? options.path : typeof options === 'string' && Number.isNaN(Number(options)) ? options : undefined;
  const studio = process.env.EP_STUDIO_BROWSER === '1';
  const fixtureDb = studio && process.env.STUDIO_BROWSER_DATABASE_URL === 'postgresql://isolated:isolated@127.0.0.1:55462/isolated' && host === '127.0.0.1' && port === 55462;
  if (studio && path && path !== process.env.COOKED_EDITOR_SOCKET) throw new Error('Studio fixture blocked an unowned socket');
  if (!path && !fixtureDb && ((host && !['127.0.0.1', 'localhost', '::1'].includes(host)) || ![Number(process.env.BROWSER_FRONTEND_PORT || 4217), Number(process.env.BROWSER_API_PORT || 4218)].includes(port))) {
    throw new Error('Browser fixture runtime blocked a destination outside its owned ports');
  }
  return original.apply(this, args);
};
