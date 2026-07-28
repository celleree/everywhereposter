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
    visualSummary: 'A founder speaks beside a dashboard.',
    transcriptSummary: 'The founder explains a simpler distribution workflow.',
    facts: ['A product dashboard is visible beside the speaker.'],
    unknowns: [],
    scenes: [
      {
        timestampSeconds: 4.2,
        description: 'The founder speaks directly to camera.',
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

const makeQuoteCard = (sourceQuote: string) => ({
  type: 'quote_card',
  platform: 'linkedin',
  purpose: 'Highlight the main insight.',
  rationale: 'The message works as controlled typography.',
  aspectRatio: '4:5',
  title: '',
  headline: 'Distribution should be simpler.',
  subheadline: '',
  captionHint: '',
  sourceQuote,
  visualSummary: 'A minimal quote card.',
  visualPrompt: '',
  altText: 'Quote card about content distribution.',
  confidence: 0.8,
  warnings: [],
});

describe('ImagePlanService source quote grounding', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('keeps a source quote found in the transcript after punctuation normalization', async () => {
    getParseMock().mockResolvedValue({
      choices: [
        {
          message: {
            parsed: {
              recommendedImages: [
                makeQuoteCard(
                  'Distribution should not take longer than creating the original video!'
                ),
              ],
            },
          },
        },
      ],
    });

    const result = await new ImagePlanService().generate(sourceBrief, ['linkedin']);

    expect(result[0]).toMatchObject({
      sourceQuote:
        'Distribution should not take longer than creating the original video!',
    });
    expect(result[0].warnings).not.toContain(
      'Source quote was omitted because it could not be verified against the source brief.'
    );
  });

  it('omits an invented source quote and adds a warning', async () => {
    getParseMock().mockResolvedValue({
      choices: [
        {
          message: {
            parsed: {
              recommendedImages: [
                makeQuoteCard('This workflow increased revenue by 300 percent.'),
              ],
            },
          },
        },
      ],
    });

    const result = await new ImagePlanService().generate(sourceBrief, ['linkedin']);

    expect(result[0].sourceQuote).toBeUndefined();
    expect(result[0].warnings).toContain(
      'Source quote was omitted because it could not be verified against the source brief.'
    );
  });
});
