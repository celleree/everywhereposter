export const COPY_GENERATION_HEARTBEAT_MS = 15_000;

interface CopyGenerationHeartbeatResponse {
  write: (chunk: string) => unknown;
  once: (event: 'close', listener: () => void) => unknown;
  removeListener: (event: 'close', listener: () => void) => unknown;
  writableEnded?: boolean;
  destroyed?: boolean;
}

export interface CopyGenerationHeartbeat {
  stop: () => void;
  isClosed: () => boolean;
}

export const startCopyGenerationHeartbeat = (
  res: CopyGenerationHeartbeatResponse
): CopyGenerationHeartbeat => {
  let stopped = false;
  let interval: ReturnType<typeof setInterval>;

  const stop = () => {
    if (stopped) {
      return;
    }

    stopped = true;
    clearInterval(interval);
    res.removeListener('close', stop);
  };

  const isClosed = () => stopped || !!res.writableEnded || !!res.destroyed;

  interval = setInterval(() => {
    if (isClosed()) {
      stop();
      return;
    }

    // A blank NDJSON line keeps the response active without surfacing a
    // progress event. Both copy-generation stream parsers ignore blank lines.
    res.write('\n');
  }, COPY_GENERATION_HEARTBEAT_MS);

  res.once('close', stop);

  return { stop, isClosed };
};
