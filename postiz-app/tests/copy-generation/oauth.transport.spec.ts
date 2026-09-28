import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

it('verifies the real OAuth MCP wire schema, scope isolation, listing and file-error redaction', () => {
  const output = execFileSync(process.execPath, [
    '-r', 'ts-node/register/transpile-only', '-r', 'tsconfig-paths/register',
    'tests/copy-generation/fixtures/oauth-transport.cjs',
  ], {
    cwd: resolve(__dirname, '../..'), encoding: 'utf8', timeout: 60000,
    env: { ...process.env, REDIS_URL: '', DATABASE_URL: '',
      NEXT_PUBLIC_BACKEND_URL: 'https://server.test/api', FRONTEND_URL: 'https://server.test',
      TS_NODE_PROJECT: 'tsconfig.base.json', TS_NODE_COMPILER_OPTIONS: '{"module":"commonjs"}',
    },
  });
  expect(output).toContain('OAuth MCP wire assertions passed');
}, 65000);
