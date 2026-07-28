import { ImagePlanService } from '@gitroom/nestjs-libraries/copy-generation/image-plan.service';

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

const sourceBrief = {
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
    visualSummary: 'A founder speaks beside a product dashboard.',
    transcriptSummary: 'The founder explains a distribution workflow.',
    facts: ['A founder speaks beside a product dashboard.'],
    unknowns: [],
    scenes: [
      {
        timestampSeconds: 8,
        description: 'The founder points to the dashboard.',
        visibleText: '',
        usefulForPosting: true,
      },
    ],
  },
  transcript: {
    text: 'One video should become platform-ready content.',
    source: 'generated' as const,
    confidence: 0.8,
  },
  storedKnowledgeBaseFacts: [],
  overlapReferenceTexts: [],
  sourceConfidence: 0.85,
  coreMessage: 'One video should become platform-ready content.',
  warnings: [],
  blocked: false,
};

const makeDraft = (overrides: Record<string, unknown>) => ({
  type: 'quote_card',
  platform: 'linkedin',
  purpose: 'Support the platform post.',
  rationale: 'The source supports a concise visual.',
  aspectRatio: '4:5',
  title: '',
  headline: 'One video should travel further.',
  subheadline: '',
  captionHint: '',
  sourceTimestampSeconds: null,
  sourceQuote: '',
  visualSummary: 'A controlled typography card.',
  visualPrompt: '',
  altText: 'Quote card about distributing one video.',
  confidence: 0.8,
  warnings: [],
  ...overrides,
});

describe('ImagePlanService nullable source timestamps', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('accepts null for non-frame plans and omits the timestamp from the result', async () => {
    getParseMock().mockResolvedValue({
      choices: [
        {
          message: {
            parsed: {
              recommendedImages: [makeDraft({})],
            },
          },
        },
      ],
    });

    const result = await new ImagePlanService().generate(sourceBrief as any, [
      'linkedin',
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      type: 'quote_card',
      platform: 'linkedin',
      headline: 'One video should travel further.',
    });
    expect(result[0]).not.toHaveProperty('sourceTimestampSeconds');
  });

  it('rejects a frame-based plan when the model returns a null timestamp', async () => {
    getParseMock().mockResolvedValue({
      choices: [
        {
          message: {
            parsed: {
              recommendedImages: [
                makeDraft({
                  type: 'thumbnail',
                  platform: 'youtube',
                  aspectRatio: '16:9',
                  headline: '',
                  title: 'Distribution workflow',
                  visualSummary: 'A video cover frame.',
                  altText: 'Video cover showing the founder and dashboard.',
                }),
              ],
            },
          },
        },
      ],
    });

    const result = await new ImagePlanService().generate(sourceBrief as any, [
      'youtube',
    ]);

    expect(result).toEqual([]);
  });
});
