import { Injectable } from '@nestjs/common';
import { execFile } from 'child_process';
import { mkdtemp, rm, stat } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { promisify } from 'util';
import {
  assertValidVideoEditDecisionList,
  buildVideoEditDecisionList,
  getKeptDurationMs,
  parseSilenceDetectionOutput,
  VideoEditDecisionError,
  VideoEditDecisionListV1,
} from '@gitroom/nestjs-libraries/media-editing/video-edit-decision';
import {
  isValidTalkingHeadStyleMetadata,
  TALKING_HEAD_STYLE_PRESET_SETTINGS,
  TalkingHeadStyleMetadata,
} from '@gitroom/nestjs-libraries/media-editing/talking-head-style';

const execFileAsync = promisify(execFile);

export const TALKING_HEAD_EDIT_DEFAULTS = {
  ...TALKING_HEAD_STYLE_PRESET_SETTINGS.balanced,
  maxDurationMs: 60 * 1000,
  maxVideoPixels: 1920 * 1080,
  maxVideoDimension: 2160,
  maxVideoFrameRate: 60,
  maxKeepRanges: 200,
} as const;

const FFPROBE_TIMEOUT_MS = 30_000;
const SILENCE_ANALYSIS_TIMEOUT_MS = 5 * 60 * 1000;
const VIDEO_RENDER_TIMEOUT_MS = 15 * 60 * 1000;
const MEDIA_COMMAND_MAX_BUFFER_BYTES = 8 * 1024 * 1024;

interface MediaProbeResult {
  durationMs: number;
  hasVideo: boolean;
  hasAudio: boolean;
  videoWidth: number;
  videoHeight: number;
  videoFrameRate: number;
}

export interface AnalyzeTalkingHeadVideoInput {
  inputPath: string;
  mediaId: string;
  style: TalkingHeadStyleMetadata;
  transcription: {
    id: string;
    generation: number;
    text: string;
  };
}

export interface RenderedVideoFile {
  outputPath: string;
  durationMs: number;
  cleanup: () => Promise<void>;
}

export class VideoEditingError extends Error {
  constructor(
    public readonly code:
      | 'UNSUPPORTED_SOURCE'
      | 'SOURCE_TOO_LONG'
      | 'ANALYSIS_FAILED'
      | 'RENDER_FAILED'
      | 'INVALID_OUTPUT',
    message: string
  ) {
    super(message);
    this.name = 'VideoEditingError';
  }
}

const formatSeconds = (milliseconds: number) =>
  (milliseconds / 1000).toFixed(3);

const parseFrameRate = (value: unknown) => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value !== 'string' || !value.trim()) {
    return 0;
  }

  const [numeratorText, denominatorText, ...remainder] = value.split('/');
  if (remainder.length) {
    return 0;
  }
  const numerator = Number(numeratorText);
  const denominator =
    denominatorText === undefined ? 1 : Number(denominatorText);
  if (
    !Number.isFinite(numerator) ||
    !Number.isFinite(denominator) ||
    numerator <= 0 ||
    denominator <= 0
  ) {
    return 0;
  }

  return numerator / denominator;
};

export const buildFfmpegRenderArgs = (
  inputPath: string,
  outputPath: string,
  decisionList: VideoEditDecisionListV1
) => {
  assertValidVideoEditDecisionList(decisionList);
  const keep = decisionList.decisions.filter(
    (decision) => decision.action === 'keep'
  );
  const filters: string[] = [];

  for (const [index, decision] of keep.entries()) {
    const start = formatSeconds(decision.sourceStartMs);
    const end = formatSeconds(decision.sourceEndMs);
    filters.push(
      '[0:v:0]trim=start=' +
        start +
        ':end=' +
        end +
        ',setpts=PTS-STARTPTS[v' +
        index +
        ']'
    );
    filters.push(
      '[0:a:0]atrim=start=' +
        start +
        ':end=' +
        end +
        ',asetpts=PTS-STARTPTS[a' +
        index +
        ']'
    );
  }

  if (keep.length === 1) {
    filters.push('[v0]scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p[outv]');
    filters.push('[a0]anull[outa]');
  } else {
    const concatInputs = keep
      .map((_decision, index) => '[v' + index + '][a' + index + ']')
      .join('');
    filters.push(
      concatInputs + 'concat=n=' + keep.length + ':v=1:a=1[joinedv][outa]'
    );
    filters.push(
      '[joinedv]scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p[outv]'
    );
  }

  return [
    '-hide_banner',
    '-loglevel',
    'error',
    '-i',
    inputPath,
    '-filter_complex',
    filters.join(';'),
    '-map',
    '[outv]',
    '-map',
    '[outa]',
    '-map_metadata',
    '-1',
    '-map_chapters',
    '-1',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '20',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '160k',
    '-movflags',
    '+faststart',
    '-max_muxing_queue_size',
    '1024',
    '-y',
    outputPath,
  ];
};

