import { Injectable, NotFoundException } from '@nestjs/common';
import { lookup } from 'mime-types';
import { uniq } from 'lodash';
import { readOrFetch } from '@gitroom/helpers/utils/read.or.fetch';
import { MediaRepository } from '@gitroom/nestjs-libraries/database/prisma/media/media.repository';
import { CopyGenerationModelService } from '@gitroom/nestjs-libraries/copy-generation/copy-generation.model.service';
import { GenerateMediaCopyDto } from '@gitroom/nestjs-libraries/dtos/copy-generation/generate.media.copy.dto';
import { KnowledgeBaseService } from '@gitroom/nestjs-libraries/database/prisma/knowledge-base/knowledge-base.service';
import {
  CopyGenerationWarning,
  VoiceProfileSnapshot,
} from '@gitroom/nestjs-libraries/dtos/copy-generation/generate.media.copy.response';

export interface VisualScene {
  timestampSeconds: number;
  description: string;
  visibleText: string;
  usefulForPosting: boolean;
}

export interface SourceBriefResult {
  media: {
    id: string;
    path: string;
    originalName?: string | null;
    alt?: string | null;
    mediaType: 'image' | 'video';
    mimeType: string;
  };
  source: {
    mediaType: 'image' | 'video';
    visualSummary: string;
    transcriptSummary?: string;
    facts: string[];
    unknowns: string[];
    scenes?: VisualScene[];
  };
  transcript?: {
    text: string;
    source: 'manual' | 'generated';
    confidence?: number;
  };
  storedKnowledgeBaseFacts: string[];
  overlapReferenceTexts: string[];
  voiceProfile?: VoiceProfileSnapshot;
  sourceConfidence: number;
  coreMessage: string;
  warnings: CopyGenerationWarning[];
  blocked: boolean;
}

const DEFAULT_VOICE_PROFILE: VoiceProfileSnapshot = {
  sentenceLength: 'mixed',
  lineBreakHabit: 'moderate',
  ctaStyle: 'invite',
  vocabularyTendencies: [],
  tabooPhrases: [],
  preferredOpenings: [],
  confidence: 0.35,
};

@Injectable()
export class SourceBriefService {
  constructor(
    private readonly _mediaRepository: MediaRepository,
    private readonly _copyGenerationModelService: CopyGenerationModelService,
    private readonly _knowledgeBaseService: KnowledgeBaseService
  ) {}

