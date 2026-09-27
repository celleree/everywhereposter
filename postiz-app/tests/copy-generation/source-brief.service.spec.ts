import { SourceBriefService } from '@gitroom/nestjs-libraries/copy-generation/source-brief.service';
import { TranscriptionLifecycleError } from '@gitroom/nestjs-libraries/database/prisma/media-transcription/media-transcription.service';

jest.mock('@gitroom/helpers/utils/read.or.fetch', () => ({
  readOrFetch: jest.fn(),
}));

jest.mock('@gitroom/nestjs-libraries/copy-generation/video-media-file', () => ({
  prepareVideoMediaFile: jest.fn(),
}));

const defaultVideoInsights = {
  visualSummary: 'A presenter demonstrates a publishing workflow on screen.',
  facts: [
    'A presenter appears in the sampled frames.',
    'A publishing interface is visible on screen.',
  ],
  unknowns: ['The exact product version is not visible.'],
  coreMessage: 'One source video can support a complete publishing workflow.',
  sourceConfidence: 0.82,
  scenes: [
    {
      timestampSeconds: 4.2,
      description: 'The presenter speaks beside a publishing interface.',
      visibleText: '',
      usefulForPosting: true,
    },
  ],
};

const voiceProfile = {
  sentenceLength: 'mixed' as const,
  lineBreakHabit: 'moderate' as const,
  ctaStyle: 'invite' as const,
  vocabularyTendencies: ['concrete'],
  tabooPhrases: [] as string[],
  preferredOpenings: [] as string[],
  confidence: 0.8,
};

const createService = (
  modelOverrides: Record<string, unknown> = {},
  mediaOverrides: Record<string, unknown> = {},
  knowledgeBaseVoiceProfile?: typeof voiceProfile,
  transcriptionOverrides: Record<string, unknown> = {}
) => {
  const mediaRepository = {
    getMediaByOrganizationIdAndId: jest.fn().mockResolvedValue({
      id: 'media-1',
      path: 'https://example.com/video.mp4',
      originalName: 'video.mp4',
      name: 'video.mp4',
      alt: null,
      ...mediaOverrides,
    }),
  };
  const modelService = {
    analyzeImage: jest.fn().mockResolvedValue({
      visualSummary: 'A product label is visible.',
      facts: ['The label is handwritten.'],
      unknowns: [],
      coreMessage: 'Small production details matter.',
      sourceConfidence: 0.78,
    }),
    transcribeVideo: jest.fn().mockResolvedValue({
      text: 'A generated transcript with concrete details.',
    }),
    analyzeVideoFrames: jest.fn().mockResolvedValue(defaultVideoInsights),
    summarizeTranscript: jest.fn().mockResolvedValue({
      transcriptSummary: 'A concise transcript summary.',
      facts: ['A concrete fact', 'Another concrete fact'],
      unknowns: [],
      coreMessage: 'A grounded core message.',
      sourceConfidence: 0.8,
      voiceProfile: null,
    }),
    ...modelOverrides,
  };
  const knowledgeBaseService = {
    resolvePersonalization: jest.fn().mockResolvedValue({
      storedFacts: [],
      overlapReferenceTexts: [],
      voiceProfile: knowledgeBaseVoiceProfile,
      explicitVoiceProfileMissed: false,
    }),
  };
  const mediaTranscriptionService = {
    ensureTranscriptionStarted: jest.fn().mockResolvedValue({
      status: 'PENDING',
    }),
    resolveForGeneration: jest
      .fn()
      .mockResolvedValue('A persisted transcript with concrete details.'),
    ...transcriptionOverrides,
  };

  return {
    service: new SourceBriefService(
      mediaRepository as any,
      modelService as any,
      knowledgeBaseService as any,
      mediaTranscriptionService as any
    ),
    mediaRepository,
    modelService,
    mediaTranscriptionService,
  };
};

const request = {
  mediaId: 'media-1',
  platforms: ['linkedin'],
  goal: 'position',
  knowledgeBaseFacts: [],
  transcript: {
    text: 'A sample transcript with concrete details.',
    source: 'manual' as const,
  },
};

const { readOrFetch } = jest.requireMock(
  '@gitroom/helpers/utils/read.or.fetch'
) as { readOrFetch: jest.Mock };
const { prepareVideoMediaFile } = jest.requireMock(
  '@gitroom/nestjs-libraries/copy-generation/video-media-file'
) as { prepareVideoMediaFile: jest.Mock };
const cleanup = jest.fn();

