import type { Response } from 'express';

export const COPY_GENERATION_HEARTBEAT_MS = 15_000;

export const startCopyGenerationHeartbeat = (
  res: Pick<Response, 'write'>
) =>
  setInterval(() => {
    res.write(
      JSON.stringify({
        name: 'copy-generation-heartbeat',
        data: { timestamp: Date.now() },
      }) + '\n'
    );
  }, COPY_GENERATION_HEARTBEAT_MS);
