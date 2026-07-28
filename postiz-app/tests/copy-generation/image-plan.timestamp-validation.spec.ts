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
    visualSummary: 'A speaker moves between two visibly different scenes.',
    transcriptSummary: 'The speaker explains a distribution workflow.',
    facts: ['The speaker appears in two different settings.'],
    unknowns: [],
    scenes: [
      {
        timestampSeconds: 4.2,
        description: 'The speaker addresses the camera in an office.',
        visibleText: '',
        usefulForPosting: true,
      },
      {
        timestampSeconds: 18.4,
        description: 'The speaker points to a product dashboard.',
        visibleText: 'Publish',
        usefulForPosting: true,
      },
    ],
  },
  transcript: {
    text: 'One video can become several platform-ready posts.',
    source: 'generated' as const,
    confidence: 0.68,
  },
  storedKnowledgeBaseFacts: [],
  overlapReferenceTexts: [],
  sourceConfidence: 0.82,
  coreMessage: 'One video should become a complete distribution set.',
  warnings: [],
  blocked: false,
};

const frameDraft = (sourceTimestampSeconds: number) => ({
  type: 'video_frame',
  platform: 'linkedin',
  purpose: 'Use an authentic frame.',
  rationale: 'The selected scene supports the post.',
  aspectRatio: '4:5',
  title: '',
  headline: '',
  subheadline: '',
  captionHint: '',
  sourceTimestampSeconds,
  sourceQuote: '',
  visualSummary: 'The speaker points to a product dashboard.',
  visualPrompt: '',
  altText: 'Speaker pointing to a product dashboard.',
  confidence: 0.8,
  warnings: [],
});

describe('ImagePlanService timestamp validation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('accepts minor timestamp rounding and binds it to the supplied scene', async () => {
    getParseMock().mockResolvedValue({
      choices: [
        {
          message: {
            parsed: {
              recommendedImages: [frameDraft(18.2)],
            },
          },
        },
      ],
    });

    const result = await new ImagePlanService().generate(videoSourceBrief, [
      'linkedin',
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].sourceTimestampSeconds).toBe(18.4);
  });

  it('rejects a timestamp that does not identify any supplied scene', async () => {
    getParseMock().mockResolvedValue({
      choices: [
        {
          message: {
            parsed: {
              recommendedImages: [frameDraft(12)],
            },
          },
        },
      ],
    });

    const result = await new ImagePlanService().generate(videoSourceBrief, [
      'linkedin',
    ]);

    expect(result).toEqual([]);
  });
});
