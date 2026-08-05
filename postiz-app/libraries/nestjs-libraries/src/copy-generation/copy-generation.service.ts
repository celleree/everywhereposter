import { Injectable } from '@nestjs/common';
import { uniq, uniqBy } from 'lodash';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import { GenerateMediaCopyDto } from '@gitroom/nestjs-libraries/dtos/copy-generation/generate.media.copy.dto';
import {
  CopyGenerationBrief,
  CopyGenerationStreamEvent,
  CopyGenerationWarning,
  GenerateMediaCopyResponse,
  GenerateMediaCopyResult,
  ImagePlanItem,
} from '@gitroom/nestjs-libraries/dtos/copy-generation/generate.media.copy.response';
import {
  CopyPlatform,
  PlatformRuleOverrides,
  resolvePlatformRule,
} from '@gitroom/nestjs-libraries/copy-generation/platform-rules';
import type { CaptionMode } from '@gitroom/nestjs-libraries/copy-generation/caption-modes';
import { platformAdapters } from '@gitroom/nestjs-libraries/copy-generation/platform-adapters';
import {
  SourceBriefResult,
  SourceBriefService,
} from '@gitroom/nestjs-libraries/copy-generation/source-brief.service';
import {
  AntiGenericService,
} from '@gitroom/nestjs-libraries/copy-generation/anti-generic.service';
import { CopyGenerationModelService } from '@gitroom/nestjs-libraries/copy-generation/copy-generation.model.service';
import { ImagePlanService } from '@gitroom/nestjs-libraries/copy-generation/image-plan.service';

const CAPTION_ANCHOR_PATTERNS = [
  /\b(?:https?:\/\/|www\.)[^\s]+|\b[a-z0-9.-]+\.[a-z]{2,}(?:\/[^\s]*)?/gi,
  /@[a-z0-9_.-]+/gi,
  /[$€£¥]?\d[\d,./:-]*(?:%|\s?(?:usd|eur|gbp))?/gi,
  /\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|may|june|july|august|september|october|november|december)\b/gi,
  /\b(?:sign up|learn more|save your seat|book now|register|subscribe|download|apply|join|visit|click|buy|shop|follow|comment|share|contact|dm|message)\b/gi,
];

