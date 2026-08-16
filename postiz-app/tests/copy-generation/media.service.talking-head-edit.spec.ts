import { Logger } from '@nestjs/common';
import { MediaTranscriptionStatus } from '@prisma/client';
import { MediaService } from '@gitroom/nestjs-libraries/database/prisma/media/media.service';
import { buildVideoEditDecisionList } from '@gitroom/nestjs-libraries/media-editing/video-edit-decision';
import {
  createTalkingHeadStylePlan,
  toTalkingHeadStyleMetadata,
} from '@gitroom/nestjs-libraries/media-editing/talking-head-style';

jest.mock('@gitroom/nestjs-libraries/copy-generation/video-media-file', () => ({
  prepareVideoMediaFile: jest.fn(),
}));

const { prepareVideoMediaFile } = jest.requireMock(
  '@gitroom/nestjs-libraries/copy-generation/video-media-file'
) as { prepareVideoMediaFile: jest.Mock };

const sourceMedia = {
  id: 'media-1',
  organizationId: 'org-1',
  name: 'stored-video.mp4',
  originalName: 'My Talking Head.mov',
  path: 'https://media.example.com/stored-video.mp4',
  type: 'video',
};

const readyTranscription = {
  id: 'transcription-1',
  mediaId: 'media-1',
  generation: 1,
  status: MediaTranscriptionStatus.READY,
  text: 'A useful transcript.',
  error: null,
};

const stylePrompt = 'Make it fast and punchy.';
const stylePlan = createTalkingHeadStylePlan({
  stylePrompt,
  pacingPreset: 'tight',
  plannerSource: 'openai-structured-output',
  plannerModel: 'gpt-5.6-luna',
});

const decisionList = buildVideoEditDecisionList({
  mediaId: 'media-1',
  durationMs: 4_000,
  style: toTalkingHeadStyleMetadata(stylePlan),
  transcription: {
    id: 'transcription-1',
    generation: 1,
    text: 'A useful transcript.',
  },
  detectedSilence: [{ sourceStartMs: 1_000, sourceEndMs: 2_000 }],
  silenceThresholdDb: -35,
  minimumSilenceMs: 650,
  speechPaddingMs: 120,
  maxKeepRanges: 200,
});

const createService = () => {
  const repository = {
    getMediaByOrganizationIdAndId: jest.fn().mockResolvedValue(sourceMedia),
    saveFile: jest.fn().mockResolvedValue({
      id: 'edited-media-1',
      name: 'rendered.mp4',
      originalName: 'My_Talking_Head-edited.mp4',
      path: 'https://media.example.com/rendered.mp4',
      type: 'video',
    }),
  };
  const transcription = {
    getStatus: jest.fn().mockResolvedValue(readyTranscription),
  };
  const renderedCleanup = jest.fn().mockResolvedValue(undefined);
  const editor = {
    analyzeTalkingHeadVideo: jest.fn().mockResolvedValue(decisionList),
    render: jest.fn().mockResolvedValue({
      outputPath: '/tmp/edit/edited.mp4',
      durationMs: 3_240,
      cleanup: renderedCleanup,
    }),
  };
  const storage = {
    uploadFromPath: jest.fn().mockResolvedValue({
      filename: 'rendered.mp4',
      path: 'https://media.example.com/rendered.mp4',
      mimetype: 'video/mp4',
      originalname: 'My_Talking_Head-edited.mp4',
      size: 1024,
    }),
    removeFile: jest.fn().mockResolvedValue(undefined),
  };
  const stylePlanner = {
    plan: jest.fn().mockResolvedValue(stylePlan),
  };
  const service = new MediaService(
    repository as any,
    {} as any,
    {} as any,
    {} as any,
    transcription as any,
    editor as any,
    stylePlanner as any
  );
  (service as any).storage = storage;

  return {
    service,
    repository,
    transcription,
    editor,
    storage,
    stylePlanner,
    renderedCleanup,
  };
};

