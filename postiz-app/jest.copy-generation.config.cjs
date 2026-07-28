const { pathsToModuleNameMapper } = require('ts-jest');
const { compilerOptions } = require('./tsconfig.base.json');

module.exports = {
  rootDir: __dirname,
  testEnvironment: 'node',
  clearMocks: true,
  testTimeout: 20000,
  setupFiles: ['reflect-metadata'],
  testMatch: ['<rootDir>/tests/copy-generation/**/*.spec.ts'],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: {
          ...compilerOptions,
          module: 'commonjs',
          isolatedModules: true,
        },
        diagnostics: false,
      },
    ],
  },
  moduleNameMapper: {
    '^nostr-tools$': '<rootDir>/tests/copy-generation/mocks/nostr-tools.ts',
    ...pathsToModuleNameMapper(compilerOptions.paths, {
      prefix: '<rootDir>/',
    }),
  },
  modulePathIgnorePatterns: ['<rootDir>/node_modules', '<rootDir>/apps/.*/dist'],
};
