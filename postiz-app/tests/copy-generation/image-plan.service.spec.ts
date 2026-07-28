import { ImagePlanService } from '@gitroom/nestjs-libraries/copy-generation/image-plan.service';
import { CopyGenerationService } from '@gitroom/nestjs-libraries/copy-generation/copy-generation.service';
import { AntiGenericService } from '@gitroom/nestjs-libraries/copy-generation/anti-generic.service';

jest.mock('openai', () => {
  const parse = jest.fn();

  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      chat: { completions: { parse } },
    })),
    parse,
  };
});

const getParseMock = () =>
  (jest.requireMock('openai') as { parse: jest.Mock }).parse;

const videoSourceBrief = {
  media: {
    id: 'media-1',
    path: 'https://example.com/video.mp4',
    originalName: 'video.mp4',
    alt: null,
    mediaType: 'video' as const,
    mimeType: 'video/mp4',
  },
  source: {
    mediaType: 'video' as const,
    visualSummary: 'A founder speaks to camera beside a product dashboard.',
    transcriptSummary:
      'The founder explains that distribution should not take longer than creating the original video.',
    facts: [
      'A founder speaks directly to camera.',
      'A product dashboard is visible beside the speaker.',
    ],
    unknowns: [],
    scenes: [
      {
        timestampSeconds: 4.2,
        description: 'The founder speaks directly to camera.',
        visibleText: '',
        usefulForPosting: true,
      },
      {
        timestampSeconds: 18.4,
        description: 'The founder points toward the product dashboard.',
        visibleText: 'Publish',
        usefulForPosting: true,
      },
    ],
  },
  transcript: {
    text: 'Distribution should not take longer than creating the original video.',
    source: 'generated' as const,
    confidence: 0.68,
  },
  storedKnowledgeBaseFacts: [],
  overlapReferenceTexts: [],
  sourceConfidence: 0.82,
  coreMessage: 'One video should become platform-ready content without manual rebuilding.',
  warnings: [],
  blocked: false,
};

describe('ImagePlanService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns one grounded platform-specific recommendation and normalizes timestamps', async () => {
    getParseMock().mockResolvedValue({
      choices: [
        {
          message: {
            parsed: {
              recommendedImages: [
                {
                  type: 'video_frame',
                  platform: 'linkedin',
                  purpose: 'Support the founder insight with an authentic moment.',
                  rationale: 'The source includes a clear speaking frame.',
                  aspectRatio: '4:5',
                  title: '',
                  headline: '',
                  subheadline: '',
                  captionHint: 'Use beside the LinkedIn text post.',
                  sourceTimestampSeconds: 17.9,
                  sourceQuote: '',
                  visualSummary: 'Founder pointing toward the dashboard.',
                  visualPrompt: '',
                  altText: 'Founder pointing toward a product dashboard.',
                  confidence: 0.84,
                  warnings: [],
                },
                {
                  type: 'quote_card',
                  platform: 'linkedin',
                  purpose: 'Duplicate recommendation that should be removed.',
                  rationale: 'Only one recommendation is allowed per platform.',
                  aspectRatio: '4:5',
                  title: '',
                  headline: 'One video should travel further.',
                  subheadline: '',
                  captionHint: '',
                  sourceQuote: '',
                  visualSummary: 'Controlled typography card.',
                  visualPrompt: '',
                  altText: 'Quote card about video distribution.',
                  confidence: 0.7,
                  warnings: [],
                },
                {
                  type: 'ai_visual',
                  platform: 'instagram',
                  purpose: 'Explain distribution across platforms.',
                  rationale: 'A visual metaphor makes the concept easier to scan.',
                  aspectRatio: '4:5',
                  title: '',
                  headline: '',
                  subheadline: '',
                  captionHint: '',
                  sourceQuote: '',
                  visualSummary: 'One central video branching into platform-ready posts.',
                  visualPrompt:
                    'A clean editorial illustration of one video branching into distinct social post formats, no logos, no text.',
                  altText: 'One video branching into several social post formats.',
                  confidence: 0.78,
                  warnings: [],
                },
              ],
            },
          },
        },
      ],
    });

    const result = await new ImagePlanService().generate(videoSourceBrief, [
      'linkedin',
      'instagram',
    ]);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      type: 'video_frame',
      platform: 'linkedin',
      aspectRatio: '4:5',
      sourceTimestampSeconds: 18.4,
    });
    expect(result[1]).toMatchObject({
      type: 'ai_visual',
      platform: 'instagram',
    });
    expect(result[0].id).toEqual(expect.any(String));
  });

  it('drops frame-based recommendations when no grounded scene exists', async () => {
    getParseMock().mockResolvedValue({
      choices: [
        {
          message: {
            parsed: {
              recommendedImages: [
                {
                  type: 'thumbnail',
                  platform: 'youtube',
                  purpose: 'Create a cover.',
                  rationale: 'A cover would help the video.',
                  aspectRatio: '16:9',
                  title: 'Distribution workflow',
                  headline: '',
                  subheadline: '',
                  captionHint: '',
                  sourceTimestampSeconds: 10,
                  sourceQuote: '',
                  visualSummary: 'A cover frame.',
                  visualPrompt: '',
                  altText: 'Video cover.',
                  confidence: 0.7,
                  warnings: [],
                },
              ],
            },
          },
        },
      ],
    });

    const result = await new ImagePlanService().generate(
      {
        ...videoSourceBrief,
        source: {
          ...videoSourceBrief.source,
          scenes: [],
        },
      },
      ['youtube']
    );

    expect(result).toEqual([]);
  });
});