  async build(orgId: string, body: GenerateMediaCopyDto): Promise<SourceBriefResult> {
    const media = await this._mediaRepository.getMediaByOrganizationIdAndId(
      orgId,
      body.mediaId
    );

    if (!media) {
      throw new NotFoundException('Media not found');
    }

    const mimeType = this.getMimeType(media.path, media.originalName, media.name);
    const mediaType = mimeType.startsWith('video/') ? 'video' : 'image';
    const warnings: CopyGenerationWarning[] = [];

    let transcript = body.transcript?.text?.trim()
      ? {
          text: body.transcript.text.trim(),
          source: body.transcript.source,
          confidence: body.transcript.confidence,
        }
      : undefined;

    let transcriptSummary = '';
    let transcriptFacts: string[] = [];
    let transcriptUnknowns: string[] = [];
    let visualSummary =
      media.alt?.trim() ||
      (mediaType === 'video'
        ? `Video asset: ${media.originalName || media.name}`
        : `Image asset: ${media.originalName || media.name}`);
    let visualFacts: string[] = [];
    let visualUnknowns: string[] = [];
    let visualScenes: VisualScene[] = [];
    let voiceProfile: VoiceProfileSnapshot | undefined;
    let coreMessage = '';
    const sourceConfidenceParts: number[] = [];
    let videoBuffer: Buffer | undefined;

    const getVideoBuffer = async () => {
      if (!videoBuffer) {
        videoBuffer = Buffer.from(await readOrFetch(media.path));
      }

      return videoBuffer;
    };

    if (mediaType === 'image') {
      const imageBuffer = Buffer.from(await readOrFetch(media.path));
      const imageInsights = await this._copyGenerationModelService.analyzeImage({
        buffer: imageBuffer,
        mimeType,
        altText: media.alt,
        originalName: media.originalName || media.name,
        transcriptText: transcript?.text,
      });

      visualSummary = imageInsights.visualSummary || visualSummary;
      visualFacts = imageInsights.facts || [];
      visualUnknowns = imageInsights.unknowns || [];
      coreMessage = imageInsights.coreMessage || coreMessage;
      sourceConfidenceParts.push(imageInsights.sourceConfidence || 0.65);
    }

    if (mediaType === 'video' && !transcript?.text) {
      try {
        const transcription =
          await this._copyGenerationModelService.transcribeVideo({
            buffer: await getVideoBuffer(),
            mimeType,
            originalName: media.originalName || media.name,
          });
        if (transcription.text?.trim()) {
          transcript = {
            text: transcription.text.trim(),
            source: 'generated',
            confidence: 0.68,
          };
        } else {
          warnings.push({
            code: 'TRANSCRIPT_REQUIRED',
            message:
              'Auto transcription did not return usable text. Add a transcript for stronger grounded copy from this video.',
          });
        }
      } catch {
        warnings.push({
          code: 'TRANSCRIPT_REQUIRED',
          message:
            'Auto transcription failed for this video. Add a transcript for stronger grounded copy.',
        });
      }
    }

    if (mediaType === 'video') {
      try {
        const videoInsights =
          await this._copyGenerationModelService.analyzeVideoFrames({
            buffer: await getVideoBuffer(),
            mimeType,
            altText: media.alt,
            originalName: media.originalName || media.name,
            transcriptText: transcript?.text,
          });

        visualSummary = videoInsights.visualSummary || visualSummary;
        visualFacts = videoInsights.facts || [];
        visualUnknowns = videoInsights.unknowns || [];
        visualScenes = (videoInsights.scenes || []).flatMap(
          (scene): VisualScene[] => {
            const description = scene.description?.trim();
            if (
              typeof scene.timestampSeconds !== 'number' ||
              !Number.isFinite(scene.timestampSeconds) ||
              !description
            ) {
              return [];
            }

            return [
              {
                timestampSeconds: Math.max(0, scene.timestampSeconds),
                description,
                visibleText: scene.visibleText?.trim() || '',
                usefulForPosting: scene.usefulForPosting !== false,
              },
            ];
          }
        );
        coreMessage = videoInsights.coreMessage || coreMessage;
        sourceConfidenceParts.push(videoInsights.sourceConfidence || 0.65);
      } catch {
        warnings.push({
          code: 'VIDEO_VISUAL_ANALYSIS_FAILED',
          message:
            'Representative video frames could not be analyzed, so generation will rely on the transcript and other available source details.',
        });
      }
    }

    if (transcript?.text) {
      const transcriptInsights =
        await this._copyGenerationModelService.summarizeTranscript(
          transcript.text
        );
      transcriptSummary = transcriptInsights.transcriptSummary || '';
      transcriptFacts = transcriptInsights.facts || [];
      transcriptUnknowns = transcriptInsights.unknowns || [];
      coreMessage = transcriptInsights.coreMessage || coreMessage;
      voiceProfile = this.normalizeVoiceProfile(
        transcriptInsights.voiceProfile ?? undefined
      );
      sourceConfidenceParts.push(transcriptInsights.sourceConfidence || 0.7);

      if (
        typeof transcript.confidence === 'number' &&
        transcript.confidence < 0.55
      ) {
        warnings.push({
          code: 'LOW_TRANSCRIPT_CONFIDENCE',
          message:
            'The provided transcript confidence is low, so copy may need manual review.',
        });
      }
    } else if (mediaType === 'video') {
      const hasGroundedVisuals = visualFacts.length > 0 || visualScenes.length > 0;
      warnings.push({
        code: 'NO_TRANSCRIPT',
        message: hasGroundedVisuals
          ? 'No transcript is available, so generation will rely only on the representative video frames and may miss spoken context.'
          : 'No transcript or usable frame analysis is available for this video, so grounded copy generation is blocked.',
      });
    }

    const knowledgeBasePersonalization =
      await this._knowledgeBaseService.resolvePersonalization(
        orgId,
        body.voiceProfileId
      );

    if (!voiceProfile && knowledgeBasePersonalization.voiceProfile) {
      voiceProfile =
        knowledgeBasePersonalization.voiceProfile as VoiceProfileSnapshot;
    }

    const facts = uniq(
      [...visualFacts, ...transcriptFacts]
        .map((fact) => fact.trim())
        .filter(Boolean)
        .slice(0, 8)
    );
    const unknowns = uniq(
      [...visualUnknowns, ...transcriptUnknowns]
        .map((unknown) => unknown.trim())
        .filter(Boolean)
        .slice(0, 6)
    );

    if (facts.length < 2) {
      warnings.push({
        code: 'SOURCE_FACTS_THIN',
        message:
          'The source inputs did not yield many concrete facts, so drafts may need a stronger manual pass.',
      });
    }

    if (body.voiceProfileId && knowledgeBasePersonalization.explicitVoiceProfileMissed) {
      warnings.push({
        code: 'VOICE_PROFILE_WEAK',
        message:
          'The requested stored voice profile was not found, so the generator fell back to the active org profile or platform-native defaults.',
      });
    }

    if (voiceProfile && voiceProfile.confidence < 0.45) {
      warnings.push({
        code: 'VOICE_PROFILE_WEAK',
        message:
          'The transcript was too weak to build a strong voice profile, so personalization is limited.',
      });
    }

    const averageConfidence =
      sourceConfidenceParts.length > 0
        ? sourceConfidenceParts.reduce((sum, value) => sum + value, 0) /
          sourceConfidenceParts.length
        : mediaType === 'image'
        ? 0.55
        : 0.2;
    const hasGroundedVideoSource =
      Boolean(transcript?.text) || visualFacts.length > 0 || visualScenes.length > 0;

    return {
      media: {
        id: media.id,
        path: media.path,
        originalName: media.originalName,
        alt: media.alt,
        mediaType,
        mimeType,
      },
      source: {
        mediaType,
        visualSummary,
        ...(transcriptSummary ? { transcriptSummary } : {}),
        facts,
        unknowns,
        ...(visualScenes.length ? { scenes: visualScenes } : {}),
      },
      ...(transcript
        ? {
            transcript,
          }
        : {}),
      storedKnowledgeBaseFacts: knowledgeBasePersonalization.storedFacts,
      overlapReferenceTexts: uniq(
        [
          ...(transcript?.text ? [transcript.text] : []),
          ...knowledgeBasePersonalization.overlapReferenceTexts,
        ]
          .map((item) => item.trim())
          .filter(Boolean)
      ),
      ...(voiceProfile ? { voiceProfile } : {}),
      sourceConfidence: this.clampConfidence(averageConfidence),
      coreMessage:
        coreMessage ||
        facts[0] ||
        transcriptSummary ||
        visualSummary ||
        'Share the clearest useful point from the source input.',
      warnings,
      blocked: mediaType === 'video' && !hasGroundedVideoSource,
    };
  }

