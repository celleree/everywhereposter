import { SourceBriefService } from '@gitroom/nestjs-libraries/copy-generation/source-brief.service';

jest.mock('@gitroom/helpers/utils/read.or.fetch', () => ({
  readOrFetch: jest.fn(),
}));

const voiceProfile = {
  sentenceLength: 'mixed' as const,
  lineBreakHabit: 'moderate' as const,
  ctaStyle: 'invite' as const,
  vocabularyTendencies: ['concrete'],
  tabooPhrases: [] as string[],
  preferredOpenings: [] as string[],
  confidence: 0.8,
};

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

const createService = (
  knowledgeBaseVoiceProfile?: typeof voiceProfile,
  modelOverrides: Record<string, unknown> = {}
) => {
  const mediaRepository = {
    getMediaByOrganizationIdAndId: jest.fn().mockResolvedValue({
      id: 'media-1',
      path: 'https://example.com/video.mp4',
      originalName: 'video.mp4',
      name: 'video.mp4',
      alt: null,
    }),
  };
  const modelService = {
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

  return {
    service: new SourceBriefService(
      mediaRepository as any,
      modelService as any,
      knowledgeBaseService as any
    ),
    modelService,
  };
};

const request = {
  mediaId: 'media-1',
  platforms: ['linkedin'],
  goal: 'position',
  knowledgeBaseFacts: [] as string[],
  transcript: {
    text: 'A sample transcript with concrete details.',
    source: 'manual' as const,
  },
};

const { readOrFetch } = jest.requireMock(
  '@gitroom/helpers/utils/read.or.fetch'
) as { readOrFetch: jest.Mock };

describe('SourceBriefService video grounding', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    readOrFetch.mockResolvedValue(Buffer.from('video-file'));
  });

  it('omits a null transcript voice profile', async () => {
    const { service } = createService();
    const result = await service.build('org-1', request as any);

    expect(result.voiceProfile).toBeUndefined();
  });

  it('replaces a null transcript voice profile with the knowledge-base fallback', async () => {
    const { service } = createService(voiceProfile);
    const result = await service.build('org-1', request as any);

    expect(result.voiceProfile).toEqual(voiceProfile);
  });

  it('auto-transcribes videos whose original file is larger than 25 MB', async () => {
    readOrFetch.mockResolvedValue(Buffer.alloc(25 * 1024 * 1024 + 1));
    const { service } = createService();

    const result = await service.build('org-1', {
      ...request,
      transcript: undefined,
    } as any);

    expect(result.blocked).toBe(false);
    expect(result.transcript).toEqual({
      text: 'A generated transcript with concrete details.',
      source: 'generated',
      confidence: 0.68,
    });
  });

  it('analyzes representative video frames with the available transcript', async () => {
    const { service, modelService } = createService();

    const result = await service.build('org-1', request as any);

    expect(modelService.analyzeVideoFrames).toHaveBeenCalledWith(
      expect.objectContaining({
        mimeType: 'video/mp4',
        originalName: 'video.mp4',
        transcriptText: request.transcript.text,
      })
    );
    expect(result.source.visualSummary).toBe(defaultVideoInsights.visualSummary);
    expect(result.source.facts).toEqual(
      expect.arrayContaining(defaultVideoInsights.facts)
    );
    expect(result.source.scenes).toEqual(defaultVideoInsights.scenes);
    expect(result.blocked).toBe(false);
  });

  it('continues with transcript grounding when frame analysis fails', async () => {
    const { service } = createService(undefined, {
      analyzeVideoFrames: jest
        .fn()
        .mockRejectedValue(new Error('ffmpeg could not extract frames')),
    });

    const result = await service.build('org-1', request as any);

    expect(result.blocked).toBe(false);
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'VIDEO_VISUAL_ANALYSIS_FAILED' }),
      ])
    );
    expect(result.source.transcriptSummary).toBe('A concise transcript summary.');
  });

  it('allows visual-only grounding when a silent video has usable frames', async () => {
    const { service } = createService(undefined, {
      transcribeVideo: jest.fn().mockResolvedValue({ text: '' }),
    });

    const result = await service.build('org-1', {
      ...request,
      transcript: undefined,
    } as any);

    expect(result.transcript).toBeUndefined();
    expect(result.blocked).toBe(false);
    expect(result.source.scenes).toEqual(defaultVideoInsights.scenes);
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'NO_TRANSCRIPT' })])
    );
  });

  it('blocks generation when neither transcript nor usable frame analysis exists', async () => {
    const { service } = createService(undefined, {
      transcribeVideo: jest.fn().mockResolvedValue({ text: '' }),
      analyzeVideoFrames: jest
        .fn()
        .mockRejectedValue(new Error('No video stream found')),
    });

    const result = await service.build('org-1', {
      ...request,
      transcript: undefined,
    } as any);

    expect(result.blocked).toBe(true);
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'VIDEO_VISUAL_ANALYSIS_FAILED' }),
        expect.objectContaining({ code: 'NO_TRANSCRIPT' }),
      ])
    );
  });
});
