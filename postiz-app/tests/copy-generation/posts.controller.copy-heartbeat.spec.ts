import { PostsController } from '@gitroom/backend/api/routes/posts.controller';

describe('PostsController copy generation heartbeat', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('writes and clears a 15-second heartbeat around copy generation', async () => {
    const intervalToken = { token: 'heartbeat' } as unknown as NodeJS.Timeout;
    const intervalSpy = jest
      .spyOn(global, 'setInterval')
      .mockImplementation(((callback: () => void, delay?: number) => {
        expect(delay).toBe(15_000);
        callback();
        return intervalToken;
      }) as typeof setInterval);
    const clearIntervalSpy = jest
      .spyOn(global, 'clearInterval')
      .mockImplementation(() => undefined);
    const copyGenerationService = {
      generate: async function* () {
        yield { name: 'copy-generation-started', data: { requestId: 'request-1' } };
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

    await controller.generateMediaCopy(
      { id: 'org-1' } as any,
      { mediaId: 'media-1', platforms: ['linkedin'], goal: 'position' } as any,
      response as any
    );

    expect(intervalSpy).toHaveBeenCalledTimes(1);
    expect(response.setHeader).toHaveBeenCalledWith('X-Accel-Buffering', 'no');
    expect(response.write).toHaveBeenCalledWith(
      expect.stringContaining('copy-generation-heartbeat')
    );
    expect(response.write).toHaveBeenCalledWith(
      expect.stringContaining('copy-generation-started')
    );
    expect(response.write).toHaveBeenCalledWith(
      expect.stringContaining('completed')
    );
    expect(clearIntervalSpy).toHaveBeenCalledWith(intervalToken);
    expect(response.end).toHaveBeenCalledTimes(1);
  });
});
