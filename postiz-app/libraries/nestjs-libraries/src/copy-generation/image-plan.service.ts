import { Injectable } from '@nestjs/common';
import OpenAI from 'openai';
import { zodResponseFormat } from 'openai/helpers/zod';
import { z } from 'zod';
import { uniqBy } from 'lodash';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import {
  COPY_PLATFORMS,
  CopyPlatform,
} from '@gitroom/nestjs-libraries/copy-generation/platform-rules';
import { SourceBriefResult } from '@gitroom/nestjs-libraries/copy-generation/source-brief.service';
import {
  ImagePlanAspectRatio,
  ImagePlanItem,
} from '@gitroom/nestjs-libraries/dtos/copy-generation/generate.media.copy.response';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || 'sk-proj-',
});

const IMAGE_PLAN_TYPES = [
  'video_frame',
  'quote_card',
  'ai_visual',
  'thumbnail',
] as const;

const IMAGE_PLAN_ASPECT_RATIOS = ['1:1', '4:5', '16:9', '9:16'] as const;

const ImagePlanDraftSchema = z.object({
  type: z.enum(IMAGE_PLAN_TYPES),
  platform: z.enum(COPY_PLATFORMS),
  purpose: z.string(),
  rationale: z.string(),
  aspectRatio: z.enum(IMAGE_PLAN_ASPECT_RATIOS),
  title: z.string().optional().default(''),
  headline: z.string().optional().default(''),
  subheadline: z.string().optional().default(''),
  captionHint: z.string().optional().default(''),
  sourceTimestampSeconds: z.number().min(0).optional(),
  sourceQuote: z.string().optional().default(''),
  visualSummary: z.string(),
  visualPrompt: z.string().optional().default(''),
  altText: z.string(),
  confidence: z.number().min(0).max(1).default(0.65),
  warnings: z.array(z.string()).default([]),
});

const ImagePlanResponseSchema = z.object({
  recommendedImages: z.array(ImagePlanDraftSchema).default([]),
});

type ImagePlanDraft = z.infer<typeof ImagePlanDraftSchema>;

const DEFAULT_ASPECT_RATIO: Record<CopyPlatform, ImagePlanAspectRatio> = {
  linkedin: '4:5',
  x: '16:9',
  threads: '4:5',
  facebook: '4:5',
  instagram: '4:5',
  tiktok: '9:16',
  youtube: '16:9',
  bluesky: '1:1',
};

@Injectable()
export class ImagePlanService {
  async generate(
    sourceBrief: SourceBriefResult,
    platforms: CopyPlatform[]
  ): Promise<ImagePlanItem[]> {
    if (sourceBrief.media.mediaType !== 'video' || platforms.length === 0) {
      return [];
    }

    const selectedPlatforms = Array.from(new Set(platforms));
    const scenes = (sourceBrief.source.scenes || []).filter(
      (scene) => scene.usefulForPosting
    );
    const availableTimestamps = scenes.map((scene) => scene.timestampSeconds);

    const response = await openai.chat.completions.parse({
      model: 'gpt-4.1',
      messages: [
        {
          role: 'system',
          content: `You create a structured image plan from a grounded uploaded-video brief.

You are planning assets only. Do not claim that any image has been rendered or generated.

Rules:
- Return at most one recommended image for each selected platform.
- Use only facts, scenes, visible text, transcript summary, and core message supplied by the user.
- Never invent a person, product, location, result, quote, or timestamp.
- Prefer an authentic video_frame when a useful scene clearly supports the post.
- Prefer a quote_card when the message is stronger as controlled typography. The application will render the text, so visualPrompt must not ask an image model to draw words.
- Use ai_visual only when a supporting concept image adds meaning and can be generated without inventing source facts.
- Use thumbnail mainly for YouTube or when a platform genuinely needs a cover-style asset.
- video_frame and thumbnail require one of the supplied scene timestamps.
- quote_card should include a concise headline. sourceQuote is optional and may only contain wording actually supplied in the brief.
- ai_visual requires a concrete visualPrompt and must avoid unsupported brand marks, people, proof, or results.
- Write useful alt text.
- Put accuracy or source limitations in warnings.
- Match the platform's native visual format instead of copying one recommendation everywhere.`,
        },
        {
          role: 'user',
          content: `Selected platforms:
${selectedPlatforms.join(', ')}

Core message:
${sourceBrief.coreMessage}

Visual summary:
${sourceBrief.source.visualSummary}

Transcript summary:
${sourceBrief.source.transcriptSummary || 'none'}

Grounded facts:
${sourceBrief.source.facts.map((fact) => `- ${fact}`).join('\n') || '- none'}

Unknowns:
${sourceBrief.source.unknowns.map((unknown) => `- ${unknown}`).join('\n') || '- none'}

Available posting scenes:
${
  scenes.length
    ? scenes
        .map(
          (scene) =>
            `- ${scene.timestampSeconds}s: ${scene.description}${
              scene.visibleText ? ` | visible text: ${scene.visibleText}` : ''
            }`
        )
        .join('\n')
    : '- none; do not recommend video_frame or thumbnail'
}

Create the smallest useful platform-specific image plan.`,
        },
      ],
      response_format: zodResponseFormat(
        ImagePlanResponseSchema,
        'videoImagePlan'
      ),
    });

    const drafts = response.choices[0].message.parsed?.recommendedImages || [];

    return uniqBy(
      drafts
        .filter((draft) => selectedPlatforms.includes(draft.platform))
        .map((draft) =>
          this.normalizeDraft(draft, availableTimestamps, sourceBrief)
        )
        .filter((item): item is ImagePlanItem => Boolean(item)),
      (item) => item.platform
    );
  }

