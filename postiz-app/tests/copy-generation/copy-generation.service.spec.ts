import { CopyGenerationService } from '@gitroom/nestjs-libraries/copy-generation/copy-generation.service';
import { AntiGenericService } from '@gitroom/nestjs-libraries/copy-generation/anti-generic.service';

const createSourceBriefService = (overrides: Record<string, any> = {}) => ({
  build: jest.fn().mockResolvedValue({
    media: {
      id: 'media-1',
      path: 'https://example.com/image.png',
      mediaType: 'image',
      mimeType: 'image/png',
    },
    source: {
      mediaType: 'image',
      visualSummary: 'A close-up of a product shelf with handwritten labels',
      facts: ['The labels are handwritten', 'The shelf is organized by color'],
      unknowns: [],
    },
    sourceConfidence: 0.82,
    coreMessage: 'Small production details can change how a product feels.',
    warnings: [],
    storedKnowledgeBaseFacts: [],
    overlapReferenceTexts: [],
    blocked: false,
    ...overrides,
  }),
});

const createModelService = (overrides: Record<string, any> = {}) => ({
  generatePlatformDraft: jest.fn().mockResolvedValue({
    draft:
      'We still hand-label small-batch inventory because it catches mistakes before they hit the shelf.',
    angle: 'behind the scenes',
    hook: 'Small production details matter',
    cta: 'What quality check have you kept, even when it slows the process down?',
  }),
  rewriteDraft: jest.fn().mockResolvedValue({
    draft:
      'We still hand-label small-batch inventory because it catches mistakes before anything ships.',
  }),
  ...overrides,
});

const consumeGenerator = async (service: CopyGenerationService, body: any) => {
  const events = [];
  for await (const event of service.generate('org-1', body)) {
    events.push(event);
  }

  return events;
};

describe('CopyGenerationService', () => {
  it('returns a completed linkedin draft from grounded image input', async () => {
    const sourceBriefService = createSourceBriefService();
    const modelService = createModelService();
    const service = new CopyGenerationService(
      sourceBriefService as any,
      new AntiGenericService(),
      modelService as any
    );

    const events = await consumeGenerator(service, {
      mediaId: 'media-1',
      platforms: ['linkedin'],
      goal: 'position',
      knowledgeBaseFacts: [],
    });

    const completed = events[events.length - 1];
    expect(completed.name).toBe('completed');
    expect(completed.data.status).toBe('complete');
    expect(completed.data.results[0]).toMatchObject({
      platform: 'linkedin',
      rewritten: false,
    });
    expect(modelService.generatePlatformDraft).toHaveBeenCalledTimes(1);
  });

  it('clamps x drafts to the shared hard cap', async () => {
    const sourceBriefService = createSourceBriefService();
    const modelService = createModelService({
      generatePlatformDraft: jest.fn().mockResolvedValue({
        draft: 'A'.repeat(320),
        angle: '',
        hook: '',
        cta: '',
      }),
    });
    const service = new CopyGenerationService(
      sourceBriefService as any,
      new AntiGenericService(),
      modelService as any
    );

    const events = await consumeGenerator(service, {
      mediaId: 'media-1',
      platforms: ['x'],
      goal: 'attract',
      knowledgeBaseFacts: [],
    });

    const completed = events[events.length - 1].data;
    expect(completed.results[0].charCount).toBeLessThanOrEqual(280);
    expect(completed.results[0].warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'CHAR_LIMIT_CLAMPED' }),
      ])
    );
  });

  it('merges stored knowledge-base facts into the prompt brief', async () => {
    const sourceBriefService = createSourceBriefService({
      storedKnowledgeBaseFacts: ['The founder records teardown notes after each launch'],
    });
    const modelService = createModelService();
    const service = new CopyGenerationService(
      sourceBriefService as any,
      new AntiGenericService(),
      modelService as any
    );

    await consumeGenerator(service, {
      mediaId: 'media-1',
      platforms: ['linkedin'],
      goal: 'position',
      knowledgeBaseFacts: [{ text: 'The team ships updates every Tuesday' }],
    });

    const brief = modelService.generatePlatformDraft.mock.calls[0][0];
    expect(brief.personalization.knowledgeBaseFacts).toEqual([
      'The team ships updates every Tuesday',
      'The founder records teardown notes after each launch',
    ]);
  });

  it('rewrites copy that scores as too generic', async () => {
    const sourceBriefService = createSourceBriefService();
    const modelService = createModelService({
      generatePlatformDraft: jest.fn().mockResolvedValue({
        draft:
          'This is your sign to unlock a game-changer for your workflow. Let that sink in!',
        angle: '',
        hook: '',
        cta: '',
      }),
    });
    const service = new CopyGenerationService(
      sourceBriefService as any,
      new AntiGenericService(),
      modelService as any
    );

    const events = await consumeGenerator(service, {
      mediaId: 'media-1',
      platforms: ['linkedin'],
      goal: 'position',
      knowledgeBaseFacts: [],
    });

    const completed = events[events.length - 1].data;
    expect(modelService.rewriteDraft).toHaveBeenCalledTimes(1);
    expect(completed.results[0].rewritten).toBe(true);
    expect(completed.results[0].warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'GENERIC_TONE_REWRITTEN' }),
      ])
    );
  });

  it('fails fast when video generation is blocked by missing transcript', async () => {
    const sourceBriefService = createSourceBriefService({
      media: {
        id: 'media-1',
        path: 'https://example.com/video.mp4',
        mediaType: 'video',
        mimeType: 'video/mp4',
      },
      source: {
        mediaType: 'video',
        visualSummary: 'Video asset: clip.mp4',
        facts: [],
        unknowns: ['Specific spoken details are unavailable without a transcript.'],
      },
      sourceConfidence: 0.2,
      warnings: [
        {
          code: 'TRANSCRIPT_REQUIRED',
          message: 'Add a transcript to generate grounded copy from this video.',
        },
      ],
      storedKnowledgeBaseFacts: [],
      overlapReferenceTexts: [],
      blocked: true,
    });
    const modelService = createModelService();
    const service = new CopyGenerationService(
      sourceBriefService as any,
      new AntiGenericService(),
      modelService as any
    );

    const events = await consumeGenerator(service, {
      mediaId: 'media-1',
      platforms: ['linkedin'],
      goal: 'position',
      knowledgeBaseFacts: [],
    });

    const completed = events[events.length - 1].data;
    expect(completed.status).toBe('failed');
    expect(completed.results).toHaveLength(0);
    expect(modelService.generatePlatformDraft).not.toHaveBeenCalled();
  });

  it('rewrites drafts that copy transcript phrasing too closely', async () => {
    const sourceBriefService = createSourceBriefService({
      overlapReferenceTexts: [
        'we still hand label small batch inventory because it catches mistakes before anything ships',
      ],
    });
    const modelService = createModelService({
      generatePlatformDraft: jest.fn().mockResolvedValue({
        draft:
          'We still hand-label small-batch inventory because it catches mistakes before anything ships.',
        angle: '',
        hook: '',
        cta: '',
      }),
    });
    const service = new CopyGenerationService(
      sourceBriefService as any,
      new AntiGenericService(),
      modelService as any
    );

    const events = await consumeGenerator(service, {
      mediaId: 'media-1',
      platforms: ['linkedin'],
      goal: 'position',
      knowledgeBaseFacts: [],
    });

    const completed = events[events.length - 1].data;
    expect(modelService.rewriteDraft).toHaveBeenCalled();
    expect(completed.results[0].warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'TRANSCRIPT_OVERLAP_REWRITTEN' }),
      ])
    );
  });
});
