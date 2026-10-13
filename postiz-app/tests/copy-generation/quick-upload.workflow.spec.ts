const activities = { prepareQuickUpload: jest.fn(), generateQuickUpload: jest.fn(), submitQuickUpload: jest.fn(), reconcileQuickUpload: jest.fn(), failQuickUpload: jest.fn() };
const options: any[] = [];
jest.mock('@temporalio/workflow', () => ({ proxyActivities: (value: any) => { options.push(value); return activities; }, sleep: jest.fn().mockResolvedValue(undefined), CancellationScope: { nonCancellable: (run: any) => run() } }));
import { quickUploadWorkflow } from '../../apps/orchestrator/src/workflows/quick-upload.workflow';
beforeEach(() => { Object.values(activities).forEach(value => value.mockReset()); activities.prepareQuickUpload.mockResolvedValue('READY'); activities.reconcileQuickUpload.mockResolvedValue(true); });
it('waits for delayed completion then generates and submits only through durable activities', async () => {
  activities.prepareQuickUpload.mockResolvedValueOnce('WAIT').mockResolvedValueOnce('WAIT').mockResolvedValue('READY');
  activities.reconcileQuickUpload.mockResolvedValueOnce(false).mockResolvedValue(true);
  await quickUploadWorkflow({ intentId: 'intent' }); expect(activities.prepareQuickUpload).toHaveBeenCalledTimes(3); expect(activities.generateQuickUpload).toHaveBeenCalledTimes(1); expect(activities.submitQuickUpload).toHaveBeenCalledTimes(1); expect(activities.reconcileQuickUpload).toHaveBeenCalledTimes(2);
});
it('never generates for cancelled/failed uploads', async () => { activities.prepareQuickUpload.mockResolvedValue('DONE'); await quickUploadWorkflow({ intentId: 'intent' }); expect(activities.generateQuickUpload).not.toHaveBeenCalled(); });
it('does not retry uncertain generation and durably records failure', async () => {
  activities.generateQuickUpload.mockRejectedValue(new Error('uncertain'));
  await quickUploadWorkflow({ intentId: 'intent' }); expect(activities.submitQuickUpload).not.toHaveBeenCalled(); expect(activities.failQuickUpload).toHaveBeenCalledWith('intent');
  expect(options.find(value => value.startToCloseTimeout === '30 minutes').retry.maximumAttempts).toBe(1);
});
it('records submission failure without another provider operation', async () => { activities.submitQuickUpload.mockRejectedValue(new Error('uncertain')); activities.reconcileQuickUpload.mockRejectedValue(new Error('ledger unavailable')); await quickUploadWorkflow({ intentId: 'intent' }); expect(activities.submitQuickUpload).toHaveBeenCalledTimes(1); expect(activities.failQuickUpload).toHaveBeenCalledWith('intent'); });

it('polls an existing reservation after submission acknowledgement loss without resubmission', async () => { activities.submitQuickUpload.mockRejectedValue(new Error('lost acknowledgement')); activities.reconcileQuickUpload.mockResolvedValueOnce(false).mockResolvedValue(true); await quickUploadWorkflow({ intentId: 'intent' }); expect(activities.submitQuickUpload).toHaveBeenCalledTimes(1); expect(activities.reconcileQuickUpload).toHaveBeenCalledTimes(2); expect(activities.failQuickUpload).not.toHaveBeenCalled(); });
