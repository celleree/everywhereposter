#!/usr/bin/env node

import { pathToFileURL } from 'node:url';

const DEFAULT_TIMEOUT_MS = 15_000;

function remaining(deadline) {
  return Math.max(0, deadline - Date.now());
}

async function beforeDeadline(promise, label, deadline) {
  const timeoutMs = remaining(deadline);
  if (timeoutMs === 0) {
    throw new Error(`${label} timed out`);
  }

  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs);
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
      throw new Error(`${label} timed out`);
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
    throw new Error('REDIS_URL is required');
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
  const redis = await beforeDeadline(createRedis(deadline), 'Redis', deadline);
  try {
    await beforeDeadline(redis.connect(), 'Redis', deadline);
    const reply = await beforeDeadline(redis.ping(), 'Redis', deadline);
    if (reply !== 'PONG') {
      throw new Error('Redis returned an unexpected PING response');
    }
  } finally {
    redis.disconnect();
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
  const orchestratorUrl = options.orchestratorUrl ?? 'http://127.0.0.1:3002/health/status';
  const checks = [
    probeHttp(fetchImpl, `${baseUrl}/api/`, 'backend', deadline, (status, body) => {
      if (status !== 200 || body !== 'App is running!') throw new Error('backend readiness response did not match');
    }),
    probeHttp(fetchImpl, `${baseUrl}/auth/login`, 'frontend', deadline, (status, body) => {
      if (status !== 200 || !body.includes('Sign In')) throw new Error('frontend login page was not ready');
    }),
    probeHttp(fetchImpl, orchestratorUrl, 'orchestrator', deadline, (status, body) => {
      let parsed;
      try { parsed = JSON.parse(body); } catch { throw new Error('orchestrator returned invalid JSON'); }
      if (status !== 200 || parsed?.status !== 'ok') throw new Error('orchestrator was not ready');
    }),
    probeDatabase(options.createPrisma ?? defaultPrismaFactory, deadline),
    probeRedis(options.createRedis ?? defaultRedisFactory, deadline),
  ];

  const results = await Promise.allSettled(checks);
  const failures = results.filter(({ status }) => status === 'rejected');
  if (failures.length) {
    throw new Error(failures.map(({ reason }) => reason?.message || String(reason)).join('; '));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  checkPostizReadiness().then(
    () => { console.log('Postiz readiness checks passed.'); process.exit(0); },
    (error) => { console.error(`Postiz readiness checks failed: ${error.message}`); process.exit(1); }
  );
}
