import { MediaService } from '@gitroom/nestjs-libraries/database/prisma/media/media.service';

describe('MediaService guided transcription upload', () => {
  const mediaRepository = {
    saveFile: jest.fn(),
  };
  const transcriptionService = {
    ensureTranscriptionStarted: jest.fn().mockResolvedValue(undefined),
  };
  const service = new MediaService(
    mediaRepository as any,
    {} as any,
    {} as any,
    {} as any,
    transcriptionService as any
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('starts transcription server-side after a guided video is persisted', async () => {
    mediaRepository.saveFile.mockResolvedValue({
      id: 'video-1',
      type: 'video',
      path: 'https://media.example.com/video.mp4',
    });

    await expect(
      service.saveFile(
        'org-1',
        'video.mp4',
        'https://media.example.com/video.mp4',
        'video.mp4',
        'video/mp4',
        true
      )
    ).resolves.toMatchObject({ id: 'video-1' });

    expect(transcriptionService.ensureTranscriptionStarted).toHaveBeenCalledWith(
      'org-1',
      'video-1',
      true
    );
  });

  it('does not complete a guided media-library upload when audio validation fails', async () => {
    mediaRepository.saveFile.mockResolvedValue({
      id: 'video-1',
      type: 'video',
      path: 'https://media.example.com/video.mp4',
    });
    transcriptionService.ensureTranscriptionStarted.mockRejectedValueOnce(
      new Error('An audio track with media is required for guided video creation.')
    );

    await expect(
      service.saveFile(
        'org-1',
        'video.mp4',
        'https://media.example.com/video.mp4',
        'video.mp4',
        'video/mp4',
        true
      )
    ).rejects.toThrow('audio track with media is required');
  });

  it('does not start transcription for legacy uploads or guided images', async () => {
    mediaRepository.saveFile
      .mockResolvedValueOnce({ id: 'video-1', type: 'video' })
      .mockResolvedValueOnce({ id: 'image-1', type: 'image' });

    await service.saveFile(
      'org-1',
      'video.mp4',
      'https://media.example.com/video.mp4'
    );
    await service.saveFile(
      'org-1',
      'image.png',
      'https://media.example.com/image.png',
      'image.png',
      'image/png',
      true
    );

    expect(transcriptionService.ensureTranscriptionStarted).not.toHaveBeenCalled();
  });
});
