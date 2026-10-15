# Jest tests

From `postiz-app`, install the pinned dependencies and run the default entrypoint:

```sh
pnpm install --frozen-lockfile
pnpm test --showConfig
pnpm test --runInBand
```

The default config loads the maintained copy-generation, knowledge-base,
frontend post-set review, published-posts, and Sentry configs. Each keeps its own
environment, transforms, and mocks.
The combined run uses a global 20-second test timeout; focused commands retain
their existing timeout settings.

To run a single suite through that entrypoint:

```sh
pnpm test --runInBand --runTestsByPath tests/sentry/initialize.sentry.spec.ts
```

Existing focused commands remain supported, for example:

```sh
pnpm exec jest --config jest.copy-generation.config.cjs --runInBand
```

Creator Audit uses the published-posts config with an explicit match override:

```sh
pnpm exec jest --config jest.published-posts.config.cjs --testMatch '**/tests/creator-audit/**/*.spec.ts' --runInBand
```

Browser tests use Playwright separately; see [browser/README.md](browser/README.md).
