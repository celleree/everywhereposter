import { Injectable } from '@nestjs/common';
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

const TranscriptInsightsSchema = z.object({
  transcriptSummary: z.string(),
  facts: z.array(z.string()).default([]),
  unknowns: z.array(z.string()).default([]),
  coreMessage: z.string(),
  sourceConfidence: z.number().min(0).max(1).default(0.7),
  voiceProfile: VoiceProfileSchema.optional(),
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

  async transcribeVideo(params: {
    buffer: Buffer;
    mimeType: string;
    originalName?: string | null;
  }) {
    const file = await toFile(
      params.buffer,
      params.originalName || 'uploaded-video.mp4',
      {
        type: params.mimeType,
      }
    );

    return openai.audio.transcriptions.create({
      file,
      model: 'gpt-4o-mini-transcribe',
    });
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
