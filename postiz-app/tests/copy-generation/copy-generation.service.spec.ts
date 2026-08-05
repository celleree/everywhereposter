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

const getGeneratedPromptForPlatform = async (platform: string) => {
  const sourceBriefService = createSourceBriefService();
  const modelService = createModelService();
  const service = new CopyGenerationService(
    sourceBriefService as any,
    new AntiGenericService(),
    modelService as any
  );

  await consumeGenerator(service, {
    mediaId: 'media-1',
    platforms: [platform],
    goal: 'position',
    knowledgeBaseFacts: [],
  });

  return modelService.generatePlatformDraft.mock.calls[0][1] as string;
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
      origin: 'generated',
      rewritten: false,
    });
    expect(modelService.generatePlatformDraft).toHaveBeenCalledTimes(1);
    expect(modelService.generatePlatformDraft.mock.calls[0][1]).toContain(
      'founder/operator insight, concrete lesson, structured specificity'
    );
    expect(modelService.generatePlatformDraft.mock.calls[0][1]).toContain(
      'Write one strong LinkedIn text post from the video/transcript'
    );
  });

  it('adds text-native and quality-focused guidance for linkedin', async () => {
    const prompt = await getGeneratedPromptForPlatform('linkedin');

    expect(prompt).toContain('Text-post mode');
    expect(prompt).toContain('standalone text-native post');
    expect(prompt).toContain(
      'Prioritize one strong founder/operator-style post'
    );
    expect(prompt).toContain('Do not produce several weak angles');
  });

  it('asks x to consider multiple angles internally but return one tight post', async () => {
    const prompt = await getGeneratedPromptForPlatform('x');

    expect(prompt).toContain('Internally consider 3-5 hooks');
    expect(prompt).toContain('return only the strongest single X post');
    expect(prompt).toContain('never a mini-blog');
    expect(prompt).toContain('Return one standalone draft only');
  });

  it('keeps threads conversational while returning one best short-form post', async () => {
    const prompt = await getGeneratedPromptForPlatform('threads');

    expect(prompt).toContain('conversational angles');
    expect(prompt).toContain('strongest single Threads post');
    expect(prompt).toContain('current and personal');
    expect(prompt).toContain('short and concrete');
  });

  it('makes facebook conversational and community-readable without ad copy', async () => {
    const prompt = await getGeneratedPromptForPlatform('facebook');

    expect(prompt).toContain('community-readable');
    expect(prompt).toContain('human update');
    expect(prompt).toContain('slightly more context than X or Threads');
    expect(prompt).toContain('Do not sound like an ad');
  });

  it('keeps instagram caption-oriented', async () => {
    const prompt = await getGeneratedPromptForPlatform('instagram');

    expect(prompt).toContain('Caption mode');
    expect(prompt).toContain('media-grounded caption');
    expect(prompt).toContain(
      'Write a caption that is grounded in the visual media'
    );
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
      storedKnowledgeBaseFacts: [
        'The founder records teardown notes after each launch',
      ],
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

  it('adds additional context to the generation brief and prompt', async () => {
    const sourceBriefService = createSourceBriefService();
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
      additionalContext: 'Mention that registration closes Friday.',
    });

    const [brief, prompt] = modelService.generatePlatformDraft.mock.calls[0];
    expect(brief.strategy.additionalContext).toBe(
      'Mention that registration closes Friday.'
    );
    expect(prompt).toContain('Explicit user instructions and context:');
    expect(prompt).toContain('Mention that registration closes Friday.');
  });

  it('adapts the authoritative source caption once per unique platform', async () => {
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
    const sourceCaption =
      'Registration closes Friday. Save your seat at example.com.';

    const events = await consumeGenerator(service, {
      mediaId: 'media-1',
      platforms: ['linkedin', 'linkedin', 'instagram'],
      goal: 'convert',
      captionMode: 'adapt-by-platform',
      sourceCaption,
    });

    const completed = events[events.length - 1].data;
    expect(modelService.generatePlatformDraft).toHaveBeenCalledTimes(2);
    expect(modelService.rewriteDraft).not.toHaveBeenCalled();
    expect(completed.results).toHaveLength(2);
    expect(completed.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ platform: 'linkedin', origin: 'adapted' }),
        expect.objectContaining({ platform: 'instagram', origin: 'adapted' }),
      ])
    );
    for (const [brief, prompt] of modelService.generatePlatformDraft.mock
      .calls) {
      expect(brief.strategy.sourceCaption).toBe(sourceCaption);
      expect(prompt).toContain('authoritative starting point');
      expect(prompt).toContain(sourceCaption);
      expect(prompt).toContain('Preserve its facts, meaning, offer, and CTA');
    }
  });

  it('returns the exact original caption everywhere without model calls', async () => {
    const sourceBriefService = createSourceBriefService();
    const modelService = createModelService();
    const imagePlanService = { generate: jest.fn() };
    const service = new CopyGenerationService(
      sourceBriefService as any,
      new AntiGenericService(),
      modelService as any,
      imagePlanService as any
    );
    const sourceCaption = `  ${'A'.repeat(281)}\nKeep this spacing.  `;

    const events = await consumeGenerator(service, {
      mediaId: 'media-1',
      platforms: ['x', 'x', 'facebook'],
      goal: 'position',
      captionMode: 'use-everywhere',
      sourceCaption,
    });

    const completed = events[events.length - 1].data;
    expect(sourceBriefService.build).not.toHaveBeenCalled();
    expect(modelService.generatePlatformDraft).not.toHaveBeenCalled();
    expect(modelService.rewriteDraft).not.toHaveBeenCalled();
    expect(imagePlanService.generate).not.toHaveBeenCalled();
    expect(completed.results).toHaveLength(2);
    expect(
      completed.results.every((result: any) => result.draft === sourceCaption)
    ).toBe(true);
    expect(
      completed.results.every((result: any) => result.origin === 'original')
    ).toBe(true);
    expect(
      completed.results.find((result: any) => result.platform === 'x')
    ).toMatchObject({
      charCount: sourceCaption.length,
      warnings: [
        expect.objectContaining({ code: 'ORIGINAL_CAPTION_OVER_LIMIT' }),
      ],
    });
    expect(
      completed.results.find((result: any) => result.platform === 'facebook')
        .warnings
    ).toEqual([]);
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
        unknowns: [
          'Specific spoken details are unavailable without a transcript.',
        ],
      },
      sourceConfidence: 0.2,
      warnings: [
        {
          code: 'TRANSCRIPT_REQUIRED',
          message:
            'Add a transcript to generate grounded copy from this video.',
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
