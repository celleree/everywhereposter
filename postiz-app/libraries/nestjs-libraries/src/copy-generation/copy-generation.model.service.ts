import { Injectable } from '@nestjs/common';
import { execFile } from 'child_process';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { basename, join } from 'path';
import { tmpdir } from 'os';
import { promisify } from 'util';
import OpenAI, { toFile } from 'openai';
import { zodResponseFormat } from 'openai/helpers/zod';
import { z } from 'zod';
import {
  HASHTAG_BEHAVIORS,
  LINE_BREAK_BEHAVIORS,
  PLATFORM_CTA_STYLES,
} from '@gitroom/nestjs-libraries/copy-generation/platform-rules';
import { CopyGenerationBrief } from '@gitroom/nestjs-libraries/dtos/copy-generation/generate.media.copy.response';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || 'sk-proj-',
});
const execFileAsync = promisify(execFile);

const VoiceProfileSchema = z.object({
  sentenceLength: z.enum(['short', 'mixed', 'long']).default('mixed'),
  lineBreakHabit: z.enum(LINE_BREAK_BEHAVIORS).default('moderate'),
  ctaStyle: z.enum(PLATFORM_CTA_STYLES).default('invite'),
  vocabularyTendencies: z.array(z.string()).default([]),
  tabooPhrases: z.array(z.string()).default([]),
  preferredOpenings: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1).default(0.35),
});

const ImageInsightsSchema = z.object({
  visualSummary: z.string(),
  facts: z.array(z.string()).default([]),
  unknowns: z.array(z.string()).default([]),
  coreMessage: z.string(),
  sourceConfidence: z.number().min(0).max(1).default(0.65),
});

const VideoSceneSchema = z.object({
  timestampSeconds: z.number().min(0),
  description: z.string(),
  visibleText: z.string().default(''),
  usefulForPosting: z.boolean().default(true),
});

const VideoInsightsSchema = z.object({
  visualSummary: z.string(),
  facts: z.array(z.string()).default([]),
  unknowns: z.array(z.string()).default([]),
  coreMessage: z.string(),
  sourceConfidence: z.number().min(0).max(1).default(0.65),
  scenes: z.array(VideoSceneSchema).default([]),
});

const TranscriptInsightsSchema = z.object({
  transcriptSummary: z.string(),
  facts: z.array(z.string()).default([]),
  unknowns: z.array(z.string()).default([]),
  coreMessage: z.string(),
  sourceConfidence: z.number().min(0).max(1).default(0.7),
  voiceProfile: VoiceProfileSchema.nullable(),
});

const PlatformDraftSchema = z.object({
  draft: z.string(),
  angle: z.string().optional().default(''),
  hook: z.string().optional().default(''),
  cta: z.string().optional().default(''),
});

const RewriteDraftSchema = z.object({
  draft: z.string(),
});

interface ExtractedVideoFrame {
  timestampSeconds: number;
  buffer: Buffer;
}