  private getMimeType(path: string, originalName?: string | null, name?: string | null) {
    const mimeType =
      lookup(originalName || '') ||
      lookup(name || '') ||
      lookup(path || '') ||
      (path.includes('.mp4') ? 'video/mp4' : 'image/png');

    return `${mimeType}`;
  }

  private clampConfidence(value: number) {
    return Math.max(0.1, Math.min(0.95, Number(value.toFixed(2))));
  }

  private normalizeVoiceProfile(
    profile?: Partial<VoiceProfileSnapshot>
  ): VoiceProfileSnapshot | undefined {
    if (!profile) {
      return undefined;
    }

    return {
      sentenceLength:
        profile.sentenceLength === 'short' || profile.sentenceLength === 'long'
          ? profile.sentenceLength
          : DEFAULT_VOICE_PROFILE.sentenceLength,
      lineBreakHabit:
        profile.lineBreakHabit === 'tight' || profile.lineBreakHabit === 'airy'
          ? profile.lineBreakHabit
          : DEFAULT_VOICE_PROFILE.lineBreakHabit,
      ctaStyle:
        profile.ctaStyle === 'none' ||
        profile.ctaStyle === 'question' ||
        profile.ctaStyle === 'direct'
          ? profile.ctaStyle
          : DEFAULT_VOICE_PROFILE.ctaStyle,
      vocabularyTendencies: Array.isArray(profile.vocabularyTendencies)
        ? profile.vocabularyTendencies.filter(Boolean)
        : DEFAULT_VOICE_PROFILE.vocabularyTendencies,
      tabooPhrases: Array.isArray(profile.tabooPhrases)
        ? profile.tabooPhrases.filter(Boolean)
        : DEFAULT_VOICE_PROFILE.tabooPhrases,
      preferredOpenings: Array.isArray(profile.preferredOpenings)
        ? profile.preferredOpenings.filter(Boolean)
        : DEFAULT_VOICE_PROFILE.preferredOpenings,
      confidence:
        typeof profile.confidence === 'number'
          ? Number(Math.max(0, Math.min(1, profile.confidence)).toFixed(2))
          : DEFAULT_VOICE_PROFILE.confidence,
    };
  }
}
