import { CancellationScope, proxyActivities } from '@temporalio/workflow';
import type { MediaTranscriptionActivity } from '@gitroom/orchestrator/activities/media-transcription.activity';

const { transcribeMedia } = proxyActivities<MediaTranscriptionActivity>({
  startToCloseTimeout: '30 minutes',
  retry: {
    maximumAttempts: 3,
    initialInterval: '10 seconds',
    backoffCoefficient: 2,
  },
});

const { failMediaTranscription } = proxyActivities<MediaTranscriptionActivity>({
  startToCloseTimeout: '1 minute',
  retry: {
    initialInterval: '10 seconds',
    maximumInterval: '5 minutes',
    backoffCoefficient: 2,
  },
});

export async function mediaTranscriptionWorkflow(input: {
  transcriptionId: string;
  generation: number;
}) {
  try {
    return await transcribeMedia(input);
  } catch {
    return CancellationScope.nonCancellable(() =>
      failMediaTranscription(input)
    );
  }
}
