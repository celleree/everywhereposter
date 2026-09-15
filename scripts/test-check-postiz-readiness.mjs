#!/usr/bin/env node

import assert from 'node:assert/strict';
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

test('accepts the complete ready state', async () => {
  await runWithServer();
});

test('rejects an incorrect backend response', async () => {
  await assert.rejects(runWithServer({ '/api/': { body: 'wrong' } }), /backend readiness response/);
});

test('rejects an unhealthy orchestrator', async () => {
  await assert.rejects(
    runWithServer({ '/health/status': { status: 500, body: '{"status":"error"}' } }),
    /orchestrator was not ready/
  );
});

test('bounds a hanging frontend probe', async () => {
  await assert.rejects(runWithServer({ '/auth/login': { hang: true } }, {}, 50), /frontend timed out/);
});

test('rejects an unavailable frontend', async () => {
  await assert.rejects(runWithServer({ '/auth/login': { status: 503 } }), /frontend login page was not ready/);
});

test('rejects database and Redis dependency failures', async (t) => {
  await t.test('database', async () => {
    await assert.rejects(
      runWithServer({}, { prisma: { $queryRawUnsafe: async () => { throw new Error('database unavailable'); } } }),
      /database unavailable/
    );
  });
  await t.test('Redis', async () => {
    await assert.rejects(runWithServer({}, { redis: { ping: async () => 'NOPE' } }), /unexpected PING/);
  });
});
