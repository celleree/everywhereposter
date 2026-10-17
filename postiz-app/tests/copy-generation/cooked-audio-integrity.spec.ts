import { execFileSync } from 'child_process';
import { join } from 'path';

describe('source-plan audio authority against real media corruption', () => {
  it('accepts exact source complements and rejects forged plans, payloads, timing and receipts', () => {
    expect(() => execFileSync('python3', ['-I', join(__dirname, 'fixtures/cooked-audio-integrity.test.py')], {
      timeout: 180_000, maxBuffer: 1024 * 1024,
    })).not.toThrow();
  }, 190_000);
});