@Injectable()
export class CopyGenerationModelService {
  async analyzeImage(params: {
    buffer: Buffer;
    mimeType: string;
    transcriptText?: string;
    altText?: string | null;
    originalName?: string | null;
  }) {
    const imageUrl = `data:${params.mimeType};base64,${params.buffer.toString(
      'base64'
    )}`;

    const analysis = await openai.chat.completions.parse({
      model: 'gpt-4.1',
      messages: [
        {
          role: 'system',
          content: `You analyze a user-provided image so another model can write grounded social copy from it.

Rules:
- Describe only what is reasonably supported by the image.
- Extract 3-6 concrete facts.
- If something is unclear, put it in unknowns instead of guessing.
- Write a short visual summary and one core message someone could post about.
- Do not use generic marketing language.`,
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Existing alt text: ${params.altText || 'none'}
Original name: ${params.originalName || 'unknown'}
Associated transcript: ${params.transcriptText?.slice(0, 4000) || 'none'}`,
            },
            {
              type: 'image_url',
              image_url: {
                url: imageUrl,
              },
            },
          ],
        },
      ],
      response_format: zodResponseFormat(ImageInsightsSchema, 'imageInsights'),
    });

    return (
      analysis.choices[0].message.parsed || {
        visualSummary: params.altText || 'Uploaded image',
        facts: [],
        unknowns: [],
        coreMessage: params.altText || 'Share the clearest useful point from the image.',
        sourceConfidence: 0.5,
      }
    );
  }

  async analyzeVideoFrames(params: {
    buffer: Buffer;
    mimeType: string;
    transcriptText?: string;
    altText?: string | null;
    originalName?: string | null;
  }) {
    const frames = await this.extractVideoFrames(params.buffer, params.originalName);

    if (!frames.length) {
      throw new Error('Video frame extraction returned no usable frames.');
    }

    const frameContent = frames.flatMap((frame, index) => [
      {
        type: 'text' as const,
        text: `Frame ${index + 1} sampled at ${frame.timestampSeconds.toFixed(2)} seconds.`,
      },
      {
        type: 'image_url' as const,
        image_url: {
          url: `data:image/jpeg;base64,${frame.buffer.toString('base64')}`,
          detail: 'low' as const,
        },
      },
    ]);

    const analysis = await openai.chat.completions.parse({
      model: 'gpt-4.1',
      messages: [
        {
          role: 'system',
          content: `You analyze representative frames sampled across a user-provided video so other models can create grounded social posts and image concepts.

Rules:
- Use only details supported by the supplied frames and associated transcript.
- Treat timestamps as labels for the supplied images. Never invent a timestamp.
- Describe recurring subjects, actions, objects, settings, demonstrations, and visible on-screen text.
- Do not identify a person, brand, location, product, or result unless the frames, visible text, or transcript clearly support it.
- Extract 3-8 concrete visual facts. Put uncertain details in unknowns instead of guessing.
- Return a concise visual summary that explains what the video visibly shows across the sampled frames.
- Create scene entries only for supplied frames that could help with a social post, cover, thumbnail, quote card, or supporting image.
- Record visibleText only when it is confidently readable. Otherwise return an empty string.
- The core message may combine the transcript and visuals, but it must not add claims that neither source supports.
- Avoid generic marketing language.`,
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Video MIME type: ${params.mimeType}
Existing alt text: ${params.altText || 'none'}
Original name: ${params.originalName || 'unknown'}
Associated transcript: ${params.transcriptText?.slice(0, 12000) || 'none'}

Analyze the sampled frames below as one video.`,
            },
            ...frameContent,
          ],
        },
      ],
      response_format: zodResponseFormat(VideoInsightsSchema, 'videoInsights'),
    });

    const parsed = analysis.choices[0].message.parsed;

    if (!parsed) {
      return VideoInsightsSchema.parse({
        visualSummary: params.altText || 'Uploaded video',
        facts: [],
        unknowns: ['The sampled video frames could not be summarized reliably.'],
        coreMessage:
          params.transcriptText?.slice(0, 180) ||
          params.altText ||
          'Share the clearest useful point from the uploaded video.',
        sourceConfidence: 0.35,
        scenes: [],
      });
    }

    return {
      ...parsed,
      scenes: parsed.scenes
        .map((scene) => ({
          ...scene,
          timestampSeconds: this.findNearestTimestamp(
            scene.timestampSeconds,
            frames.map((frame) => frame.timestampSeconds)
          ),
        }))
        .slice(0, frames.length),
    };
  }

  async transcribeVideo(params: {
    buffer: Buffer;
    mimeType: string;
    originalName?: string | null;
  }) {
    const audioBuffer = await this.extractAudio(params.buffer, params.originalName);
    const file = await toFile(
      audioBuffer,
      `${basename(params.originalName || 'uploaded-video', '.mp4')}.mp3`,
      {
        type: 'audio/mpeg',
      }
    );

    return openai.audio.transcriptions.create({
      file,
      model: 'gpt-4o-mini-transcribe',
    });
  }

  private async extractAudio(buffer: Buffer, originalName?: string | null) {
    const workingDirectory = await mkdtemp(
      join(tmpdir(), 'postiz-transcription-')
    );
    const inputPath = join(
      workingDirectory,
      basename(originalName || 'uploaded-video.mp4')
    );
    const outputPath = join(workingDirectory, 'audio.mp3');

    try {
      await writeFile(inputPath, buffer);
      await execFileAsync(
        'ffmpeg',
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-i',
          inputPath,
          '-map',
          '0:a:0',
          '-vn',
          '-ac',
          '1',
          '-ar',
          '16000',
          '-b:a',
          '32k',
          outputPath,
        ],
        {
          maxBuffer: 1024 * 1024,
        }
      );

      const audioBuffer = await readFile(outputPath);
      if (!audioBuffer.byteLength) {
        throw new Error('Video audio extraction returned an empty file.');
      }

      return audioBuffer;
    } finally {
      await rm(workingDirectory, { recursive: true, force: true });
    }
  }

  private async extractVideoFrames(
    buffer: Buffer,
    originalName?: string | null
  ): Promise<ExtractedVideoFrame[]> {
    const workingDirectory = await mkdtemp(join(tmpdir(), 'postiz-video-frames-'));
    const inputPath = join(
      workingDirectory,
      basename(originalName || 'uploaded-video.mp4')
    );

    try {
      await writeFile(inputPath, buffer);

      let timestamps = [0];
      try {
        const duration = await this.probeVideoDuration(inputPath);
        timestamps = this.buildFrameTimestamps(duration);
      } catch {
        timestamps = [0];
      }

      const frames: ExtractedVideoFrame[] = [];

      for (const [index, timestampSeconds] of timestamps.entries()) {
        const outputPath = join(workingDirectory, `frame-${index + 1}.jpg`);

        try {
          await execFileAsync(
            'ffmpeg',
            [
              '-hide_banner',
              '-loglevel',
              'error',
              '-ss',
              timestampSeconds.toFixed(3),
              '-i',
              inputPath,
              '-frames:v',
              '1',
              '-an',
              '-vf',
              'scale=1280:-2:force_original_aspect_ratio=decrease',
              '-q:v',
              '4',
              '-y',
              outputPath,
            ],
            {
              maxBuffer: 2 * 1024 * 1024,
            }
          );

          const frameBuffer = await readFile(outputPath);
          if (frameBuffer.byteLength) {
            frames.push({
              timestampSeconds,
              buffer: frameBuffer,
            });
          }
        } catch {
          // Keep any other representative frames when one timestamp is unreadable.
        }
      }

      return frames;
    } finally {
      await rm(workingDirectory, { recursive: true, force: true });
    }
  }

  private async probeVideoDuration(inputPath: string) {
    const { stdout } = await execFileAsync(
      'ffprobe',
      [
        '-v',
        'error',
        '-show_entries',
        'format=duration',
        '-of',
        'default=noprint_wrappers=1:nokey=1',
        inputPath,
      ],
      {
        maxBuffer: 1024 * 1024,
      }
    );
    const duration = Number.parseFloat(`${stdout}`.trim());

    if (!Number.isFinite(duration) || duration <= 0) {
      throw new Error('Video duration could not be determined.');
    }

    return duration;
  }

  private buildFrameTimestamps(durationSeconds: number) {
    const fractions =
      durationSeconds <= 3
        ? [0.5]
        : durationSeconds <= 10
        ? [0.12, 0.5, 0.88]
        : durationSeconds <= 20
        ? [0.08, 0.35, 0.65, 0.9]
        : [0.06, 0.22, 0.38, 0.54, 0.7, 0.88];

    return Array.from(
      new Set(
        fractions.map((fraction) =>
          Number(Math.max(0, durationSeconds * fraction).toFixed(3))
        )
      )
    );
  }

  private findNearestTimestamp(timestamp: number, timestamps: number[]) {
    return timestamps.reduce((nearest, candidate) =>
      Math.abs(candidate - timestamp) < Math.abs(nearest - timestamp)
        ? candidate
        : nearest
    );
  }

  async summarizeTranscript(transcript: string) {
    const summary = await openai.chat.completions.parse({
      model: 'gpt-4.1',
      messages: [
        {
          role: 'system',
          content: `You summarize a transcript for grounded social copy generation.

Rules:
- Extract only concrete facts stated or strongly implied by the transcript.
- Return unknowns instead of inventing context.
- Derive a light voice profile from rhythm and wording patterns, not exact mimicry.
- Never include long verbatim lines from the transcript.
- Avoid generic creator jargon.`,
        },
        {
          role: 'user',
          content: transcript.slice(0, 24000),
        },
      ],
      response_format: zodResponseFormat(
        TranscriptInsightsSchema,
        'transcriptInsights'
      ),
    });

    return (
      summary.choices[0].message.parsed ||
      TranscriptInsightsSchema.parse({
        transcriptSummary: transcript.slice(0, 300),
        facts: [],
        unknowns: [],
        coreMessage: transcript.slice(0, 180),
      })
    );
  }

  async generatePlatformDraft(
    brief: CopyGenerationBrief,
    systemPrompt: string,
    promptConstraints: string
  ) {
    const response = await openai.chat.completions.parse({
      model: 'gpt-4.1',
      messages: [
        {
          role: 'system',
          content: `${systemPrompt}\n\n${promptConstraints}`,
        },
        {
          role: 'user',
          content: `Write one ${brief.platform.name} draft.

Shape requirements:
- Draft target: ${brief.platform.targetCharacters} characters.
- Hashtag behavior: ${brief.platform.hashtags}.
- Line break behavior: ${brief.platform.lineBreaks}.
- CTA style: ${brief.platform.ctaStyle}.

Return a JSON object with draft, angle, hook, and cta.`,
        },
      ],
      response_format: zodResponseFormat(PlatformDraftSchema, 'platformDraft'),
    });

    return (
      response.choices[0].message.parsed ||
      PlatformDraftSchema.parse({
        draft: '',
      })
    );
  }

  async rewriteDraft(params: {
    brief: CopyGenerationBrief;
    draft: string;
    reasons: string[];
    targetCharacters: number;
    hardCap: number;
  }) {
    const response = await openai.chat.completions.parse({
      model: 'gpt-4.1',
      messages: [
        {
          role: 'system',
          content: `Rewrite the provided social post to remove generic AI tone while preserving the same meaning.

Rules:
- Do not add new facts.
- Keep it under ${params.hardCap} characters.
- Aim for about ${params.targetCharacters} characters.
- Make it more concrete and human.
- Remove filler, hype, symmetry, and empty claims.
- Keep it native to ${params.brief.platform.name}.
- Avoid hashtags unless clearly allowed.`,
        },
        {
          role: 'user',
          content: `Flags:
${params.reasons.map((reason) => `- ${reason}`).join('\n')}

Original draft:
${params.draft}

Core message:
${params.brief.strategy.coreMessage}

Grounding facts:
${params.brief.source.facts.map((fact) => `- ${fact}`).join('\n')}`,
        },
      ],
      response_format: zodResponseFormat(RewriteDraftSchema, 'rewriteDraft'),
    });

    return (
      response.choices[0].message.parsed ||
      RewriteDraftSchema.parse({
        draft: params.draft,
      })
    );
  }
}
