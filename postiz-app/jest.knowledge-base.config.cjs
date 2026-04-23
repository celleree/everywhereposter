const { pathsToModuleNameMapper } = require('ts-jest');
const { compilerOptions } = require('./tsconfig.base.json');

module.exports = {
  rootDir: __dirname,
  testEnvironment: 'node',
  clearMocks: true,
  testTimeout: 20000,
  setupFiles: ['reflect-metadata'],
  testMatch: ['<rootDir>/tests/knowledge-base/**/*.spec.ts'],
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
  moduleNameMapper: pathsToModuleNameMapper(compilerOptions.paths, {
    prefix: '<rootDir>/',
  }),
  modulePathIgnorePatterns: ['<rootDir>/node_modules', '<rootDir>/apps/.*/dist'],
};
