import { OpenaiService } from '@gitroom/nestjs-libraries/openai/openai.service';

jest.mock('openai', () => {
  const generateImage = jest.fn();
  const parse = jest.fn();

  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      images: { generate: generateImage },
      chat: { completions: { parse } },
    })),
    generateImage,
    parse,
  };
});

const getOpenAiMocks = () =>
  jest.requireMock('openai') as {
    generateImage: jest.Mock;
    parse: jest.Mock;
  };

describe('OpenaiService cost-aware routing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('uses GPT Image 2.5 Flare at medium quality without legacy parameters', async () => {
    getOpenAiMocks().generateImage.mockResolvedValue({
      data: [{ b64_json: 'generated-image' }],
    });

    const image = await new OpenaiService().generateImage(
      'A grounded editorial visual',
      false,
      true
    );

    expect(getOpenAiMocks().generateImage).toHaveBeenCalledWith({
      prompt: 'A grounded editorial visual',
      model: 'gpt-image-2.5-flare',
      quality: 'medium',
      output_format: 'png',
      size: '1024x1792',
    });
    expect(image).toBe('generated-image');
  });

  it('returns a data URL when callers previously requested a hosted URL', async () => {
    getOpenAiMocks().generateImage.mockResolvedValue({
      data: [{ b64_json: 'generated-image' }],
    });

    await expect(
      new OpenaiService().generateImage('A product visual', true)
    ).resolves.toBe('data:image/png;base64,generated-image');
  });

  it('routes image-prompt writing through the balanced utility model', async () => {
    getOpenAiMocks().parse.mockResolvedValue({
      choices: [{ message: { parsed: { prompt: 'Detailed image prompt' } } }],
    });

    await new OpenaiService().generatePromptForPicture('A launch image');

    expect(getOpenAiMocks().parse).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gpt-5.6-terra',
        reasoning_effort: 'none',
      })
    );
  });
});
