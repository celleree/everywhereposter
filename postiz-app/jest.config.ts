export default {
  // Keep each suite's environment, transforms, and mocks in its focused config.
  // Jest only accepts testTimeout globally when running multiple projects.
  testTimeout: 20000,
  projects: [
    '<rootDir>/jest.copy-generation.config.cjs',
    '<rootDir>/jest.knowledge-base.config.cjs',
    '<rootDir>/jest.post-set-review.config.cjs',
    '<rootDir>/jest.published-posts.config.cjs',
    '<rootDir>/jest.sentry.config.cjs',
  ].map((configPath) => {
    const { testTimeout, ...project } = require(
      configPath.replace('<rootDir>', __dirname)
    );
    return project;
  }),
};