describe('SourceBriefService video grounding', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    readOrFetch.mockResolvedValue(Buffer.from('image-file'));
    cleanup.mockResolvedValue(undefined);
    prepareVideoMediaFile.mockResolvedValue({
      inputPath: '/tmp/postiz-video/video.mp4',
      isTemporary: true,
      cleanup,
    });
  });

  it('checks media ownership without invoking a model', async () => {
    const { service, mediaRepository, modelService } = createService();

    await expect(service.assertMediaAccess('org-1', 'media-1')).resolves.toEqual(
      expect.objectContaining({ id: 'media-1' })
    );
    expect(mediaRepository.getMediaByOrganizationIdAndId).toHaveBeenCalledWith(
      'org-1',
      'media-1'
    );
    expect(modelService.analyzeImage).not.toHaveBeenCalled();
    expect(modelService.transcribeVideo).not.toHaveBeenCalled();
    expect(modelService.analyzeVideoFrames).not.toHaveBeenCalled();
    expect(modelService.summarizeTranscript).not.toHaveBeenCalled();

    mediaRepository.getMediaByOrganizationIdAndId.mockResolvedValueOnce(null);
    await expect(
      service.assertMediaAccess('other-org', 'media-1')
    ).rejects.toThrow('Media not found');
  });

  it('uses a manually supplied transcript without running transcription', async () => {
    const { service, modelService, mediaTranscriptionService } = createService();

    const result = await service.build('org-1', request as any);

    expect(modelService.transcribeVideo).not.toHaveBeenCalled();
    expect(mediaTranscriptionService.resolveForGeneration).not.toHaveBeenCalled();
    expect(
      mediaTranscriptionService.ensureTranscriptionStarted
    ).toHaveBeenCalledWith('org-1', 'media-1');
    expect(modelService.analyzeVideoFrames).toHaveBeenCalledWith(
      expect.objectContaining({
        inputPath: '/tmp/postiz-video/video.mp4',
        transcriptText: request.transcript.text,
      })
    );
    expect(result.transcript).toEqual(request.transcript);
    expect(result.blocked).toBe(false);
  });

  it('reuses the persisted READY transcript without inline transcription', async () => {
    const { service, modelService, mediaTranscriptionService } = createService();

    const result = await service.build('org-1', {
      ...request,
      transcript: undefined,
    } as any);

    expect(prepareVideoMediaFile).toHaveBeenCalledTimes(1);
    expect(modelService.transcribeVideo).not.toHaveBeenCalled();
    expect(mediaTranscriptionService.resolveForGeneration).toHaveBeenCalledWith(
      'org-1',
      'media-1'
    );
    expect(modelService.analyzeVideoFrames).toHaveBeenCalledWith(
      expect.objectContaining({
        inputPath: '/tmp/postiz-video/video.mp4',
        transcriptText: 'A persisted transcript with concrete details.',
      })
    );
    expect(result.transcript).toEqual({
      text: 'A persisted transcript with concrete details.',
      source: 'generated',
      confidence: 0.68,
    });
  });

  it('uses grounded frame evidence when no spoken dialogue was detected', async () => {
    const { service, modelService } = createService({}, {}, undefined, {
      resolveForGeneration: jest.fn().mockResolvedValue(undefined),
    });

    const result = await service.build('org-1', {
      ...request,
      transcript: undefined,
    } as any);

    expect(result.transcript).toBeUndefined();
    expect(result.blocked).toBe(false);
    expect(modelService.analyzeVideoFrames).toHaveBeenCalledWith(
      expect.objectContaining({ transcriptText: undefined })
    );
    expect(modelService.summarizeTranscript).not.toHaveBeenCalled();
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'NO_TRANSCRIPT',
          message: expect.stringContaining('No spoken dialogue was detected'),
        }),
      ])
    );
  });

  it('returns pending without starting duplicate inline transcription', async () => {
    const pending = new TranscriptionLifecycleError(
      'TRANSCRIPTION_PENDING',
      'The video is still being transcribed.'
    );
    const { service, modelService } = createService({}, {}, undefined, {
      resolveForGeneration: jest.fn().mockRejectedValue(pending),
    });

    await expect(
      service.build('org-1', { ...request, transcript: undefined } as any)
    ).rejects.toBe(pending);
    expect(modelService.transcribeVideo).not.toHaveBeenCalled();
    expect(modelService.analyzeVideoFrames).not.toHaveBeenCalled();
  });

  it('does not trust client-claimed generated provenance over canonical text', async () => {
    const { service, mediaTranscriptionService } = createService();

    const result = await service.build('org-1', {
      ...request,
      transcript: {
        text: 'Client supplied generated text.',
        source: 'generated',
      },
    } as any);

    expect(mediaTranscriptionService.resolveForGeneration).toHaveBeenCalled();
    expect(result.transcript?.text).toBe(
      'A persisted transcript with concrete details.'
    );
  });

  it('continues with transcript grounding when visual analysis fails', async () => {
    const { service } = createService({
      analyzeVideoFrames: jest
        .fn()
        .mockRejectedValue(new Error('ffmpeg could not extract frames')),
    });

    const result = await service.build('org-1', request as any);

    expect(result.blocked).toBe(false);
    expect(result.source.transcriptSummary).toBe('A concise transcript summary.');
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'VIDEO_VISUAL_ANALYSIS_FAILED' }),
      ])
    );
  });

  it('deduplicates scenes and trims their fields', async () => {
    const scene = {
      timestampSeconds: 4.2,
      description: '  A presenter points at the interface.  ',
      visibleText: '  Publish  ',
      usefulForPosting: true,
    };
    const { service } = createService({
      analyzeVideoFrames: jest.fn().mockResolvedValue({
        ...defaultVideoInsights,
        scenes: [
          scene,
          { ...scene, description: 'A presenter points at the interface.' },
          { ...scene, description: ' ' },
        ],
      }),
    });

    const result = await service.build('org-1', request as any);

    expect(result.source.scenes).toEqual([
      {
        timestampSeconds: 4.2,
        description: 'A presenter points at the interface.',
        visibleText: 'Publish',
        usefulForPosting: true,
      },
    ]);
  });

  it('keeps transcript facts when visual analysis returns eight facts', async () => {
    const visualFacts = Array.from(
      { length: 8 },
      (_, index) => `Visual fact ${index + 1}`
    );
    const transcriptFacts = [
      'Transcript fact 1',
      'Transcript fact 2',
      'Transcript fact 3',
      'Transcript fact 4',
    ];
    const { service } = createService({
      analyzeVideoFrames: jest.fn().mockResolvedValue({
        ...defaultVideoInsights,
        facts: [...visualFacts, visualFacts[0]],
      }),
      summarizeTranscript: jest.fn().mockResolvedValue({
        transcriptSummary: 'Transcript summary.',
        facts: transcriptFacts,
        unknowns: [],
        coreMessage: 'Transcript message.',
        sourceConfidence: 0.8,
        voiceProfile: null,
      }),
    });

    const result = await service.build('org-1', request as any);

    expect(result.source.facts).toHaveLength(8);
    expect(result.source.facts).toEqual(
      expect.arrayContaining([
        ...transcriptFacts,
        'Visual fact 1',
        'Visual fact 2',
      ])
    );
  });

  it('cleans up the prepared file after success and downstream failure', async () => {
    const { service } = createService();
    await service.build('org-1', request as any);
    expect(cleanup).toHaveBeenCalledTimes(1);

    jest.clearAllMocks();
    prepareVideoMediaFile.mockResolvedValue({
      inputPath: '/tmp/postiz-video/video.mp4',
      isTemporary: true,
      cleanup,
    });
    const failing = createService({
      summarizeTranscript: jest.fn().mockRejectedValue(new Error('OpenAI failed')),
    });
    await expect(failing.service.build('org-1', request as any)).rejects.toThrow(
      'OpenAI failed'
    );
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('uses the knowledge-base voice profile when transcript analysis returns null', async () => {
    const { service } = createService({}, {}, voiceProfile);
    const result = await service.build('org-1', request as any);

    expect(result.voiceProfile).toEqual(voiceProfile);
  });

  it('does not regress image analysis', async () => {
    const { service, modelService } = createService(
      {},
      {
        path: 'https://example.com/image.png',
        originalName: 'image.png',
        name: 'image.png',
      }
    );

    const result = await service.build('org-1', {
      ...request,
      transcript: undefined,
    } as any);

    expect(readOrFetch).toHaveBeenCalledWith('https://example.com/image.png');
    expect(modelService.analyzeImage).toHaveBeenCalled();
    expect(prepareVideoMediaFile).not.toHaveBeenCalled();
    expect(result.media.mediaType).toBe('image');
    expect(result.blocked).toBe(false);
  });
});
