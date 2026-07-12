import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const files = {
  listmonk: new URL(
    '../../libraries/nestjs-libraries/src/integrations/social/listmonk.provider.ts',
    import.meta.url
  ),
  sentry: new URL(
    '../../libraries/nestjs-libraries/src/sentry/initialize.sentry.ts',
    import.meta.url
  ),
  publicApi: new URL(
    '../../apps/backend/src/public-api/routes/v1/public.integrations.controller.ts',
    import.meta.url
  ),
  publicRoutes: new URL(
    '../../apps/backend/src/api/routes/public.controller.ts',
    import.meta.url
  ),
};

test('immediate server-side sensitive logging remains disabled', async () => {
  const sources = Object.fromEntries(
    await Promise.all(
      Object.entries(files).map(async ([name, url]) => [
        name,
        await readFile(url, 'utf8'),
      ])
    )
  );

  assert.doesNotMatch(sources.listmonk, /console\.log\(body\)/);
  assert.doesNotMatch(
    sources.publicApi,
    /console\.log\(JSON\.stringify\(body,\s*null,\s*2\)\)/
  );
  assert.doesNotMatch(
    sources.publicRoutes,
    /console\.log\(['"]cryptoPost['"],\s*body,\s*path\)/
  );
  assert.doesNotMatch(sources.sentry, /consoleLoggingIntegration\s*\(/);
  assert.match(sources.sentry, /recordInputs:\s*false/);
  assert.match(sources.sentry, /recordOutputs:\s*false/);
  assert.match(sources.sentry, /enableLogs:\s*false/);
});
