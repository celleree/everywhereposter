import { CopyGenerationModelService } from '@gitroom/nestjs-libraries/copy-generation/copy-generation.model.service';

jest.mock('openai', () => {
  const parse = jest.fn();

  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      chat: {
        completions: {
          parse,
        },
      },
      audio: {
        transcriptions: {
          create: jest.fn(),
        },
      },
    })),
    parse,
    toFile: jest.fn(),
  };
});

const getParseMock = () =>
  (jest.requireMock('openai') as { parse: jest.Mock }).parse;

describe('CopyGenerationModelService structured output schemas', () => {
  const service = new CopyGenerationModelService();

  beforeEach(() => {
    getParseMock().mockReset();
  });

  it('converts transcript insights and reaches the OpenAI call', async () => {
    const parse = getParseMock().mockImplementation(async (params) => ({
      choices: [
        {
          message: {
            parsed: params.response_format.$parseRaw(
              JSON.stringify({
                transcriptSummary: 'A concise transcript summary.',
                facts: ['A concrete fact'],
                unknowns: [],
                coreMessage: 'A grounded core message.',
                sourceConfidence: 0.8,
                voiceProfile: null,
              })
            ),
          },
        },
      ],
    }));

    const result = await service.summarizeTranscript('A sample transcript.');

    expect(parse).toHaveBeenCalledTimes(1);
    expect(result.voiceProfile).toBeNull();
  });

  it('keeps platform draft defaults compatible with structured outputs', async () => {
    const parse = getParseMock().mockImplementation(async (params) => ({
      choices: [
        {
          message: {
            parsed: params.response_format.$parseRaw(
              JSON.stringify({
                draft: 'A grounded platform draft.',
              })
            ),
          },
        },
      ],
    }));

    const result = await service.generatePlatformDraft(
      {
        source: {
          mediaType: 'image',
          visualSummary: 'A product shelf.',
          facts: ['The labels are handwritten.'],
          unknowns: [],
        },
        strategy: {
          goal: 'position',
          coreMessage: 'Small details matter.',
        },
        personalization: {
          knowledgeBaseFacts: [],
        },
        platform: {
          name: 'linkedin',
          hardCap: 3000,
          targetLength: 'medium',
          targetCharacters: 900,
          lineBreaks: 'moderate',
          hashtags: 'sparse',
          ctaStyle: 'invite',
          tone: 'professional',
          nativeFeel: 'insightful',
        },
      },
      'Write grounded copy.',
      'Return one draft.'
    );

    expect(parse).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      draft: 'A grounded platform draft.',
      angle: '',
      hook: '',
      cta: '',
    });
  });
});