@Injectable()
export class FfmpegVideoEditorService {
  async analyzeTalkingHeadVideo(
    input: AnalyzeTalkingHeadVideoInput
  ): Promise<VideoEditDecisionListV1> {
    try {
      if (!isValidTalkingHeadStyleMetadata(input.style)) {
        throw new VideoEditDecisionError(
          'INVALID_EDIT_DECISIONS',
          'The talking-head style plan is invalid.'
        );
      }

      const styleSettings =
        TALKING_HEAD_STYLE_PRESET_SETTINGS[input.style.pacingPreset];
      const probe = await this.probeMedia(input.inputPath);
      this.assertSupportedSource(probe);

      const { stderr } = await this.runMediaCommand(
        'ffmpeg',
        [
          '-hide_banner',
          '-nostats',
          '-i',
          input.inputPath,
          '-map',
          '0:a:0',
          '-vn',
          '-af',
          'silencedetect=noise=' +
            styleSettings.silenceThresholdDb +
            'dB:d=' +
            (styleSettings.minimumSilenceMs / 1000).toFixed(3),
          '-f',
          'null',
          '-',
        ],
        {
          maxBuffer: MEDIA_COMMAND_MAX_BUFFER_BYTES,
          timeout: SILENCE_ANALYSIS_TIMEOUT_MS,
        }
      );

      return buildVideoEditDecisionList({
        mediaId: input.mediaId,
        durationMs: probe.durationMs,
        style: input.style,
        transcription: input.transcription,
        detectedSilence: parseSilenceDetectionOutput(
          String(stderr || ''),
          probe.durationMs
        ),
        ...styleSettings,
        maxKeepRanges: TALKING_HEAD_EDIT_DEFAULTS.maxKeepRanges,
      });
    } catch (error) {
      if (
        error instanceof VideoEditingError ||
        error instanceof VideoEditDecisionError
      ) {
        throw error;
      }
      throw new VideoEditingError(
        'ANALYSIS_FAILED',
        'The video audio could not be analyzed for dead air.'
      );
    }
  }

  async render(
    inputPath: string,
    decisionList: VideoEditDecisionListV1
  ): Promise<RenderedVideoFile> {
    assertValidVideoEditDecisionList(decisionList);
    const workingDirectory = await mkdtemp(
      join(tmpdir(), 'postiz-talking-head-edit-')
    );
    const outputPath = join(workingDirectory, 'edited.mp4');

    try {
      await this.runMediaCommand(
        'ffmpeg',
        buildFfmpegRenderArgs(inputPath, outputPath, decisionList),
        {
          maxBuffer: MEDIA_COMMAND_MAX_BUFFER_BYTES,
          timeout: VIDEO_RENDER_TIMEOUT_MS,
        }
      );

      const file = await stat(outputPath);
      if (!file.isFile() || file.size <= 0) {
        throw new VideoEditingError(
          'INVALID_OUTPUT',
          'The edited video output was empty.'
        );
      }

      const outputProbe = await this.probeMedia(outputPath);
      if (!outputProbe.hasVideo || !outputProbe.hasAudio) {
        throw new VideoEditingError(
          'INVALID_OUTPUT',
          'The edited video output is missing audio or video.'
        );
      }

      const expectedDurationMs = getKeptDurationMs(decisionList);
      const durationToleranceMs = Math.max(
        750,
        Math.round(expectedDurationMs * 0.08)
      );
      if (
        Math.abs(outputProbe.durationMs - expectedDurationMs) >
        durationToleranceMs
      ) {
        throw new VideoEditingError(
          'INVALID_OUTPUT',
          'The edited video duration does not match its edit decisions.'
        );
      }

      let cleaned = false;
      return {
        outputPath,
        durationMs: outputProbe.durationMs,
        cleanup: async () => {
          if (!cleaned) {
            cleaned = true;
            await rm(workingDirectory, { recursive: true, force: true });
          }
        },
      };
    } catch (error) {
      await rm(workingDirectory, { recursive: true, force: true });
      if (error instanceof VideoEditingError) {
        throw error;
      }
      throw new VideoEditingError(
        'RENDER_FAILED',
        'The edited MP4 could not be rendered.'
      );
    }
  }

