import { MediaTranscriptionStatus } from '@prisma/client';
import {
  getMediaTranscriptionWorkflowId,
  MediaTranscriptionService,
} from '@gitroom/nestjs-libraries/database/prisma/media-transcription/media-transcription.service';

jest.mock('@gitroom/nestjs-libraries/copy-generation/video-media-file', () => ({
  prepareVideoMediaFile: jest.fn(),
}));

const { prepareVideoMediaFile } = jest.requireMock(
  '@gitroom/nestjs-libraries/copy-generation/video-media-file'
) as { prepareVideoMediaFile: jest.Mock };

const pending = {
  id: 'transcription-1',
  mediaId: 'media-1',
  generation: 1,
  status: MediaTranscriptionStatus.PENDING,
  text: null,
  errorCode: null,
  errorMessage: null,
  requestedAt: new Date('2026-08-09T00:00:00Z'),
  startedAt: null,
  completedAt: null,
};

const createService = () => {
  const start = jest.fn().mockResolvedValue(undefined);
  const repository = {
    ensurePendingForActiveMedia: jest.fn().mockResolvedValue(pending),
    retryFailedForActiveMedia: jest.fn(),
    claimForProcessing: jest.fn(),
    getActiveWorkerInput: jest.fn(),
    completeIfActive: jest.fn(),
    failIfActive: jest.fn(),
    failIfPendingOrProcessing: jest.fn(),
    deleteMediaLifecycle: jest.fn(),
  };
  const temporal = {
    client: {
      getRawClient: () => ({ workflow: { start } }),
    },
    cancelWorkflow: jest.fn().mockResolvedValue(undefined),
  };
  const model = {
    transcribeVideo: jest.fn(),
  };

  return {
    service: new MediaTranscriptionService(
      repository as any,
      temporal as any,
      model as any
    ),
    repository,
    temporal,
    model,
    start,
  };
};

