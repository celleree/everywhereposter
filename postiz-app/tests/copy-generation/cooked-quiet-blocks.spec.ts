import { execFileSync } from 'child_process';
import { join } from 'path';

describe('native quiet-block source-time contract', () => {
  it('rejects unsupported word/range changes and audits final A/V against the exact plan', () => {
    expect(() => execFileSync('python3', ['-I', join(__dirname, 'fixtures/quiet-block-contract.test.py')], {
      timeout: 10_000, maxBuffer: 1024 * 1024,
    })).not.toThrow();
  });
});