  private normalizeDraft(
    draft: ImagePlanDraft,
    availableTimestamps: number[],
    sourceBrief: SourceBriefResult
  ): ImagePlanItem | null {
    const needsFrame = draft.type === 'video_frame' || draft.type === 'thumbnail';
    let sourceTimestampSeconds: number | undefined;

    if (needsFrame) {
      if (
        typeof draft.sourceTimestampSeconds !== 'number' ||
        availableTimestamps.length === 0
      ) {
        return null;
      }

      sourceTimestampSeconds = availableTimestamps.reduce((nearest, candidate) =>
        Math.abs(candidate - draft.sourceTimestampSeconds!) <
        Math.abs(nearest - draft.sourceTimestampSeconds!)
          ? candidate
          : nearest
      );
    }

    const headline = draft.headline.trim();
    const visualPrompt = draft.visualPrompt.trim();

    if (draft.type === 'quote_card' && !headline) {
      return null;
    }

    if (draft.type === 'ai_visual' && !visualPrompt) {
      return null;
    }

    const warnings = Array.from(
      new Set([
        ...draft.warnings.map((warning) => warning.trim()).filter(Boolean),
        ...(sourceBrief.sourceConfidence < 0.55
          ? ['Source confidence is limited; review this recommendation before generating an asset.']
          : []),
      ])
    );

    return {
      id: makeId(12),
      type: draft.type,
      platform: draft.platform,
      purpose: draft.purpose.trim(),
      rationale: draft.rationale.trim(),
      aspectRatio: draft.aspectRatio || DEFAULT_ASPECT_RATIO[draft.platform],
      ...(draft.title.trim() ? { title: draft.title.trim() } : {}),
      ...(headline ? { headline } : {}),
      ...(draft.subheadline.trim()
        ? { subheadline: draft.subheadline.trim() }
        : {}),
      ...(draft.captionHint.trim()
        ? { captionHint: draft.captionHint.trim() }
        : {}),
      ...(typeof sourceTimestampSeconds === 'number'
        ? { sourceTimestampSeconds }
        : {}),
      ...(draft.sourceQuote.trim()
        ? { sourceQuote: draft.sourceQuote.trim() }
        : {}),
      visualSummary: draft.visualSummary.trim(),
      ...(visualPrompt ? { visualPrompt } : {}),
      altText: draft.altText.trim(),
      confidence: Math.max(0.1, Math.min(0.95, Number(draft.confidence.toFixed(2)))),
      warnings,
    };
  }
}