const normalizeCaptionAnchor = (anchor: string) =>
  anchor.toLowerCase().replace(/[),.!?;:'"]+$/, '');

const extractCaptionAnchors = (caption: string) =>
  uniq(
    CAPTION_ANCHOR_PATTERNS.flatMap((pattern) =>
      Array.from(caption.matchAll(pattern), (match) =>
        normalizeCaptionAnchor(match[0])
      )
    ).filter(Boolean)
  );

const findMissingCaptionAnchors = (sourceCaption: string, draft: string) => {
  const draftAnchors = new Set(extractCaptionAnchors(draft));
  return extractCaptionAnchors(sourceCaption).filter(
    (anchor) => !draftAnchors.has(anchor)
  );
};

@Injectable()
export class CopyGenerationService {
  constructor(
    private readonly _sourceBriefService: SourceBriefService,
    private readonly _antiGenericService: AntiGenericService,
    private readonly _copyGenerationModelService: CopyGenerationModelService,
    private readonly _imagePlanService?: ImagePlanService
  ) {}

  async *generate(
    orgId: string,
    body: GenerateMediaCopyDto
  ): AsyncGenerator<CopyGenerationStreamEvent> {
    const requestId = makeId(12);
    const captionMode: CaptionMode = body.captionMode || 'generate';
    const platforms = uniq(body.platforms);
    yield {
      name: 'copy-generation-started',
      data: {
        requestId,
      },
    };

    if (captionMode === 'use-everywhere') {
      await this._sourceBriefService.assertMediaAccess(orgId, body.mediaId);
      const sourceCaption = body.sourceCaption as string;
      const results: GenerateMediaCopyResult[] = [];

      for (const platform of platforms) {
        yield {
          name: 'platform-started',
          data: { platform },
        };

        const controls = body.platformControls?.[platform] as
          | PlatformRuleOverrides
          | undefined;
        const platformRule = resolvePlatformRule(platform, controls);
        const warnings: CopyGenerationWarning[] = [];

        if (sourceCaption.length > platformRule.hardCap) {
          warnings.push({
            code: 'ORIGINAL_CAPTION_OVER_LIMIT',
            message: `The original caption is ${sourceCaption.length} characters, which exceeds the ${platform} limit of ${platformRule.hardCap}. It was returned unchanged.`,
          });
        }

        const result: GenerateMediaCopyResult = {
          platform,
          draft: sourceCaption,
          origin: 'original',
          charCount: sourceCaption.length,
          confidence: null,
          antiGenericScore: null,
          rewritten: false,
          warnings,
        };

        results.push(result);
        yield {
          name: 'platform-complete',
          data: {
            platform,
            score: result.antiGenericScore,
            warnings: result.warnings,
          },
        };
      }

      yield {
        name: 'completed',
        data: {
          requestId,
          status: 'complete',
          sourceConfidence: null,
          warnings: results.flatMap((result) => result.warnings),
          results,
          imagePlans: [],
        } satisfies GenerateMediaCopyResponse,
      };
      return;
    }

    const sourceBrief = await this._sourceBriefService.build(orgId, body);
    yield {
      name: 'source-brief-complete',
      data: {
        mediaType: sourceBrief.media.mediaType,
        sourceConfidence: sourceBrief.sourceConfidence,
        warnings: sourceBrief.warnings,
      },
    };

    if (sourceBrief.blocked && captionMode === 'generate') {
      const blockedResponse: GenerateMediaCopyResponse = {
        requestId,
        status: 'failed',
        sourceConfidence: sourceBrief.sourceConfidence,
        warnings: sourceBrief.warnings,
        results: [],
        imagePlans: [],
      };

      yield {
        name: 'completed',
        data: blockedResponse,
      };
      return;
    }

    const topLevelWarnings = [...sourceBrief.warnings];
    const results: GenerateMediaCopyResult[] = [];

    for (const platform of platforms) {
      yield {
        name: 'platform-started',
        data: {
          platform,
        },
      };

      try {
        const brief = this.buildBrief(platform, body, sourceBrief);
        const adapter = platformAdapters[platform];
        const generated = await this._copyGenerationModelService.generatePlatformDraft(
          brief,
          adapter.buildSystemPrompt(brief),
          this._antiGenericService.buildPromptConstraints()
        );

        let draft = generated.draft.trim();
        let resultOrigin: GenerateMediaCopyResult['origin'] =
          captionMode === 'adapt-by-platform' ? 'adapted' : 'generated';
        let rewritten = false;
        const resultWarnings: CopyGenerationWarning[] = [];
        const missingAnchors =
          captionMode === 'adapt-by-platform'
            ? findMissingCaptionAnchors(body.sourceCaption as string, draft)
            : [];

        if (missingAnchors.length) {
          draft = body.sourceCaption as string;
          resultOrigin = 'original';
          resultWarnings.push({
            code: 'ADAPTATION_PRESERVATION_FAILED',
            message:
              'The platform adaptation omitted authoritative caption details, so the original caption was returned unchanged.',
          });
        }

        let score =
          resultOrigin === 'original'
            ? null
            : this._antiGenericService.scoreDraft(draft, brief);

        if (
          captionMode === 'generate' &&
          score &&
          this._antiGenericService.shouldRewrite(score)
        ) {
          yield {
            name: 'platform-rewrite-started',
            data: {
              platform,
              reasons: score.reasons,
            },
          };

          const rewrittenDraft =
            await this._copyGenerationModelService.rewriteDraft({
              brief,
              draft,
              reasons: score.reasons,
              targetCharacters: brief.platform.targetCharacters,
              hardCap: brief.platform.hardCap,
            });

          if (rewrittenDraft.draft?.trim()) {
            draft = rewrittenDraft.draft.trim();
            rewritten = true;
          }

          score = this._antiGenericService.scoreDraft(draft, brief);
          resultWarnings.push({
            code: 'GENERIC_TONE_REWRITTEN',
            message:
              'This draft was rewritten once to remove generic AI-sounding phrasing.',
          });
        } else if (
          (score && this._antiGenericService.shouldWarn(score)) ||
          (captionMode === 'adapt-by-platform' &&
            score &&
            this._antiGenericService.shouldRewrite(score))
        ) {
          resultWarnings.push({
            code: 'GENERIC_TONE_WARNING',
            message:
              'This draft may still read a little generic and should be reviewed before publishing.',
          });
        }

        if (score && score.score >= 60) {
          resultWarnings.push({
            code: 'GENERIC_TONE_HIGH',
            message:
              'This draft scored high on generic-tone checks and should be reviewed before publishing.',
          });
        }

        const overlapCheck =
          resultOrigin === 'original'
            ? { overlaps: false }
            : this._antiGenericService.detectTranscriptOverlap(
                draft,
                sourceBrief.overlapReferenceTexts
              );

        if (captionMode === 'generate' && overlapCheck.overlaps) {
          const overlapRewrite =
            await this._copyGenerationModelService.rewriteDraft({
              brief,
              draft,
              reasons: [
                'contains near-verbatim transcript phrasing from the knowledge base',
              ],
              targetCharacters: brief.platform.targetCharacters,
              hardCap: brief.platform.hardCap,
            });

          if (overlapRewrite.draft?.trim()) {
            draft = overlapRewrite.draft.trim();
            rewritten = true;
            resultWarnings.push({
              code: 'TRANSCRIPT_OVERLAP_REWRITTEN',
              message:
                'This draft was rewritten to avoid copying transcript phrasing too closely.',
            });
          }

          const finalOverlapCheck = this._antiGenericService.detectTranscriptOverlap(
            draft,
            sourceBrief.overlapReferenceTexts
          );

          if (finalOverlapCheck.overlaps) {
            resultWarnings.push({
              code: 'TRANSCRIPT_OVERLAP_HIGH',
              message:
                'This draft still overlaps strongly with transcript wording and should be reviewed before publishing.',
            });
          }

          score = this._antiGenericService.scoreDraft(draft, brief);
        }

        const hardCapAdjusted = this.enforceHardCap(
          draft,
          brief.platform.hardCap
        );
        if (resultOrigin === 'adapted' && hardCapAdjusted !== draft) {
          resultWarnings.push({
            code: 'ADAPTED_CAPTION_OVER_LIMIT',
            message:
              'The adapted caption exceeds the platform hard cap and was returned without truncation to preserve its authoritative details.',
          });
        } else if (resultOrigin === 'original' && hardCapAdjusted !== draft) {
          resultWarnings.push({
            code: 'ORIGINAL_CAPTION_OVER_LIMIT',
            message:
              'The original caption exceeds the platform hard cap and was returned unchanged.',
          });
        } else if (hardCapAdjusted !== draft) {
          draft = hardCapAdjusted;
          resultWarnings.push({
            code: 'CHAR_LIMIT_CLAMPED',
            message:
              'The draft was trimmed to fit the platform hard cap and may need a final manual pass.',
          });
        }

        const result: GenerateMediaCopyResult = {
          platform,
          draft,
          origin: resultOrigin,
          ...(resultOrigin !== 'original'
            ? {
                angle: generated.angle || undefined,
                hook: generated.hook || undefined,
                cta: generated.cta || undefined,
              }
            : {}),
          charCount: draft.length,
          confidence:
            resultOrigin === 'original'
              ? null
              : this.calculateResultConfidence(
                  sourceBrief,
                  resultWarnings,
                  rewritten
                ),
          antiGenericScore: score?.score ?? null,
          rewritten,
          warnings: resultWarnings,
        };

        results.push(result);
        yield {
          name: 'platform-complete',
          data: {
            platform,
            score: result.antiGenericScore,
            warnings: result.warnings,
          },
        };
      } catch (error: any) {
        topLevelWarnings.push({
          code: 'PLATFORM_GENERATION_FAILED',
          message: `Generation failed for ${platform}: ${error?.message || 'Unknown error'}`,
        });

        yield {
          name: 'platform-failed',
          data: {
            platform,
          },
        };
      }
    }

    let imagePlans: ImagePlanItem[] = [];
    if (sourceBrief.media.mediaType === 'video' && this._imagePlanService) {
      yield {
        name: 'image-plan-started',
        data: {
          platforms,
        },
      };

      try {
        imagePlans = await this._imagePlanService.generate(
          sourceBrief,
          platforms
        );
        yield {
          name: 'image-plan-complete',
          data: {
            count: imagePlans.length,
            platforms: imagePlans.map((plan) => plan.platform),
          },
        };
      } catch (error: any) {
        topLevelWarnings.push({
          code: 'IMAGE_PLAN_GENERATION_FAILED',
          message: `Image planning failed: ${error?.message || 'Unknown error'}`,
        });
        yield {
          name: 'image-plan-failed',
          data: {},
        };
      }
    }

    const response: GenerateMediaCopyResponse = {
      requestId,
      status:
        results.length === 0
          ? 'failed'
          : results.length === platforms.length
          ? 'complete'
          : 'partial',
      sourceConfidence: sourceBrief.sourceConfidence,
      warnings: uniqBy(topLevelWarnings, (warning) => `${warning.code}:${warning.message}`),
      results,
      imagePlans,
    };

    yield {
      name: 'completed',
      data: response,
    };
  }

  private buildBrief(
    platform: CopyPlatform,
    body: GenerateMediaCopyDto,
    sourceBrief: SourceBriefResult
  ): CopyGenerationBrief {
    const controls =
      body.platformControls?.[platform] as PlatformRuleOverrides | undefined;
    const resolvedPlatform = resolvePlatformRule(platform, controls);

    return {
      source: sourceBrief.source,
      strategy: {
        audience: body.audience,
        goal: body.goal,
        captionMode: body.captionMode || 'generate',
        ...(body.sourceCaption
          ? {
              sourceCaption: body.sourceCaption,
            }
          : {}),
        ...(body.additionalContext?.trim()
          ? {
              additionalContext: body.additionalContext,
            }
          : {}),
        ...(body.ctaPreference
          ? {
              ctaPreference: body.ctaPreference,
            }
          : {}),
        coreMessage: sourceBrief.coreMessage,
      },
      personalization: {
        knowledgeBaseFacts: uniq(
          [
            ...(body.knowledgeBaseFacts?.map((fact) => fact.text).filter(Boolean) ||
              []),
            ...sourceBrief.storedKnowledgeBaseFacts,
          ]
        ).slice(0, 20),
        ...(sourceBrief.voiceProfile
          ? {
              voiceProfile: sourceBrief.voiceProfile,
            }
          : {}),
      },
      platform: resolvedPlatform,
    };
  }

  private calculateResultConfidence(
    sourceBrief: SourceBriefResult,
    warnings: CopyGenerationWarning[],
    rewritten: boolean
  ) {
    let confidence = sourceBrief.sourceConfidence;

    if (rewritten) {
      confidence -= 0.06;
    }

    if (warnings.some((warning) => warning.code === 'CHAR_LIMIT_CLAMPED')) {
      confidence -= 0.08;
    }

    if (
      warnings.some(
        (warning) => warning.code === 'ADAPTED_CAPTION_OVER_LIMIT'
      )
    ) {
      confidence -= 0.08;
    }

    if (warnings.some((warning) => warning.code === 'GENERIC_TONE_HIGH')) {
      confidence -= 0.12;
    }

    if (
      warnings.some((warning) => warning.code === 'TRANSCRIPT_OVERLAP_HIGH')
    ) {
      confidence -= 0.12;
    }

    if (
      sourceBrief.warnings.some((warning) => warning.code === 'VOICE_PROFILE_WEAK')
    ) {
      confidence -= 0.04;
    }

    return Math.max(0.1, Math.min(0.95, Number(confidence.toFixed(2))));
  }

  private enforceHardCap(draft: string, hardCap: number) {
    if (draft.length <= hardCap) {
      return draft;
    }

    const normalized = draft.replace(/\s+/g, ' ').trim();
    if (normalized.length <= hardCap) {
      return normalized;
    }

    const sliced = normalized.slice(0, hardCap + 1);
    const lastSpace = sliced.lastIndexOf(' ');

    return (lastSpace > 50 ? sliced.slice(0, lastSpace) : sliced.slice(0, hardCap)).trim();
  }
}
