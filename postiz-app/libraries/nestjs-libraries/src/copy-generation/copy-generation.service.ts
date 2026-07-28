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
    yield {
      name: 'copy-generation-started',
      data: {
        requestId,
      },
    };

    const sourceBrief = await this._sourceBriefService.build(orgId, body);
    yield {
      name: 'source-brief-complete',
      data: {
        mediaType: sourceBrief.media.mediaType,
        sourceConfidence: sourceBrief.sourceConfidence,
        warnings: sourceBrief.warnings,
      },
    };

    if (sourceBrief.blocked) {
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

    for (const platform of body.platforms) {
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
        let rewritten = false;
        let score = this._antiGenericService.scoreDraft(draft, brief);
        const resultWarnings: CopyGenerationWarning[] = [];

        if (this._antiGenericService.shouldRewrite(score)) {
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
        } else if (this._antiGenericService.shouldWarn(score)) {
          resultWarnings.push({
            code: 'GENERIC_TONE_WARNING',
            message:
              'This draft may still read a little generic and should be reviewed before publishing.',
          });
        }

        if (score.score >= 60) {
          resultWarnings.push({
            code: 'GENERIC_TONE_HIGH',
            message:
              'This draft still scored high on generic-tone checks after the rewrite pass.',
          });
        }

        const overlapCheck = this._antiGenericService.detectTranscriptOverlap(
          draft,
          sourceBrief.overlapReferenceTexts
        );

        if (overlapCheck.overlaps) {
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

        const hardCapAdjusted = this.enforceHardCap(draft, brief.platform.hardCap);
        if (hardCapAdjusted !== draft) {
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
          angle: generated.angle || undefined,
          hook: generated.hook || undefined,
          cta: generated.cta || undefined,
          charCount: draft.length,
          confidence: this.calculateResultConfidence(
            sourceBrief,
            resultWarnings,
            rewritten
          ),
          antiGenericScore: score.score,
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
          platforms: body.platforms,
        },
      };

      try {
        imagePlans = await this._imagePlanService.generate(
          sourceBrief,
          body.platforms
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
          : results.length === body.platforms.length
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
