import {
  buildFrameTimestamps,
  CopyGenerationModelService,
  findNearestTimestamp,
} from '@gitroom/nestjs-libraries/copy-generation/copy-generation.model.service';

jest.mock('child_process', () => ({
  execFile: jest.fn(),
}));

jest.mock('fs/promises', () => ({
  mkdtemp: jest.fn(),
  readFile: jest.fn(),
  rm: jest.fn(),
}));

jest.mock('openai', () => {
  const parse = jest.fn();
  const createTranscription = jest.fn();
  const toFile = jest.fn();

  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      chat: { completions: { parse } },
      audio: { transcriptions: { create: createTranscription } },
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
  };
const getExecFileMock = () =>
  (jest.requireMock('child_process') as { execFile: jest.Mock }).execFile;

describe('CopyGenerationModelService video processing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('extracts compressed audio from an existing media file before transcription', async () => {
    const service = new CopyGenerationModelService();
    const audioBuffer = Buffer.from('compressed audio');
    getFileSystemMocks().mkdtemp.mockResolvedValue('/tmp/postiz-transcription-test');
    getFileSystemMocks().readFile.mockResolvedValue(audioBuffer);
    getExecFileMock().mockImplementation(
      (_command, _args, _options, callback) => callback(null, '', '')
    );
    getOpenAiMocks().toFile.mockResolvedValue('audio-file');
    getOpenAiMocks().createTranscription.mockResolvedValue({
      text: 'Generated transcript.',
    });

    const result = await service.transcribeVideo({
      inputPath: '/tmp/source/video.mp4',
      mimeType: 'video/mp4',
      originalName: 'uploaded-video.mp4',
    });

    expect(getExecFileMock()).toHaveBeenCalledWith(
      'ffmpeg',
      expect.arrayContaining([
        '-i',
        '/tmp/source/video.mp4',
        '-vn',
        '-ac',
        '1',
        '-ar',
        '16000',
      ]),
      expect.objectContaining({
        maxBuffer: 1024 * 1024,
        timeout: 60_000,
      }),
      expect.any(Function)
    );
    expect(getOpenAiMocks().toFile).toHaveBeenCalledWith(
      audioBuffer,
      'uploaded-video.mp3',
      { type: 'audio/mpeg' }
    );
    expect(getOpenAiMocks().createTranscription).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gpt-4o-mini-transcribe' }),
      { timeout: 120_000 }
    );
    expect(getFileSystemMocks().rm).toHaveBeenCalledWith(
      '/tmp/postiz-transcription-test',
      { recursive: true, force: true }
    );
    expect(result.text).toBe('Generated transcript.');
  });

  it('cleans up audio temporary files after ffmpeg fails', async () => {
    const service = new CopyGenerationModelService();
    getFileSystemMocks().mkdtemp.mockResolvedValue('/tmp/postiz-transcription-test');
    getExecFileMock().mockImplementation(
      (_command, _args, _options, callback) =>
        callback(new Error('ffmpeg failed'))
    );

    await expect(
      service.transcribeVideo({
        inputPath: '/tmp/source/video.mp4',
        mimeType: 'video/mp4',
      })
    ).rejects.toThrow('ffmpeg failed');
    expect(getFileSystemMocks().rm).toHaveBeenCalledWith(
      '/tmp/postiz-transcription-test',
      { recursive: true, force: true }
    );
  });

  it('samples timestamps, keeps successful frames, and normalizes model scenes', async () => {
    const mediaCommand = jest.fn(
      async (command: string, args: string[], options: Record<string, number>) => {
        if (command === 'ffprobe') {
          return { stdout: '10', stderr: '' };
        }
        if (args.some((arg) => arg.endsWith('frame-2.jpg'))) {
          throw new Error('one frame failed');
        }
        expect(options.timeout).toBe(30_000);
        return { stdout: '', stderr: '' };
      }
    );

    class TestService extends CopyGenerationModelService {
      protected runMediaCommand = mediaCommand as any;
      protected async requestVideoInsights() {
        return {
          visualSummary: 'A presenter demonstrates a workflow.',
          facts: ['A presenter is visible.'],
          unknowns: [],
          coreMessage: 'A workflow is demonstrated.',
          sourceConfidence: 0.8,
          scenes: [
            {
              timestampSeconds: 1.5,
              description: '  Opening frame.  ',
              visibleText: '  Start  ',
              usefulForPosting: true,
            },
            {
              timestampSeconds: 9,
              description: 'Closing frame.',
              visibleText: '',
              usefulForPosting: true,
            },
            {
              timestampSeconds: 9,
              description: 'Closing frame.',
              visibleText: '',
              usefulForPosting: true,
            },
          ],
        };
      }
    }

    getFileSystemMocks().mkdtemp.mockResolvedValue('/tmp/postiz-video-frames-test');
    getFileSystemMocks().readFile.mockResolvedValue(Buffer.from('jpeg'));

    const result = await new TestService().analyzeVideoFrames({
      inputPath: '/tmp/source/video.mp4',
      mimeType: 'video/mp4',
    });

    expect(mediaCommand).toHaveBeenCalledWith(
      'ffprobe',
      expect.arrayContaining(['/tmp/source/video.mp4']),
      expect.objectContaining({ timeout: 15_000 })
    );
    expect(result.scenes).toEqual([
      expect.objectContaining({
        timestampSeconds: 1.2,
        description: 'Opening frame.',
        visibleText: 'Start',
      }),
      expect.objectContaining({
        timestampSeconds: 8.8,
        description: 'Closing frame.',
      }),
    ]);
    expect(getFileSystemMocks().rm).toHaveBeenCalledWith(
      '/tmp/postiz-video-frames-test',
      { recursive: true, force: true }
    );
  });

  it('returns explicitly unusable visual output without inventing grounding', async () => {
    class EmptyAnalysisService extends CopyGenerationModelService {
      protected runMediaCommand = jest.fn(async (command: string) =>
        command === 'ffprobe'
          ? { stdout: '2', stderr: '' }
          : { stdout: '', stderr: '' }
      ) as any;
      protected async requestVideoInsights() {
        return null;
      }
    }

    getFileSystemMocks().mkdtemp.mockResolvedValue('/tmp/postiz-video-frames-test');
    getFileSystemMocks().readFile.mockResolvedValue(Buffer.from('jpeg'));

    const result = await new EmptyAnalysisService().analyzeVideoFrames({
      inputPath: '/tmp/source/video.mp4',
      mimeType: 'video/mp4',
    });

    expect(result.facts).toEqual([]);
    expect(result.scenes).toEqual([]);
    expect(result.sourceConfidence).toBe(0.35);
  });

  it('builds representative timestamps and chooses only sampled timestamps', () => {
    expect(buildFrameTimestamps(2)).toEqual([1]);
    expect(buildFrameTimestamps(10)).toEqual([1.2, 5, 8.8]);
    expect(findNearestTimestamp(6.1, [1.2, 5, 8.8])).toBe(5);
    expect(() => findNearestTimestamp(1, [])).toThrow(
      'At least one sampled timestamp is required.'
    );
  });
});

describe('CopyGenerationModelService structured output schemas', () => {
  const service = new CopyGenerationModelService();

  beforeEach(() => {
    jest.clearAllMocks();
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
              JSON.stringify({ draft: 'A grounded platform draft.' })
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
        strategy: { goal: 'position', coreMessage: 'Small details matter.' },
        personalization: { knowledgeBaseFacts: [] },
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
