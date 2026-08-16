import {
  buildFfmpegRenderArgs,
  FfmpegVideoEditorService,
} from '@gitroom/nestjs-libraries/media-editing/ffmpeg-video-editor.service';
import { buildVideoEditDecisionList } from '@gitroom/nestjs-libraries/media-editing/video-edit-decision';
import {
  createTalkingHeadStylePlan,
  toTalkingHeadStyleMetadata,
} from '@gitroom/nestjs-libraries/media-editing/talking-head-style';

const balancedStyle = toTalkingHeadStyleMetadata(
  createTalkingHeadStylePlan({
    stylePrompt: 'Keep this natural.',
    pacingPreset: 'balanced',
    plannerSource: 'deterministic-fallback',
  })
);

class StubFfmpegVideoEditorService extends FfmpegVideoEditorService {
  readonly calls: Array<{ command: string; args: string[] }> = [];
  readonly responses: Array<{ stdout: string; stderr: string }> = [];

  protected async runMediaCommand(command: string, args: string[]) {
    this.calls.push({ command, args });
    const response = this.responses.shift();
    if (!response) {
      throw new Error('Unexpected media command');
    }
    return response;
  }
}

const buildDecisionList = () =>
  buildVideoEditDecisionList({
    mediaId: 'media-1',
    durationMs: 4_000,
    style: balancedStyle,
    transcription: {
      id: 'transcription-1',
      generation: 1,
      text: 'Keep these two spoken sections.',
    },
    detectedSilence: [{ sourceStartMs: 1_000, sourceEndMs: 3_000 }],
    silenceThresholdDb: -35,
    minimumSilenceMs: 650,
    speechPaddingMs: 100,
    maxKeepRanges: 200,
  });

describe('FfmpegVideoEditorService', () => {
  it('turns probe and silencedetect output into decisions', async () => {
    const editor = new StubFfmpegVideoEditorService();
    editor.responses.push(
      {
        stdout: JSON.stringify({
          format: { duration: '4.000' },
          streams: [
            {
              codec_type: 'video',
              width: 1280,
              height: 720,
              avg_frame_rate: '60/1',
            },
            { codec_type: 'audio' },
          ],
        }),
        stderr: '',
      },
      {
        stdout: '',
        stderr: [
          '[silencedetect] silence_start: 1',
          '[silencedetect] silence_end: 3 | silence_duration: 2',
        ].join('\n'),
      }
    );

    await expect(
      editor.analyzeTalkingHeadVideo({
        inputPath: '/tmp/source.mp4',
        mediaId: 'media-1',
        style: balancedStyle,
        transcription: {
          id: 'transcription-1',
          generation: 1,
          text: 'Keep these two spoken sections.',
        },
      })
    ).resolves.toMatchObject({
      schemaVersion: 1,
      decisions: [
        { action: 'keep', sourceStartMs: 0, sourceEndMs: 1_120 },
        { action: 'cut', sourceStartMs: 1_120, sourceEndMs: 2_880 },
        { action: 'keep', sourceStartMs: 2_880, sourceEndMs: 4_000 },
      ],
    });
    expect(editor.calls.map((call) => call.command)).toEqual([
      'ffprobe',
      'ffmpeg',
    ]);
    expect(editor.calls[1].args).toContain('silencedetect=noise=-35dB:d=0.650');
  });

  it('builds one argument-array render with reset A/V timestamps', () => {
    const decisionList = buildDecisionList();
    const inputPath = '/tmp/source with spaces;not-a-command.mp4';
    const outputPath = '/tmp/edited.mp4';
    const args = buildFfmpegRenderArgs(inputPath, outputPath, decisionList);
    const filterGraph = args[args.indexOf('-filter_complex') + 1];

    expect(args[args.indexOf('-i') + 1]).toBe(inputPath);
    expect(args.at(-1)).toBe(outputPath);
    expect(filterGraph).toContain('trim=start=0.000:end=1.100');
    expect(filterGraph).toContain('setpts=PTS-STARTPTS');
    expect(filterGraph).toContain('asetpts=PTS-STARTPTS');
    expect(filterGraph).toContain('concat=n=2:v=1:a=1');
    expect(args).toEqual(
      expect.arrayContaining(['libx264', 'aac', '+faststart'])
    );
  });

  it('rejects sources beyond the bounded Phase 1 duration', async () => {
    const editor = new StubFfmpegVideoEditorService();
    editor.responses.push({
      stdout: JSON.stringify({
        format: { duration: '61' },
        streams: [
          {
            codec_type: 'video',
            width: 1280,
            height: 720,
            avg_frame_rate: '30/1',
          },
          { codec_type: 'audio' },
        ],
      }),
      stderr: '',
    });

    await expect(
      editor.analyzeTalkingHeadVideo({
        inputPath: '/tmp/source.mp4',
        mediaId: 'media-1',
        style: balancedStyle,
        transcription: {
          id: 'transcription-1',
          generation: 1,
          text: 'Transcript',
        },
      })
    ).rejects.toMatchObject({ code: 'SOURCE_TOO_LONG' });
    expect(editor.calls).toHaveLength(1);
  });

  it('rejects video above the bounded Phase 1 resolution', async () => {
    const editor = new StubFfmpegVideoEditorService();
    editor.responses.push({
      stdout: JSON.stringify({
        format: { duration: '30' },
        streams: [
          {
            codec_type: 'video',
            width: 3840,
            height: 2160,
            avg_frame_rate: '30/1',
          },
          { codec_type: 'audio' },
        ],
      }),
      stderr: '',
    });

    await expect(
      editor.analyzeTalkingHeadVideo({
        inputPath: '/tmp/source.mp4',
        mediaId: 'media-1',
        style: balancedStyle,
        transcription: {
          id: 'transcription-1',
          generation: 1,
          text: 'Transcript',
        },
      })
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_SOURCE' });
    expect(editor.calls).toHaveLength(1);
  });

  it('rejects video above the bounded Phase 1 frame rate', async () => {
    const editor = new StubFfmpegVideoEditorService();
    editor.responses.push({
      stdout: JSON.stringify({
        format: { duration: '30' },
        streams: [
          {
            codec_type: 'video',
            width: 1920,
            height: 1080,
            avg_frame_rate: '120000/1000',
          },
          { codec_type: 'audio' },
        ],
      }),
      stderr: '',
    });

    await expect(
      editor.analyzeTalkingHeadVideo({
        inputPath: '/tmp/source.mp4',
        mediaId: 'media-1',
        style: balancedStyle,
        transcription: {
          id: 'transcription-1',
          generation: 1,
          text: 'Transcript',
        },
      })
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_SOURCE' });
    expect(editor.calls).toHaveLength(1);
  });
});
