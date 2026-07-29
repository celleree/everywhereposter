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

const getMessageText = (content: unknown) => {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter(
      (part): part is { type: 'text'; text: string } =>
        Boolean(part) &&
        typeof part === 'object' &&
        (part as { type?: unknown }).type === 'text' &&
        typeof (part as { text?: unknown }).text === 'string'
    )
    .map((part) => part.text)
    .join('\n');
};

const getImageUrls = (content: unknown) => {
  if (!Array.isArray(content)) return [];
  return content
    .filter(
      (part): part is { type: 'image_url'; image_url: { url: string } } =>
        Boolean(part) &&
        typeof part === 'object' &&
        (part as { type?: unknown }).type === 'image_url' &&
        typeof (part as { image_url?: { url?: unknown } }).image_url?.url === 'string'
    )
    .map((part) => part.image_url.url);
};

const createSourceBrief = () => ({
  media: {
    id: 'media-visual-only',
    path: 'https://example.com/silent-video.mp4',
    originalName: 'silent-video.mp4',
    alt: null,
    mediaType: 'video' as const,
    mimeType: 'video/mp4',
  },
  source: {
    mediaType: 'video' as const,
    visualSummary: 'A product dashboard is shown without spoken narration.',
    transcriptSummary: '',
    facts: ['A product dashboard is visible.'],
    unknowns: [],
    scenes: [
      {
        timestampSeconds: 6,
        description: 'A product dashboard fills the frame.',
        visibleText: 'Publish',
        usefulForPosting: true,
      },
    ],
  },
  transcript: undefined,
  storedKnowledgeBaseFacts: [],
  overlapReferenceTexts: [],
  sourceConfidence: 0.84,
  coreMessage: 'The product makes publishing easier.',
  warnings: [],
  blocked: false,
});

const createGroundedFrameResponse = () => ({
  choices: [
    {
      message: {
        parsed: {
          recommendedImages: [
            {
              type: 'video_frame',
              platform: 'instagram',
              purpose: 'Show the product interface from the source video.',
              rationale: 'The frame contains grounded visual evidence.',
              aspectRatio: '4:5',
              title: '',
              headline: '',
              subheadline: '',
              captionHint: '',
              sourceTimestampSeconds: 6,
              sourceQuote: 'Publish',
              visualSummary: 'A dashboard with a visible Publish button.',
              visualPrompt: '',
              altText: 'A dashboard showing a Publish button.',
              confidence: 0.85,
              warnings: [],
            },
          ],
        },
      },
    },
  ],
});

describe('ImagePlanService visual-only videos', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates a grounded frame plan when transcript is unavailable', async () => {
    getParseMock().mockResolvedValue(createGroundedFrameResponse());

    const result = await new ImagePlanService().generate(
      createSourceBrief() as any,
      ['instagram']
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      type: 'video_frame',
      platform: 'instagram',
      sourceTimestampSeconds: 6,
      sourceQuote: 'Publish',
    });

    const request = getParseMock().mock.calls[0][0];
    expect(getMessageText(request.messages[1].content)).toContain(
      'Transcript:\nnone'
    );
  });

  it('does not attach unsupported legacy reference formats to the vision request', async () => {
    getParseMock().mockResolvedValue({
      choices: [
        {
          message: {
            parsed: {
              recommendedImages: [],
            },
          },
        },
      ],
    });
    const referenceService = {
      getActiveForSourceMedia: jest.fn().mockResolvedValue([
        {
          id: 'reference-tiff',
          name: 'Legacy TIFF reference',
          path: 'https://example.com/reference.tiff',
          originalName: 'reference.tiff',
          tags: ['editorial'],
          isPrimary: false,
        },
      ]),
      markUsedForSourceMedia: jest.fn(),
    };

    await new ImagePlanService(referenceService as any).generate(
      createSourceBrief() as any,
      ['instagram']
    );

    const request = getParseMock().mock.calls[0][0];
    expect(getMessageText(request.messages[1].content)).toContain(
      'Legacy TIFF reference'
    );
    expect(getImageUrls(request.messages[1].content)).toEqual([]);
  });

  it('omits localhost and private-network references from image inputs', async () => {
    getParseMock().mockResolvedValue({
      choices: [
        {
          message: {
            parsed: {
              recommendedImages: [],
            },
          },
        },
      ],
    });
    const referenceService = {
      getActiveForSourceMedia: jest.fn().mockResolvedValue([
        {
          id: 'reference-localhost',
          name: 'Local reference',
          path: 'http://localhost:4200/uploads/reference.png',
          originalName: 'reference.png',
          tags: [],
          isPrimary: false,
        },
        {
          id: 'reference-private',
          name: 'Private network reference',
          path: 'http://192.168.1.20/reference.webp',
          originalName: 'reference.webp',
          tags: [],
          isPrimary: false,
        },
        {
          id: 'reference-public',
          name: 'Public reference',
          path: 'https://cdn.example.com/reference.jpg',
          originalName: 'reference.jpg',
          tags: [],
          isPrimary: true,
        },
      ]),
      markUsedForSourceMedia: jest.fn(),
    };

    await new ImagePlanService(referenceService as any).generate(
      createSourceBrief() as any,
      ['instagram']
    );

    const request = getParseMock().mock.calls[0][0];
    const messageText = getMessageText(request.messages[1].content);
    expect(messageText).toContain('Local reference');
    expect(messageText).toContain('Private network reference');
    expect(messageText).toContain('Public reference');
    expect(getImageUrls(request.messages[1].content)).toEqual([
      'https://cdn.example.com/reference.jpg',
    ]);
  });

  it('returns generated plans when reference usage tracking fails', async () => {
    getParseMock().mockResolvedValue(createGroundedFrameResponse());
    const referenceService = {
      getActiveForSourceMedia: jest.fn().mockResolvedValue([
        {
          id: 'reference-png',
          name: 'Editorial reference',
          path: 'https://example.com/reference.png',
          originalName: 'reference.png',
          tags: ['editorial'],
          isPrimary: true,
        },
      ]),
      markUsedForSourceMedia: jest
        .fn()
        .mockRejectedValue(new Error('database temporarily unavailable')),
    };

    const result = await new ImagePlanService(referenceService as any).generate(
      createSourceBrief() as any,
      ['instagram']
    );

    expect(referenceService.markUsedForSourceMedia).toHaveBeenCalledWith(
      'media-visual-only',
      expect.any(Array),
      ['instagram']
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      type: 'video_frame',
      platform: 'instagram',
      sourceTimestampSeconds: 6,
    });
  });
});