describe('MediaTranscriptionService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prepareVideoMediaFile.mockResolvedValue({
      inputPath: '/tmp/video.mp4',
      cleanup: jest.fn().mockResolvedValue(undefined),
    });
  });

  it('uses one deterministic workflow identity across repeated ensure calls', async () => {
    const { service, start } = createService();
    start
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('Workflow already started'));

    await expect(
      service.ensureTranscriptionStarted('org-1', 'media-1')
    ).resolves.toMatchObject({ status: 'PENDING', generation: 1 });
    await expect(
      service.ensureTranscriptionStarted('org-1', 'media-1')
    ).resolves.toMatchObject({ status: 'PENDING', generation: 1 });

    const workflowIds = start.mock.calls.map((call) => call[1].workflowId);
    expect(workflowIds).toEqual([
      getMediaTranscriptionWorkflowId('transcription-1', 1),
      getMediaTranscriptionWorkflowId('transcription-1', 1),
    ]);
    expect(start.mock.calls[0][1]).toMatchObject({
      taskQueue: 'main',
      workflowIdReusePolicy: 'ALLOW_DUPLICATE_FAILED_ONLY',
    });
  });

  it('rejects cross-organization or deleted media access', async () => {
    const { service, repository, start } = createService();
    repository.ensurePendingForActiveMedia.mockResolvedValueOnce(null);

    await expect(
      service.ensureTranscriptionStarted('other-org', 'media-1')
    ).rejects.toThrow('Media not found');
    expect(start).not.toHaveBeenCalled();
  });

  it('discards work when media was deleted before worker claim', async () => {
    const { service, repository, model } = createService();
    repository.claimForProcessing.mockResolvedValue(false);
    repository.getActiveWorkerInput.mockResolvedValue(null);

    await expect(
      service.processTranscription('transcription-1', 1)
    ).resolves.toEqual({ discarded: true });
    expect(model.transcribeVideo).not.toHaveBeenCalled();
    expect(repository.completeIfActive).not.toHaveBeenCalled();
  });

  it('discards a late result when deletion wins during transcription', async () => {
    const { service, repository, model } = createService();
    repository.claimForProcessing.mockResolvedValue(true);
    repository.getActiveWorkerInput.mockResolvedValue({
      ...pending,
      status: MediaTranscriptionStatus.PROCESSING,
      media: {
        path: 'https://media.example.com/video.mp4',
        originalName: 'video.mp4',
        name: 'video.mp4',
      },
    });
    model.transcribeVideo.mockResolvedValue({ text: 'Late transcript text.' });
    repository.completeIfActive.mockResolvedValue(false);

    await expect(
      service.processTranscription('transcription-1', 1)
    ).resolves.toEqual({ discarded: true, status: 'READY' });
    expect(repository.completeIfActive).toHaveBeenCalledWith(
      'transcription-1',
      1,
      'Late transcript text.'
    );
  });

  it('stores detected speech in the normal READY path', async () => {
    const { service, repository, model } = createService();
    repository.getActiveWorkerInput.mockResolvedValue({
      ...pending,
      status: MediaTranscriptionStatus.PROCESSING,
      media: {
        path: 'https://media.example.com/video.mp4',
        originalName: 'video.mp4',
        name: 'video.mp4',
      },
    });
    repository.completeIfActive.mockResolvedValue(true);
    model.transcribeVideo.mockResolvedValue({ text: '  Spoken words.  ' });

    await expect(
      service.processTranscription('transcription-1', 1)
    ).resolves.toEqual({ discarded: false, status: 'READY' });
    expect(repository.completeIfActive).toHaveBeenCalledWith(
      'transcription-1',
      1,
      'Spoken words.'
    );
  });

  it('stores no detected speech as READY without fake transcript text', async () => {
    const { service, repository, model } = createService();
    repository.getActiveWorkerInput.mockResolvedValue({
      ...pending,
      status: MediaTranscriptionStatus.PROCESSING,
      media: {
        path: 'https://media.example.com/video.mp4',
        originalName: 'video.mp4',
        name: 'video.mp4',
      },
    });
    repository.completeIfActive.mockResolvedValue(true);
    model.transcribeVideo.mockResolvedValue({ text: '   ' });

    await expect(
      service.processTranscription('transcription-1', 1)
    ).resolves.toEqual({ discarded: false, status: 'READY' });
    expect(repository.completeIfActive).toHaveBeenCalledWith(
      'transcription-1',
      1,
      null
    );
    expect(repository.failIfActive).not.toHaveBeenCalled();
  });

  it('deletes READY transcript text and best-effort cancels its workflow', async () => {
    const { service, repository, temporal } = createService();
    repository.deleteMediaLifecycle.mockResolvedValue({
      transcription: { id: 'transcription-1', generation: 1 },
    });

    await expect(service.deleteMedia('org-1', 'media-1')).resolves.toEqual({
      id: 'media-1',
      deleted: true,
    });
    expect(repository.deleteMediaLifecycle).toHaveBeenCalledWith(
      'org-1',
      'media-1'
    );
    expect(temporal.cancelWorkflow).toHaveBeenCalledWith(
      getMediaTranscriptionWorkflowId('transcription-1', 1)
    );
  });

  it('starts generation N+1 and rejects a late generation N completion', async () => {
    const { service, repository, start, model } = createService();
    repository.retryFailedForActiveMedia.mockResolvedValue({
      ...pending,
      generation: 2,
    });

    await service.retry('org-1', 'media-1');
    expect(start).toHaveBeenCalledWith(
      'mediaTranscriptionWorkflow',
      expect.objectContaining({
        workflowId: getMediaTranscriptionWorkflowId('transcription-1', 2),
      })
    );

    repository.claimForProcessing.mockResolvedValue(false);
    repository.getActiveWorkerInput.mockResolvedValue(null);
    await expect(
      service.processTranscription('transcription-1', 1)
    ).resolves.toEqual({ discarded: true });
    expect(model.transcribeVideo).not.toHaveBeenCalled();
  });

  it('returns a sanitized typed failure for FAILED lifecycle state', async () => {
    const { service, repository } = createService();
    repository.ensurePendingForActiveMedia.mockResolvedValue({
      ...pending,
      status: MediaTranscriptionStatus.FAILED,
      errorCode: 'TRANSCRIPTION_FAILED',
      errorMessage: 'The video could not be transcribed. Please retry.',
      completedAt: new Date('2026-08-09T00:05:00Z'),
    });

    await expect(
      service.resolveForGeneration('org-1', 'media-1')
    ).rejects.toMatchObject({
      code: 'TRANSCRIPTION_FAILED',
      message: 'The video could not be transcribed. Please retry.',
    });
  });

  it('resolves a READY transcription without speech as absent text', async () => {
    const { service, repository } = createService();
    repository.ensurePendingForActiveMedia.mockResolvedValue({
      ...pending,
      status: MediaTranscriptionStatus.READY,
      text: null,
      completedAt: new Date('2026-08-09T00:05:00Z'),
    });

    await expect(
      service.resolveForGeneration('org-1', 'media-1')
    ).resolves.toBeUndefined();
  });

  it('lets model failures escape so Temporal can retry the activity', async () => {
    const { service, repository, model } = createService();
    repository.claimForProcessing.mockResolvedValue(true);
    repository.getActiveWorkerInput.mockResolvedValue({
      ...pending,
      status: MediaTranscriptionStatus.PROCESSING,
      media: {
        path: 'https://media.example.com/video.mp4',
        originalName: 'video.mp4',
        name: 'video.mp4',
      },
    });
    model.transcribeVideo.mockRejectedValue(new Error('provider unavailable'));

    await expect(
      service.processTranscription('transcription-1', 1)
    ).rejects.toThrow('provider unavailable');
    expect(repository.failIfActive).not.toHaveBeenCalled();
    expect(repository.completeIfActive).not.toHaveBeenCalled();
  });

  it('marks the active generation failed after Temporal retries are exhausted', async () => {
    const { service, repository } = createService();
    repository.failIfPendingOrProcessing.mockResolvedValue(true);

    await expect(
      service.failTranscription('transcription-1', 1)
    ).resolves.toEqual({ discarded: false, status: 'FAILED' });
    expect(repository.failIfPendingOrProcessing).toHaveBeenCalledWith(
      'transcription-1',
      1,
      'TRANSCRIPTION_FAILED',
      'The video could not be transcribed. Please retry.'
    );
  });
});
