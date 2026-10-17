/** Native worker only. Phase1 keeps its separate60-second contract. */
export const COOKED_EDITOR_LIMITS = {
  maxDurationMs: 240_000, maxBytes: 100 * 1024 * 1024,
  maxLongEdge: 1280, maxShortEdge: 720, maxFps: 30,
  stageTimeoutMs: 180_000, operationTimeoutMs: 600_000,
  requestTimeoutMs: 630_000, receiptBytes: 16 * 1024,
} as const;
