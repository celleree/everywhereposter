const transcribeMedia = jest.fn();
const failMediaTranscription = jest.fn();
const proxyOptions: any[] = [];

jest.mock('@temporalio/workflow', () => ({
  proxyActivities: (options: any) => {
    proxyOptions.push(options);
    return options.retry.maximumAttempts
      ? { transcribeMedia }
      : { failMediaTranscription };
  },
  CancellationScope: {
    nonCancellable: (operation: () => unknown) => operation(),
  },
}));

import { mediaTranscriptionWorkflow } from '@gitroom/orchestrator/workflows/media-transcription.workflow';

describe('mediaTranscriptionWorkflow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('durably records FAILED after transcription activity retries are exhausted', async () => {
    transcribeMedia.mockRejectedValue(new Error('provider unavailable'));
    failMediaTranscription.mockResolvedValue({
      discarded: false,
      status: 'FAILED',
    });
    const input = { transcriptionId: 'transcription-1', generation: 3 };

    await expect(mediaTranscriptionWorkflow(input)).resolves.toEqual({
      discarded: false,
      status: 'FAILED',
    });
    expect(transcribeMedia).toHaveBeenCalledWith(input);
    expect(failMediaTranscription).toHaveBeenCalledWith(input);
    expect(proxyOptions[0].retry.maximumAttempts).toBe(3);
    expect(proxyOptions[1].retry.maximumAttempts).toBeUndefined();
  });
});
