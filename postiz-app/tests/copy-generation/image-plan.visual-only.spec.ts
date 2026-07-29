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

describe('ImagePlanService visual-only videos', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates a grounded frame plan when transcript is unavailable', async () => {
    getParseMock().mockResolvedValue({
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

    const sourceBrief = {
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
    };

    const result = await new ImagePlanService().generate(sourceBrief as any, [
      'instagram',
    ]);

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
});
