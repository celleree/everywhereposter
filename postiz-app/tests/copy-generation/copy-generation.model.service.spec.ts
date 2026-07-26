import { CopyGenerationModelService } from '@gitroom/nestjs-libraries/copy-generation/copy-generation.model.service';

jest.mock('child_process', () => ({
  execFile: jest.fn(),
}));

jest.mock('fs/promises', () => ({
  mkdtemp: jest.fn(),
  readFile: jest.fn(),
  rm: jest.fn(),
  writeFile: jest.fn(),
}));

jest.mock('openai', () => {
  const parse = jest.fn();
  const createTranscription = jest.fn();
  const toFile = jest.fn();

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
          create: createTranscription,
        },
      },
    })),
    parse,
    createTranscription,
    toFile,
  };
});

const getParseMock = () =>
  (jest.requireMock('openai') as { parse: jest.Mock }).parse;
const getOpenAiMocks = () =>
  jest.requireMock('openai') as {
    createTranscription: jest.Mock;
    toFile: jest.Mock;
  };
const getFileSystemMocks = () =>
  jest.requireMock('fs/promises') as {
    mkdtemp: jest.Mock;
    readFile: jest.Mock;
    rm: jest.Mock;
    writeFile: jest.Mock;
  };
const getExecFileMock = () =>
  (jest.requireMock('child_process') as { execFile: jest.Mock }).execFile;

describe('CopyGenerationModelService structured output schemas', () => {
  const service = new CopyGenerationModelService();

  beforeEach(() => {
    getParseMock().mockReset();
    getOpenAiMocks().createTranscription.mockReset();
    getOpenAiMocks().toFile.mockReset();
    getFileSystemMocks().mkdtemp.mockReset();
    getFileSystemMocks().readFile.mockReset();
    getFileSystemMocks().rm.mockReset();
    getFileSystemMocks().writeFile.mockReset();
    getExecFileMock().mockReset();
  });

  it('extracts compressed audio before transcribing a video', async () => {
    const inputBuffer = Buffer.from('large video');
    const audioBuffer = Buffer.from('compressed audio');
    getFileSystemMocks().mkdtemp.mockResolvedValue(
      '/tmp/everywhereposter-transcription-test'
    );
    getFileSystemMocks().readFile.mockResolvedValue(audioBuffer);
    getExecFileMock().mockImplementation(
      (_command, _args, _options, callback) => callback(null, '', '')
    );
    getOpenAiMocks().toFile.mockResolvedValue('audio-file');
    getOpenAiMocks().createTranscription.mockResolvedValue({
      text: 'Generated transcript.',
    });

    const result = await service.transcribeVideo({
      buffer: inputBuffer,
      mimeType: 'video/mp4',
      originalName: 'uploaded-video.mp4',
    });

    expect(getFileSystemMocks().writeFile).toHaveBeenCalledWith(
      '/tmp/everywhereposter-transcription-test/uploaded-video.mp4',
      inputBuffer
    );
    expect(getExecFileMock()).toHaveBeenCalledWith(
      'ffmpeg',
      expect.arrayContaining(['-vn', '-ac', '1', '-ar', '16000']),
      expect.objectContaining({ maxBuffer: 1024 * 1024 }),
      expect.any(Function)
    );
    expect(getOpenAiMocks().toFile).toHaveBeenCalledWith(
      audioBuffer,
      'uploaded-video.mp3',
      { type: 'audio/mpeg' }
    );
    expect(getFileSystemMocks().rm).toHaveBeenCalledWith(
      '/tmp/everywhereposter-transcription-test',
      { recursive: true, force: true }
    );
    expect(result.text).toBe('Generated transcript.');
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
