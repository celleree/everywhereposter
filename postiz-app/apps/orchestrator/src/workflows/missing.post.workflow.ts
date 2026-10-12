import { proxyActivities, sleep, patched } from '@temporalio/workflow';
import { PostActivity } from '@gitroom/orchestrator/activities/post.activity';

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
  await searchForMissingThreeHoursPosts();
  while (true) {
    await sleep('1 hour');
    if (patched('resumable-video-maintenance-v1')) await maintainVideoUploads();
    await searchForMissingThreeHoursPosts();
  }
}
