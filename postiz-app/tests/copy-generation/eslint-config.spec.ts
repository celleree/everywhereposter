import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

it('loads the native Next flat configs with their rules, overrides and ignores', () => {
  const script = `
    import assert from 'node:assert/strict';
    import eslint from 'eslint/use-at-your-own-risk';
    import nextVitals from 'eslint-config-next/core-web-vitals';
    import nextTypescript from 'eslint-config-next/typescript';

    const overrides = {
      'react/no-unescaped-entities': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      'react/display-name': 'off',
      '@typescript-eslint/ban-ts-comment': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/prefer-as-const': 'off',
      '@typescript-eslint/no-non-null-asserted-optional-chain': 'off',
    };
    const actual = new eslint.FlatESLint();
    const reference = new eslint.FlatESLint({
      overrideConfigFile: true,
      overrideConfig: [...nextVitals, ...nextTypescript, { rules: overrides }],
    });
    const fixtures = [
      {
        filePath: 'apps/frontend/eslint-regression.tsx',
        source: 'import { useState } from "react"; export function Example({ ready }: { ready: boolean }) { if (ready) { useState(0); } return <img src="/test.png" alt="test" />; }',
        expectedRules: [['react-hooks/rules-of-hooks', 2], ['@next/next/no-img-element', 1]],
      },
      {
        filePath: 'apps/frontend/eslint-regression.ts',
        source: 'export const values: number[] = new Array(1, 2);',
        expectedRules: [['@typescript-eslint/no-array-constructor', 2]],
      },
      {
        filePath: 'apps/frontend/eslint-regression.js',
        source: 'export const value = 1;',
        expectedRules: [],
      },
    ];
    for (const { filePath, source, expectedRules } of fixtures) {
      assert.equal(await actual.isPathIgnored(filePath), false, filePath);
      const config = await actual.calculateConfigForFile(filePath);
      const expected = await reference.calculateConfigForFile(filePath);
      assert.deepEqual(config.rules, expected.rules, filePath);
      for (const name of Object.keys(overrides)) {
        assert.equal(config.rules[name][0], 0, name);
      }
      assert.equal(config.rules['@next/next/no-html-link-for-pages'][0], 2);
      const results = await actual.lintText(source, { filePath });
      assert.equal(results.length, 1, filePath);
      assert.equal(results[0].fatalErrorCount, 0, JSON.stringify(results[0].messages));
      for (const [ruleId, severity] of expectedRules) {
        assert.ok(results[0].messages.some(message =>
          message.ruleId === ruleId && message.severity === severity), ruleId);
      }
      if (!expectedRules.length) {
        assert.deepEqual(results[0].messages, []);
      }
    }
    for (const filePath of [
      'node_modules/ignored.ts',
      'apps/frontend/node_modules/ignored.ts',
      '.next/ignored.ts',
      'out/ignored.ts',
      'build/ignored.ts',
      'next-env.d.ts',
    ]) {
      assert.equal(await actual.isPathIgnored(filePath), true, filePath);
    }
    process.stdout.write('ESLint config regression passed');
  `;
  expect(execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: resolve(__dirname, '../..'),
    encoding: 'utf8',
    timeout: 10000,
  })).toBe('ESLint config regression passed');
});
