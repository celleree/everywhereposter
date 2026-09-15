#!/usr/bin/env node

import { pathToFileURL } from 'node:url';
const DEFAULT_TIMEOUT_MS = 15_000;
class ReadinessError extends Error {}
const safeError = (code) => new ReadinessError(code);
function remaining(deadline) {
  return Math.max(0, deadline - Date.now());
}
async function beforeDeadline(promise, label, deadline) {
  const timeoutMs = remaining(deadline);
  if (timeoutMs === 0) {
    throw safeError(`${label}:timeout`);
  }

  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(safeError(`${label}:timeout`)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
async function probeHttp(fetchImpl, url, label, deadline, validate) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), remaining(deadline));
  try {
    const response = await beforeDeadline(
      fetchImpl(url, { signal: controller.signal }),
      label,
      deadline
    );
    const body = await beforeDeadline(response.text(), label, deadline);
    validate(response.status, body);
  } catch (error) {
    if (controller.signal.aborted) {
      throw safeError(`${label}:timeout`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
async function defaultPrismaFactory() {
  const { PrismaClient } = await import('@prisma/client');
  return new PrismaClient();
}
async function defaultRedisFactory(deadline) {
  const { Redis } = await import('ioredis');
  if (!process.env.REDIS_URL) {
    throw safeError('redis:missing_config');
  }
  return new Redis(process.env.REDIS_URL, {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 0,
    connectTimeout: remaining(deadline),
    commandTimeout: remaining(deadline),
    retryStrategy: () => null,
  });
}
async function probeDatabase(createPrisma, deadline) {
  const prisma = await beforeDeadline(createPrisma(), 'database', deadline);
  try {
    await beforeDeadline(prisma.$queryRawUnsafe('SELECT 1'), 'database', deadline);
  } finally {
    await beforeDeadline(prisma.$disconnect(), 'database disconnect', deadline).catch(() => {});
  }
}
async function probeRedis(createRedis, deadline) {
  const redis = await beforeDeadline(createRedis(deadline), 'redis', deadline);
  redis.on('error', () => {});
  try {
    await beforeDeadline(redis.connect(), 'redis', deadline);
    const reply = await beforeDeadline(redis.ping(), 'redis', deadline);
    if (reply !== 'PONG') {
      throw safeError('redis:unexpected_ping_response');
    }
  } finally {
    redis.disconnect();
  }
}
async function safeProbe(label, probe) {
  try {
    await probe();
  } catch (error) {
    if (error instanceof ReadinessError) throw error;
    throw safeError(`${label}:failed`);
  }
}
export async function checkPostizReadiness(options = {}) {
  const timeoutMs = options.timeoutMs ?? Number(process.env.READINESS_PROBE_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error('READINESS_PROBE_TIMEOUT_MS must be a positive number');
  }

  const deadline = Date.now() + timeoutMs;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const baseUrl = options.baseUrl ?? 'http://127.0.0.1:5000';
  const orchestratorPort = String(options.orchestratorPort ?? process.env.ORCHESTRATOR_PORT ?? '3002');
  if (!/^\d+$/.test(orchestratorPort) || Number(orchestratorPort) < 1 || Number(orchestratorPort) > 65_535) {
    throw safeError('orchestrator:invalid_port');
  }
  const orchestratorUrl = options.orchestratorUrl ?? `http://127.0.0.1:${orchestratorPort}/health/status`;
  const checks = [
    safeProbe('backend', () => probeHttp(fetchImpl, `${baseUrl}/api/`, 'backend', deadline, (status, body) => {
      if (status !== 200 || body !== 'App is running!') throw safeError('backend:unexpected_response');
    })),
    safeProbe('frontend', () => probeHttp(fetchImpl, `${baseUrl}/auth/login`, 'frontend', deadline, (status, body) => {
      if (status !== 200 || !body.includes('Sign In')) throw safeError('frontend:unexpected_response');
    })),
    safeProbe('orchestrator', () => probeHttp(fetchImpl, orchestratorUrl, 'orchestrator', deadline, (status, body) => {
      let parsed;
      try { parsed = JSON.parse(body); } catch { throw safeError('orchestrator:invalid_json'); }
      if (status !== 200 || parsed?.status !== 'ok') throw safeError('orchestrator:unexpected_response');
    })),
    safeProbe('database', () => probeDatabase(options.createPrisma ?? defaultPrismaFactory, deadline)),
    safeProbe('redis', () => probeRedis(options.createRedis ?? defaultRedisFactory, deadline)),
  ];

  const results = await Promise.allSettled(checks);
  const failures = results.filter(({ status }) => status === 'rejected');
  if (failures.length) {
    throw safeError(failures.map(({ reason }) => reason.message).join('; '));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  checkPostizReadiness().then(
    () => { console.log('Postiz readiness checks passed.'); process.exit(0); },
    (error) => { console.error(`Postiz readiness checks failed: ${error.message}`); process.exit(1); }
  );
}
