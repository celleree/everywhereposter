jest.mock('nestjs-temporal-core', () => ({
  TemporalModule: { registerAsync: jest.fn((options) => options) },
}));
jest.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({
  socialIntegrationList: [
    { identifier: 'x', maxConcurrentJob: undefined },
    { identifier: 'linkedin-page', maxConcurrentJob: 5 },
    { identifier: 'telegram', maxConcurrentJob: 1 },
  ],
}));
jest.mock('@temporalio/worker', () => ({ bundleWorkflowCode: jest.fn() }));

import { bundleWorkflowCode } from '@temporalio/worker';
import { getTemporalModule } from '../../libraries/nestjs-libraries/src/temporal/temporal.module';

const bundle = { code: 'fixture workflow bundle' };
class FixtureActivities {}
const factory = (isWorkers = true) =>
  (getTemporalModule(isWorkers, '/fixture/workflows', [FixtureActivities]) as any).useFactory();

beforeEach(() => {
  jest.mocked(bundleWorkflowCode).mockReset().mockResolvedValue(bundle as any);
});

it('loads workflow isolates only on main while retaining every provider activity queue', async () => {
  const options = await factory();
  expect(options.workers.map((worker: any) => worker.taskQueue)).toEqual(['main', 'x', 'telegram']);
  expect(options.workers[0].workflowBundle).toBe(bundle);
  expect(bundleWorkflowCode).toHaveBeenCalledTimes(1);
  expect(bundleWorkflowCode).toHaveBeenCalledWith({ workflowsPath: '/fixture/workflows' });
  for (const worker of options.workers.slice(1)) {
    expect(worker).not.toHaveProperty('workflowBundle');
    expect(worker).not.toHaveProperty('workflowsPath');
  }
  for (const worker of options.workers) {
    expect(worker.activityClasses).toEqual([FixtureActivities]);
    expect(worker.autoStart).toBe(true);
  }
});

it('preserves provider activity concurrency and the main queue defaults', async () => {
  const { workers } = await factory();
  expect(workers[2].workerOptions).toEqual({ maxConcurrentActivityTaskExecutions: 1 });
  expect(workers[0].workerOptions).toBeUndefined();
  expect(workers[1].workerOptions).toBeUndefined();
});

it('keeps backend clients free of worker bundles and workers', async () => {
  const options = await factory(false);
  expect(options.taskQueue).toBe('main');
  expect(options).not.toHaveProperty('workers');
  expect(bundleWorkflowCode).not.toHaveBeenCalled();
});

it('propagates main workflow bundling failures rather than starting activity-only main', async () => {
  jest.mocked(bundleWorkflowCode).mockRejectedValue(new Error('invalid workflow bundle'));
  await expect(factory()).rejects.toThrow('invalid workflow bundle');
});
