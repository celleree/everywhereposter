jest.mock('@gitroom/nestjs-libraries/agent/agent.graph.service', () => ({
  AgentGraphService: class AgentGraphService {},
}));

import { PostsController } from '@gitroom/backend/api/routes/posts.controller';

describe('PostsController copy generation terminal response', () => {
  const createResponse = () => ({
    setHeader: jest.fn(),
    write: jest.fn(),
    end: jest.fn(),
    writableEnded: false,
    destroyed: false,
    once: jest.fn(),
    removeListener: jest.fn(),
  });

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('writes a typed failed terminal event when generation throws', async () => {
    const generate = jest.fn(async function* () {
      yield {
        name: 'copy-generation-started',
        data: { requestId: 'request-1' },
      };
      throw new Error('internal provider details');
    });
    const controller = new PostsController(
      {} as any,
      {} as any,
      {} as any,
      { generate } as any,
      {} as any
    );
    const response = createResponse();

    await controller.generateMediaCopy(
      { id: 'org-1' } as any,
      { mediaId: 'media-1', platforms: ['linkedin'] } as any,
      response as any
    );

    const events = response.write.mock.calls.map(([chunk]) =>
      JSON.parse(chunk.trim())
    );
    expect(events[events.length - 1]).toEqual({
      name: 'completed',
      data: {
        requestId: 'request-1',
        status: 'failed',
        sourceConfidence: null,
        warnings: [
          {
            code: 'COPY_GENERATION_FAILED',
            message: 'Post generation could not be completed. Please try again.',
          },
        ],
        results: [],
        imagePlans: [],
      },
    });
    expect(response.end).toHaveBeenCalledTimes(1);
  });

  it('writes a typed failed terminal event when generation ends silently', async () => {
    const generate = jest.fn(async function* () {
      yield {
        name: 'copy-generation-started',
        data: { requestId: 'request-2' },
      };
    });
    const controller = new PostsController(
      {} as any,
      {} as any,
      {} as any,
      { generate } as any,
      {} as any
    );
    const response = createResponse();

    await controller.generateMediaCopy(
      { id: 'org-1' } as any,
      { mediaId: 'media-1', platforms: ['linkedin'] } as any,
      response as any
    );

    const terminal = JSON.parse(
      response.write.mock.calls[response.write.mock.calls.length - 1][0].trim()
    );
    expect(terminal).toMatchObject({
      name: 'completed',
      data: {
        requestId: 'request-2',
        status: 'failed',
        results: [],
      },
    });
  });
});
