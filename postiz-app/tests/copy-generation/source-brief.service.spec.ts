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

const createService = (knowledgeBaseVoiceProfile?: typeof voiceProfile) => {
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
    summarizeTranscript: jest.fn().mockResolvedValue({
      transcriptSummary: 'A concise transcript summary.',
      facts: ['A concrete fact', 'Another concrete fact'],
      unknowns: [],
      coreMessage: 'A grounded core message.',
      sourceConfidence: 0.8,
      voiceProfile: null,
    }),
  };
  const knowledgeBaseService = {
    resolvePersonalization: jest.fn().mockResolvedValue({
      storedFacts: [],
      overlapReferenceTexts: [],
      voiceProfile: knowledgeBaseVoiceProfile,
      explicitVoiceProfileMissed: false,
    }),
  };

  return new SourceBriefService(
    mediaRepository as any,
    modelService as any,
    knowledgeBaseService as any
  );
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

describe('SourceBriefService nullable voice profile', () => {
  it('omits a null transcript voice profile', async () => {
    const result = await createService().build('org-1', request as any);

    expect(result.voiceProfile).toBeUndefined();
  });

  it('replaces a null transcript voice profile with the knowledge-base fallback', async () => {
    const result = await createService(voiceProfile).build(
      'org-1',
      request as any
    );

    expect(result.voiceProfile).toEqual(voiceProfile);
  });

  it('auto-transcribes videos whose original file is larger than 25 MB', async () => {
    const { readOrFetch } = jest.requireMock(
      '@gitroom/helpers/utils/read.or.fetch'
    ) as { readOrFetch: jest.Mock };
    readOrFetch.mockResolvedValue(Buffer.alloc(25 * 1024 * 1024 + 1));
    const service = createService();

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
});
