import {
  COPY_GENERATION_HEARTBEAT_MS,
  startCopyGenerationHeartbeat,
} from '@gitroom/backend/api/routes/copy-generation-heartbeat';

describe('copy generation heartbeat', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('writes every 15 seconds and stops after the interval is cleared', () => {
    const response = {
      write: jest.fn(),
    };
    const heartbeat = startCopyGenerationHeartbeat(response as any);

    expect(COPY_GENERATION_HEARTBEAT_MS).toBe(15_000);
    expect(jest.getTimerCount()).toBe(1);

    jest.advanceTimersByTime(COPY_GENERATION_HEARTBEAT_MS);
    expect(response.write).toHaveBeenCalledTimes(1);
    expect(response.write).toHaveBeenCalledWith(
      expect.stringContaining('copy-generation-heartbeat')
    );

    clearInterval(heartbeat);
    jest.advanceTimersByTime(COPY_GENERATION_HEARTBEAT_MS * 2);
    expect(response.write).toHaveBeenCalledTimes(1);
  });
});
