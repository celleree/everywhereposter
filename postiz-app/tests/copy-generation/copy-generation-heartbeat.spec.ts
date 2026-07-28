import {
  COPY_GENERATION_HEARTBEAT_MS,
  startCopyGenerationHeartbeat,
} from '@gitroom/backend/api/routes/copy-generation-heartbeat';

const createResponse = () => {
  let closeListener: (() => void) | undefined;
  const response = {
    write: jest.fn(),
    writableEnded: false,
    destroyed: false,
    once: jest.fn((event: string, listener: () => void) => {
      if (event === 'close') {
        closeListener = listener;
      }
      return response;
    }),
    removeListener: jest.fn((event: string, listener: () => void) => {
      if (event === 'close' && closeListener === listener) {
        closeListener = undefined;
      }
      return response;
    }),
  };

  return {
    response,
    close: () => closeListener?.(),
  };
};

describe('copy generation heartbeat', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('writes a parser-invisible keepalive marker every 15 seconds and stops after cleanup', () => {
    const { response } = createResponse();
    const heartbeat = startCopyGenerationHeartbeat(response);

    expect(COPY_GENERATION_HEARTBEAT_MS).toBe(15_000);
    expect(jest.getTimerCount()).toBe(1);

    jest.advanceTimersByTime(COPY_GENERATION_HEARTBEAT_MS);
    expect(response.write).toHaveBeenCalledTimes(1);
    expect(response.write).toHaveBeenCalledWith(
      expect.stringContaining('copy-generation-heartbeat')
    );
    expect(() => JSON.parse(response.write.mock.calls[0][0])).toThrow();

    heartbeat.stop();
    heartbeat.stop();
    jest.advanceTimersByTime(COPY_GENERATION_HEARTBEAT_MS * 2);

    expect(heartbeat.isClosed()).toBe(true);
    expect(response.write).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('stops immediately when the client closes the response stream', () => {
    const { response, close } = createResponse();
    const heartbeat = startCopyGenerationHeartbeat(response);

    close();

    expect(heartbeat.isClosed()).toBe(true);
    expect(jest.getTimerCount()).toBe(0);

    jest.advanceTimersByTime(COPY_GENERATION_HEARTBEAT_MS * 2);

    expect(response.write).not.toHaveBeenCalled();
    expect(response.removeListener).toHaveBeenCalledWith(
      'close',
      expect.any(Function)
    );
  });
});
