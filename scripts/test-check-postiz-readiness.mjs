#!/usr/bin/env node

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createServer } from 'node:http';
import test from 'node:test';
import { checkPostizReadiness } from './check-postiz-readiness.mjs';
async function withServer(handler, run) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}
function dependencies(overrides = {}) {
  return {
    createPrisma: async () => ({
      $queryRawUnsafe: async () => [{ ready: 1 }],
      $disconnect: async () => {},
      ...overrides.prisma,
    }),
    createRedis: async () => ({
      on: () => {},
      connect: async () => {},
      ping: async () => 'PONG',
      disconnect: () => {},
      ...overrides.redis,
    }),
  };
}
function appHandler(overrides = {}) {
  return (request, response) => {
    const route = overrides[request.url];
    if (route?.hang) return;
    response.statusCode = route?.status ?? 200;
    if (request.url === '/api/') return response.end(route?.body ?? 'App is running!');
    if (request.url === '/auth/login') return response.end(route?.body ?? '<h1>Sign In</h1>');
    if (request.url === '/health/status') {
      response.statusCode = route?.status ?? 200;
      return response.end(route?.body ?? '{"status":"ok"}');
    }
    response.statusCode = 404;
    response.end();
  };
}
async function runWithServer(overrides = {}, dependencyOverrides = {}, timeoutMs = 500) {
  return withServer(appHandler(overrides), (baseUrl) => checkPostizReadiness({
    baseUrl,
    orchestratorUrl: `${baseUrl}/health/status`,
    timeoutMs,
    ...dependencies(dependencyOverrides),
  }));
}
function rejectsSafely(promise, code, secret) {
  return assert.rejects(promise, (error) =>
    error.message.includes(code) && (!secret || !error.message.includes(secret))
  );
}

test('accepts the complete ready state', () => runWithServer());
test('rejects an incorrect backend response', () =>
  assert.rejects(runWithServer({ '/api/': { body: 'wrong' } }), /backend:unexpected_response/));
test('rejects an unhealthy orchestrator', () => assert.rejects(
  runWithServer({ '/health/status': { status: 500, body: '{"status":"error"}' } }),
  /orchestrator:unexpected_response/
));
test('bounds a hanging frontend probe', () =>
  assert.rejects(runWithServer({ '/auth/login': { hang: true } }, {}, 50), /frontend:timeout/));
test('rejects an unavailable frontend', () =>
  assert.rejects(runWithServer({ '/auth/login': { status: 503 } }), /frontend:unexpected_response/));

test('uses ORCHESTRATOR_PORT for the default orchestrator probe', () =>
  withServer(appHandler(), (baseUrl) =>
    withServer(appHandler(), async (orchestratorBaseUrl) => {
      const previous = process.env.ORCHESTRATOR_PORT;
      process.env.ORCHESTRATOR_PORT = new URL(orchestratorBaseUrl).port;
      try {
        await checkPostizReadiness({ baseUrl, timeoutMs: 500, ...dependencies() });
      } finally {
        if (previous === undefined) delete process.env.ORCHESTRATOR_PORT;
        else process.env.ORCHESTRATOR_PORT = previous;
      }
    })
  )
);

test('rejects database and Redis dependency failures', async (t) => {
  await t.test('database', () => assert.rejects(
      runWithServer({}, { prisma: { $queryRawUnsafe: async () => { throw new Error('database unavailable'); } } }),
      /database:failed/
  ));
  await t.test('Redis', () => assert.rejects(
    runWithServer({}, { redis: { ping: async () => 'NOPE' } }), /redis:unexpected_ping_response/
  ));
});

test('does not disclose SDK error messages or ioredis error events', async () => {
  const credential = 'postgresql://user:review-secret@example.invalid/database';
  await rejectsSafely(checkPostizReadiness({
    fetchImpl: async () => { throw new Error(credential); }, timeoutMs: 500, ...dependencies(),
  }), 'backend:failed', credential);
  await rejectsSafely(
    runWithServer({}, { prisma: { $queryRawUnsafe: async () => { throw new Error(credential); } } }),
    'database:failed', credential
  );

  const redis = Object.assign(new EventEmitter(), {
    connect: async function () {
      assert.equal(this.listenerCount('error'), 1);
      this.emit('error', new Error(credential));
      throw new Error(credential);
    },
    ping: async () => 'PONG',
    disconnect: () => {},
  });
  await withServer(appHandler(), (baseUrl) => rejectsSafely(checkPostizReadiness({
    baseUrl, orchestratorUrl: `${baseUrl}/health/status`, timeoutMs: 500,
    ...dependencies(), createRedis: async () => redis,
  }), 'redis:failed', credential));
});
