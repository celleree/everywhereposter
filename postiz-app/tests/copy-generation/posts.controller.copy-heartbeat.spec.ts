import { PostsController } from '@gitroom/backend/api/routes/posts.controller';

describe('PostsController copy generation heartbeat', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('writes a heartbeat while source analysis is still running', async () => {
    let finish: () => void = () => undefined;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const copyGenerationService = {
      generate: async function* () {
        yield { name: 'copy-generation-started', data: { requestId: 'request-1' } };
        await pending;
        yield {
          name: 'completed',
          data: {
            requestId: 'request-1',
            status: 'failed',
            sourceConfidence: 0.2,
            warnings: [],
            results: [],
          },
        };
      },
    };
    const controller = new PostsController(
      {} as any,
      {} as any,
      {} as any,
      copyGenerationService as any,
      {} as any
    );
    const response = {
      setHeader: jest.fn(),
      write: jest.fn(),
      end: jest.fn(),
    };

    const request = controller.generateMediaCopy(
      { id: 'org-1' } as any,
      { mediaId: 'media-1', platforms: ['linkedin'], goal: 'position' } as any,
      response as any
    );
    await Promise.resolve();
    await Promise.resolve();

    expect(response.write).toHaveBeenCalledWith(
      expect.stringContaining('copy-generation-started')
    );
    expect(response.setHeader).toHaveBeenCalledWith('X-Accel-Buffering', 'no');

    jest.advanceTimersByTime(15_000);
    await Promise.resolve();

    expect(response.write).toHaveBeenCalledWith(
      expect.stringContaining('copy-generation-heartbeat')
    );

    finish();
    await request;

    expect(response.write).toHaveBeenCalledWith(
      expect.stringContaining('completed')
    );
    expect(response.end).toHaveBeenCalledTimes(1);

    const writesAfterEnd = response.write.mock.calls.length;
    jest.advanceTimersByTime(30_000);
    expect(response.write).toHaveBeenCalledTimes(writesAfterEnd);
  });
});
