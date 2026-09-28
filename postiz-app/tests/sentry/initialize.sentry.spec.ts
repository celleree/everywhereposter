const sentryInit = jest.fn();
const openAIIntegration = jest.fn(() => ({ name: 'openai' }));
const nodeProfilingIntegration = jest.fn(() => ({ name: 'profiling' }));

let profilingModuleEvaluations = 0;

const loadInitializeSentry = () => {
  let initializeSentry: (appName: string, allowLogs?: boolean) => boolean | null;

  jest.isolateModules(() => {
    jest.doMock('@sentry/nestjs', () => ({
      init: sentryInit,
      openAIIntegration,
    }));
    jest.doMock('@sentry/profiling-node', () => {
      profilingModuleEvaluations += 1;
      return { nodeProfilingIntegration };
    });

    initializeSentry = require('@gitroom/nestjs-libraries/sentry/initialize.sentry').initializeSentry;
  });

  return initializeSentry!;
};

describe('initializeSentry', () => {
  const originalDsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  const originalNodeEnv = process.env.NODE_ENV;
  const originalSpotlight = process.env.SENTRY_SPOTLIGHT;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    profilingModuleEvaluations = 0;
    delete process.env.NEXT_PUBLIC_SENTRY_DSN;
    process.env.NODE_ENV = 'test';
    delete process.env.SENTRY_SPOTLIGHT;
  });

  afterAll(() => {
    restoreEnv('NEXT_PUBLIC_SENTRY_DSN', originalDsn);
    restoreEnv('NODE_ENV', originalNodeEnv);
    restoreEnv('SENTRY_SPOTLIGHT', originalSpotlight);
  });

  it('does not load the profiler or initialize Sentry when the DSN is absent', () => {
    const initializeSentry = loadInitializeSentry();

    expect(initializeSentry('orchestrator')).toBeNull();
    expect(profilingModuleEvaluations).toBe(0);
    expect(nodeProfilingIntegration).not.toHaveBeenCalled();
    expect(sentryInit).not.toHaveBeenCalled();
  });

  it('loads the profiler and preserves Sentry profiling configuration when the DSN is present', () => {
    process.env.NEXT_PUBLIC_SENTRY_DSN = 'https://public@example.ingest.sentry.io/1';
    process.env.NODE_ENV = 'production';
    process.env.SENTRY_SPOTLIGHT = '1';
    const initializeSentry = loadInitializeSentry();

    expect(initializeSentry('orchestrator')).toBe(true);
    expect(profilingModuleEvaluations).toBe(1);
    expect(nodeProfilingIntegration).toHaveBeenCalledTimes(1);
    expect(openAIIntegration).toHaveBeenCalledWith({
      recordInputs: false,
      recordOutputs: false,
    });
    expect(sentryInit).toHaveBeenCalledWith(
      expect.objectContaining({
        initialScope: {
          tags: {
            service: 'orchestrator',
            component: 'nestjs',
          },
          contexts: {
            app: {
              name: 'Postiz Orchestrator',
            },
          },
        },
        dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
        environment: 'production',
        spotlight: true,
        integrations: [
          { name: 'profiling' },
          { name: 'openai' },
        ],
        tracesSampleRate: 1.0,
        profileSessionSampleRate: 0.45,
        profileLifecycle: 'trace',
        enableLogs: false,
      })
    );
  });
});

const restoreEnv = (name: string, value: string | undefined) => {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
};