describe('CopyGenerationService image-plan integration', () => {
  it('adds image plans to the completed response without changing copy status', async () => {
    const sourceBriefService = {
      build: jest.fn().mockResolvedValue(videoSourceBrief),
    };
    const modelService = {
      generatePlatformDraft: jest.fn().mockResolvedValue({
        draft: 'One uploaded video should become a complete distribution set.',
        angle: 'distribution',
        hook: 'One video should travel further.',
        cta: '',
      }),
      rewriteDraft: jest.fn(),
    };
    const imagePlanService = {
      generate: jest.fn().mockResolvedValue([
        {
          id: 'plan-1',
          type: 'video_frame',
          platform: 'linkedin',
          purpose: 'Use an authentic founder frame.',
          rationale: 'The frame supports the post.',
          aspectRatio: '4:5',
          sourceTimestampSeconds: 18.4,
          visualSummary: 'Founder beside the dashboard.',
          altText: 'Founder beside a dashboard.',
          confidence: 0.82,
          warnings: [],
        },
      ]),
    };
    const service = new CopyGenerationService(
      sourceBriefService as any,
      new AntiGenericService(),
      modelService as any,
      imagePlanService as any
    );

    const events = [];
    for await (const event of service.generate('org-1', {
      mediaId: 'media-1',
      platforms: ['linkedin'],
      goal: 'position',
      knowledgeBaseFacts: [],
    } as any)) {
      events.push(event);
    }

    expect(events.map((event) => event.name)).toEqual(
      expect.arrayContaining(['image-plan-started', 'image-plan-complete'])
    );
    const completed = events[events.length - 1].data;
    expect(completed.status).toBe('complete');
    expect(completed.imagePlans).toHaveLength(1);
    expect(completed.imagePlans[0]).toMatchObject({
      platform: 'linkedin',
      type: 'video_frame',
    });
  });

  it('keeps completed copy when image planning fails', async () => {
    const service = new CopyGenerationService(
      { build: jest.fn().mockResolvedValue(videoSourceBrief) } as any,
      new AntiGenericService(),
      {
        generatePlatformDraft: jest.fn().mockResolvedValue({
          draft: 'One video should become a complete distribution set.',
          angle: '',
          hook: '',
          cta: '',
        }),
        rewriteDraft: jest.fn(),
      } as any,
      {
        generate: jest.fn().mockRejectedValue(new Error('planner unavailable')),
      } as any
    );

    const events = [];
    for await (const event of service.generate('org-1', {
      mediaId: 'media-1',
      platforms: ['linkedin'],
      goal: 'position',
      knowledgeBaseFacts: [],
    } as any)) {
      events.push(event);
    }

    const completed = events[events.length - 1].data;
    expect(completed.status).toBe('complete');
    expect(completed.results).toHaveLength(1);
    expect(completed.imagePlans).toEqual([]);
    expect(completed.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'IMAGE_PLAN_GENERATION_FAILED' }),
      ])
    );
  });
});
