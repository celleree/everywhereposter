const { pathsToModuleNameMapper } = require('ts-jest');
const { compilerOptions } = require('./tsconfig.base.json');

module.exports = {
  rootDir: __dirname,
  testEnvironment: 'jsdom',
  clearMocks: true,
  testTimeout: 20000,
  setupFiles: ['reflect-metadata'],
  setupFilesAfterEnv: ['<rootDir>/tests/frontend/jest.setup.ts'],
  testMatch: ['<rootDir>/tests/frontend/**/*.spec.tsx'],
  transform: {
    '^.+\\.[tj]sx?$': [
      'ts-jest',
      {
        tsconfig: {
          ...compilerOptions,
          module: 'commonjs',
          jsx: 'react-jsx',
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
