import { execFileSync } from 'child_process';
import { resolve } from 'path';

it('passes upload recovery regressions against the installed Uppy transport without network access', () => {
  const output = execFileSync(process.execPath, [
    '--test', resolve(__dirname, '../upload/stall-recovery.test.cjs'),
  ], { encoding: 'utf8', timeout: 15_000 });
  expect(output).toContain('# fail 0');
});