describe('MediaService talking-head edit proof of concept', () => {
  const preparedCleanup = jest.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    jest.clearAllMocks();
    prepareVideoMediaFile.mockResolvedValue({
      inputPath: '/tmp/source/video.mp4',
      cleanup: preparedCleanup,
    });
  });

  it('renders, streams to storage, persists media, and returns decisions', async () => {
    const {
      service,
      repository,
      transcription,
      editor,
      storage,
      stylePlanner,
      renderedCleanup,
    } = createService();

    await expect(
      service.createTalkingHeadEdit('org-1', 'media-1', stylePrompt)
    ).resolves.toEqual({
      outputMedia: expect.objectContaining({ id: 'edited-media-1' }),
      stylePlan,
      editDecisionList: decisionList,
      render: {
        durationMs: 3_240,
        container: 'mp4',
        videoCodec: 'h264',
        audioCodec: 'aac',
      },
    });

    expect(repository.getMediaByOrganizationIdAndId).toHaveBeenCalledWith(
      'org-1',
      'media-1'
    );
    expect(transcription.getStatus).toHaveBeenCalledWith('org-1', 'media-1');
    expect(stylePlanner.plan).toHaveBeenCalledWith({
      organizationId: 'org-1',
      stylePrompt,
    });
    expect(prepareVideoMediaFile).toHaveBeenCalledWith(
      sourceMedia.path,
      sourceMedia.originalName
    );
    expect(editor.analyzeTalkingHeadVideo).toHaveBeenCalledWith(
      expect.objectContaining({
        inputPath: '/tmp/source/video.mp4',
        mediaId: 'media-1',
        style: toTalkingHeadStyleMetadata(stylePlan),
        transcription: expect.objectContaining({
          id: 'transcription-1',
          text: readyTranscription.text,
        }),
      })
    );
    expect(storage.uploadFromPath).toHaveBeenCalledWith(
      '/tmp/edit/edited.mp4',
      'My_Talking_Head-edited.mp4'
    );
    expect(repository.saveFile).toHaveBeenCalledWith(
      'org-1',
      'rendered.mp4',
      'https://media.example.com/rendered.mp4',
      'My_Talking_Head-edited.mp4',
      'video/mp4'
    );
    expect(storage.removeFile).not.toHaveBeenCalled();
    expect(renderedCleanup).toHaveBeenCalledTimes(1);
    expect(preparedCleanup).toHaveBeenCalledTimes(1);
  });

  it('rejects missing, cross-organization, and non-video media before file access', async () => {
    const { service, repository, transcription } = createService();
    repository.getMediaByOrganizationIdAndId
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ ...sourceMedia, type: 'image' });

    await expect(
      service.createTalkingHeadEdit('other-org', 'media-1', stylePrompt)
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      service.createTalkingHeadEdit('org-1', 'media-1', stylePrompt)
    ).rejects.toMatchObject({ status: 400 });
    expect(transcription.getStatus).not.toHaveBeenCalled();
    expect(prepareVideoMediaFile).not.toHaveBeenCalled();
  });

  it('returns a retryable conflict while transcription is pending', async () => {
    const { service, transcription, editor } = createService();
    transcription.getStatus.mockResolvedValue({
      ...readyTranscription,
      status: MediaTranscriptionStatus.PROCESSING,
      text: null,
    });

    await expect(
      service.createTalkingHeadEdit('org-1', 'media-1', stylePrompt)
    ).rejects.toMatchObject({ status: 409 });
    expect(editor.analyzeTalkingHeadVideo).not.toHaveBeenCalled();
    expect(prepareVideoMediaFile).not.toHaveBeenCalled();
  });

  it('cleans the prepared source when rendering fails', async () => {
    const { service, editor, storage, repository } = createService();
    editor.render.mockRejectedValue(new Error('ffmpeg failed'));

    await expect(
      service.createTalkingHeadEdit('org-1', 'media-1', stylePrompt)
    ).rejects.toMatchObject({ status: 500 });
    expect(preparedCleanup).toHaveBeenCalledTimes(1);
    expect(storage.uploadFromPath).not.toHaveBeenCalled();
    expect(repository.saveFile).not.toHaveBeenCalled();
  });

  it('removes an uploaded output when media persistence fails', async () => {
    const { service, repository, storage, renderedCleanup } = createService();
    repository.saveFile.mockRejectedValue(new Error('database unavailable'));

    await expect(
      service.createTalkingHeadEdit('org-1', 'media-1', stylePrompt)
    ).rejects.toMatchObject({ status: 500 });
    expect(storage.removeFile).toHaveBeenCalledWith(
      'https://media.example.com/rendered.mp4'
    );
    expect(renderedCleanup).toHaveBeenCalledTimes(1);
    expect(preparedCleanup).toHaveBeenCalledTimes(1);
  });

  it('reports cleanup failures without logging media paths or prompts', async () => {
    const { service, repository, storage } = createService();
    const warning = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    repository.saveFile.mockRejectedValue(new Error('database unavailable'));
    storage.removeFile.mockRejectedValue(new Error('private storage detail'));

    await expect(
      service.createTalkingHeadEdit('org-1', 'media-1', stylePrompt)
    ).rejects.toMatchObject({ status: 500 });

    expect(warning).toHaveBeenCalledWith(
      'Talking-head cleanup failed for media media-1: uploaded derivative'
    );
    expect(warning.mock.calls.flat().join(' ')).not.toContain(stylePrompt);
    expect(warning.mock.calls.flat().join(' ')).not.toContain(
      'https://media.example.com'
    );
  });
});
