import { proxyActivities, sleep, patched } from '@temporalio/workflow';
import { PostActivity } from '@gitroom/orchestrator/activities/post.activity';

import type { QuickUploadActivity } from '../activities/quick-upload.activity';
const { drainQuickUploads } = proxyActivities<QuickUploadActivity>({ startToCloseTimeout: '2 minutes', retry: { maximumAttempts: 3 } });

const { searchForMissingThreeHoursPosts, maintainVideoUploads } = proxyActivities<PostActivity>({
  startToCloseTimeout: '10 minute',
  retry: {
    maximumAttempts: 3,
    backoffCoefficient: 1,
    initialInterval: '2 minutes',
  },
});

export async function missingPostWorkflow() {
  if (patched('resumable-video-maintenance-v1')) await maintainVideoUploads();
  if (patched('durable-quick-upload-outbox-v1')) await drainQuickUploads();
  await searchForMissingThreeHoursPosts();
  while (true) {
    await sleep('1 hour');
    if (patched('resumable-video-maintenance-v1')) await maintainVideoUploads();
    if (patched('durable-quick-upload-outbox-v1')) await drainQuickUploads();
    await searchForMissingThreeHoursPosts();
  }
}
