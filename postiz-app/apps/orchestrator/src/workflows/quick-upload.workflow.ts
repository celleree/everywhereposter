import { CancellationScope, proxyActivities, sleep } from '@temporalio/workflow';
import type { QuickUploadActivity } from '../activities/quick-upload.activity';

const { prepareQuickUpload, submitQuickUpload, reconcileQuickUpload } = proxyActivities<QuickUploadActivity>({
  startToCloseTimeout: '10 minutes', retry: { maximumAttempts: 3, initialInterval: '10 seconds' },
});
// Generation is charged work with an uncertain outcome after a lost receipt. Never repeat it.
const { generateQuickUpload } = proxyActivities<QuickUploadActivity>({ startToCloseTimeout: '30 minutes', retry: { maximumAttempts: 1 } });
const { failQuickUpload } = proxyActivities<QuickUploadActivity>({ startToCloseTimeout: '1 minute', retry: { initialInterval: '10 seconds', maximumInterval: '5 minutes' } });

export async function quickUploadWorkflow({ intentId }: { intentId: string }) {
  try {
    let ready = false;
    for (let tick = 0; tick < 3000; tick++) {
      const state = await prepareQuickUpload(intentId);
      if (state === 'DONE') return;
      if (state === 'READY') { ready = true; break; }
      await sleep('30 seconds');
    }
    if (!ready) throw new Error('Upload or processing deadline exceeded.');
    await generateQuickUpload(intentId);
    // Replays use one persisted immutable #164 submission. Only its ledger controls providers.
    try { await submitQuickUpload(intentId); }
    catch {
      // A reservation may already exist after an acknowledgement was lost. Observe it;
      // a missing/unavailable ledger reaches the failure path without another dispatch.
      if (await reconcileQuickUpload(intentId)) return;
    }
    for (let tick = 0; tick < 2880; tick++) {
      if (await reconcileQuickUpload(intentId)) return;
      await sleep('30 seconds');
    }
    throw new Error('Publishing remains unresolved.');
  } catch {
    await CancellationScope.nonCancellable(() => failQuickUpload(intentId));
  }
}