  protected runMediaCommand(
    command: string,
    args: string[],
    options: { maxBuffer: number; timeout: number }
  ) {
    return execFileAsync(command, args, options);
  }

  private async probeMedia(inputPath: string): Promise<MediaProbeResult> {
    try {
      const { stdout } = await this.runMediaCommand(
        'ffprobe',
        [
          '-v',
          'error',
          '-show_entries',
          'format=duration:stream=codec_type,width,height,avg_frame_rate',
          '-of',
          'json',
          inputPath,
        ],
        {
          maxBuffer: MEDIA_COMMAND_MAX_BUFFER_BYTES,
          timeout: FFPROBE_TIMEOUT_MS,
        }
      );
      const parsed = JSON.parse(String(stdout || '{}')) as {
        format?: { duration?: string | number };
        streams?: Array<{
          codec_type?: string;
          width?: number;
          height?: number;
          avg_frame_rate?: string | number;
        }>;
      };
      const durationSeconds = Number(parsed.format?.duration);
      if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
        throw new Error('Missing duration');
      }

      const videoStream = parsed.streams?.find(
        (stream) => stream.codec_type === 'video'
      );

      return {
        durationMs: Math.round(durationSeconds * 1000),
        hasVideo: !!videoStream,
        hasAudio:
          parsed.streams?.some((stream) => stream.codec_type === 'audio') ||
          false,
        videoWidth: Number(videoStream?.width) || 0,
        videoHeight: Number(videoStream?.height) || 0,
        videoFrameRate: parseFrameRate(videoStream?.avg_frame_rate),
      };
    } catch (error) {
      if (error instanceof VideoEditingError) {
        throw error;
      }
      throw new VideoEditingError(
        'UNSUPPORTED_SOURCE',
        'The source video duration or streams could not be read.'
      );
    }
  }

  private assertSupportedSource(probe: MediaProbeResult) {
    if (!probe.hasVideo || !probe.hasAudio) {
      throw new VideoEditingError(
        'UNSUPPORTED_SOURCE',
        'Talking-head editing requires a video with an audio track.'
      );
    }
    if (probe.durationMs > TALKING_HEAD_EDIT_DEFAULTS.maxDurationMs) {
      throw new VideoEditingError(
        'SOURCE_TOO_LONG',
        'Phase 1 talking-head editing is limited to videos of 60 seconds or less.'
      );
    }
    if (
      !Number.isInteger(probe.videoWidth) ||
      !Number.isInteger(probe.videoHeight) ||
      probe.videoWidth <= 0 ||
      probe.videoHeight <= 0 ||
      probe.videoWidth > TALKING_HEAD_EDIT_DEFAULTS.maxVideoDimension ||
      probe.videoHeight > TALKING_HEAD_EDIT_DEFAULTS.maxVideoDimension ||
      probe.videoWidth * probe.videoHeight >
        TALKING_HEAD_EDIT_DEFAULTS.maxVideoPixels
    ) {
      throw new VideoEditingError(
        'UNSUPPORTED_SOURCE',
        'Phase 1 talking-head editing supports video up to 1080p.'
      );
    }
    if (
      !Number.isFinite(probe.videoFrameRate) ||
      probe.videoFrameRate <= 0 ||
      probe.videoFrameRate > TALKING_HEAD_EDIT_DEFAULTS.maxVideoFrameRate
    ) {
      throw new VideoEditingError(
        'UNSUPPORTED_SOURCE',
        'Phase 1 talking-head editing supports video up to 60 frames per second.'
      );
    }
  }
}
