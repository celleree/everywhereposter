import { Injectable } from '@nestjs/common';
import {
  KnowledgeDocument,
  KnowledgeInputMethod,
  VoiceProfile,
} from '@prisma/client';
import { uniq } from 'lodash';
import { CopyGenerationModelService } from '@gitroom/nestjs-libraries/copy-generation/copy-generation.model.service';
import { VoiceProfileSnapshot } from '@gitroom/nestjs-libraries/dtos/copy-generation/generate.media.copy.response';
import { KnowledgeBaseRepository } from '@gitroom/nestjs-libraries/database/prisma/knowledge-base/knowledge-base.repository';
import {
  KnowledgeBaseSummaryResponse,
  KnowledgeDocumentResponse,
  VoiceProfileResponse,
} from '@gitroom/nestjs-libraries/dtos/settings/knowledge-base/knowledge-base.responses';

type KnowledgeBasePersonalization = {
  voiceProfile?: VoiceProfileSnapshot;
  storedFacts: string[];
  overlapReferenceTexts: string[];
  storedProfileId?: string;
  explicitVoiceProfileMissed: boolean;
};

type ChunkStyleMarkers = {
  transcriptSummary?: string;
  sentenceLength?: 'short' | 'mixed' | 'long';
  lineBreakHabit?: 'tight' | 'moderate' | 'airy';
  ctaStyle?: 'none' | 'question' | 'invite' | 'direct';
  vocabularyTendencies?: string[];
  tabooPhrases?: string[];
  preferredOpenings?: string[];
  confidence?: number;
};

const DEFAULT_VOICE_PROFILE: VoiceProfileSnapshot = {
  sentenceLength: 'mixed',
  lineBreakHabit: 'moderate',
  ctaStyle: 'invite',
  vocabularyTendencies: [],
  tabooPhrases: [],
  preferredOpenings: [],
  confidence: 0.35,
};

const MAX_CHUNK_TOKENS = 900;
const MIN_CHUNK_TOKENS = 600;
const OVERLAP_TOKENS = 100;
const MAX_APPROVED_FACTS = 18;

@Injectable()
export class KnowledgeBaseService {
  constructor(
    private readonly _knowledgeBaseRepository: KnowledgeBaseRepository,
    private readonly _copyGenerationModelService: CopyGenerationModelService
  ) {}

  async getSummary(orgId: string): Promise<KnowledgeBaseSummaryResponse> {
    const [documents, activeVoiceProfile] = await Promise.all([
      this._knowledgeBaseRepository.listDocuments(orgId),
      this._knowledgeBaseRepository.getActiveVoiceProfile(orgId),
    ]);

    return {
      documents: documents.map((document) => this.mapDocument(document)),
      ...(activeVoiceProfile
        ? {
            activeVoiceProfile: this.mapVoiceProfile(activeVoiceProfile),
          }
        : {}),
    };
  }

  async ingestTranscript(params: {
    orgId: string;
    userId: string;
    title?: string;
    text: string;
    inputMethod: KnowledgeInputMethod;
  }) {
    const title = this.resolveTitle(params.title, params.text);
    const rawText = params.text.trim();
    const document = await this._knowledgeBaseRepository.createDocument({
      organizationId: params.orgId,
      createdByUserId: params.userId,
      title,
      rawText,
      inputMethod: params.inputMethod,
    });

    await this.processDocument(params.orgId, document.id);
    return this.getSummary(params.orgId);
  }

  async reprocessDocument(orgId: string, documentId: string) {
    await this.processDocument(orgId, documentId);
    return this.getSummary(orgId);
  }

  async deleteDocument(orgId: string, documentId: string) {
    await this._knowledgeBaseRepository.softDeleteDocument(orgId, documentId);
    await this.rebuildActiveVoiceProfile(orgId);
    return this.getSummary(orgId);
  }

  async resolvePersonalization(
    orgId: string,
    explicitVoiceProfileId?: string
  ): Promise<KnowledgeBasePersonalization> {
    const explicitProfile = explicitVoiceProfileId
      ? await this._knowledgeBaseRepository.getVoiceProfileById(
          orgId,
          explicitVoiceProfileId
        )
      : undefined;
    const activeProfile =
      explicitProfile ||
      (await this._knowledgeBaseRepository.getActiveVoiceProfile(orgId));
    const readyDocuments =
      await this._knowledgeBaseRepository.getReadyDocumentsWithChunks(orgId);

    return {
      ...(activeProfile
        ? {
            voiceProfile: this.toVoiceProfileSnapshot(activeProfile),
            storedFacts: this.readStringArray(activeProfile.approvedFactsJson),
            storedProfileId: activeProfile.id,
          }
        : {
            storedFacts: [],
          }),
      overlapReferenceTexts: readyDocuments.flatMap((document) =>
        document.chunks.map((chunk) => chunk.text)
      ),
      explicitVoiceProfileMissed: !!explicitVoiceProfileId && !explicitProfile,
    };
  }

  private async processDocument(orgId: string, documentId: string) {
    const document = await this._knowledgeBaseRepository.getDocumentByIdOrThrow(
      orgId,
      documentId
    );

    await this._knowledgeBaseRepository.markDocumentProcessing(orgId, documentId);

    try {
      const normalizedText = this.normalizeTranscriptText(document.rawText);
      if (!normalizedText) {
        throw new Error('Transcript did not contain usable text after normalization.');
      }

      const chunks = this.buildTranscriptChunks(normalizedText);
      if (!chunks.length) {
        throw new Error('Transcript did not contain enough usable text to build chunks.');
      }

      const chunkPayloads = await Promise.all(
        chunks.map(async (chunk, index) => {
          const insights = await this._copyGenerationModelService.summarizeTranscript(
            chunk
          );
          const voiceProfile = insights.voiceProfile || DEFAULT_VOICE_PROFILE;
          return {
            chunkIndex: index,
            text: chunk,
            factsJson: uniq((insights.facts || []).map((fact) => fact.trim()).filter(Boolean)).slice(
              0,
              8
            ),
            styleMarkersJson: {
              transcriptSummary: insights.transcriptSummary || '',
              sentenceLength: voiceProfile.sentenceLength,
              lineBreakHabit: voiceProfile.lineBreakHabit,
              ctaStyle: voiceProfile.ctaStyle,
              vocabularyTendencies: voiceProfile.vocabularyTendencies,
              tabooPhrases: voiceProfile.tabooPhrases,
              preferredOpenings: voiceProfile.preferredOpenings,
              confidence: voiceProfile.confidence ?? insights.sourceConfidence ?? 0.35,
            },
            charCount: chunk.length,
          };
        })
      );

      await this._knowledgeBaseRepository.saveDocumentProcessingResult({
        documentId,
        normalizedText,
        chunks: chunkPayloads,
      });
      await this.rebuildActiveVoiceProfile(orgId);
    } catch (error: any) {
      await this._knowledgeBaseRepository.updateDocumentFailed(
        documentId,
        error?.message || 'Transcript ingestion failed.'
      );
    }
  }

  private async rebuildActiveVoiceProfile(orgId: string) {
    const readyDocuments =
      await this._knowledgeBaseRepository.getReadyDocumentsWithChunks(orgId);

    if (!readyDocuments.length) {
      await this._knowledgeBaseRepository.clearActiveVoiceProfiles(orgId);
      return;
    }

    const aggregatedProfile = this.aggregateVoiceProfile(readyDocuments);
    await this._knowledgeBaseRepository.publishVoiceProfile(orgId, aggregatedProfile);
  }

  private aggregateVoiceProfile(
    documents: Awaited<ReturnType<KnowledgeBaseRepository['getReadyDocumentsWithChunks']>>
  ) {
    const styleMarkers = documents.flatMap((document) =>
      document.chunks.map((chunk) => this.readStyleMarkers(chunk.styleMarkersJson))
    );
    const facts = documents.flatMap((document) =>
      document.chunks.flatMap((chunk) => this.readStringArray(chunk.factsJson))
    );

    const confidenceValues = styleMarkers
      .map((markers) => markers.confidence)
      .filter((value): value is number => typeof value === 'number');
    const confidence =
      confidenceValues.length > 0
        ? confidenceValues.reduce((sum, value) => sum + value, 0) /
          confidenceValues.length
        : 0.35;

    return {
      sentenceLength: this.pickMode(
        styleMarkers.map((marker) => marker.sentenceLength || 'mixed'),
        'mixed'
      ),
      lineBreakHabit: this.pickMode(
        styleMarkers.map((marker) => marker.lineBreakHabit || 'moderate'),
        'moderate'
      ),
      ctaStyle: this.pickMode(
        styleMarkers.map((marker) => marker.ctaStyle || 'invite'),
        'invite'
      ),
      vocabularyTendencies: this.pickTopTerms(
        styleMarkers.flatMap((marker) => marker.vocabularyTendencies || []),
        10
      ),
      tabooPhrases: this.pickTopTerms(
        styleMarkers.flatMap((marker) => marker.tabooPhrases || []),
        10
      ),
      preferredOpenings: this.pickTopTerms(
        styleMarkers.flatMap((marker) => marker.preferredOpenings || []),
        6
      ),
      approvedFactsJson: this.pickTopTerms(facts, MAX_APPROVED_FACTS),
      sourceDocumentCount: documents.length,
      confidence: Number(Math.max(0.2, Math.min(0.95, confidence)).toFixed(2)),
    };
  }

  private normalizeTranscriptText(rawText: string) {
    const lines = rawText
      .replace(/^\uFEFF/, '')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .split('\n');

    const normalizedLines: string[] = [];
    let skipCueMetadata = false;

    for (const line of lines) {
      const trimmed = line.trim();

      if (!trimmed) {
        normalizedLines.push('');
        skipCueMetadata = false;
        continue;
      }

      if (
        trimmed === 'WEBVTT' ||
        /^NOTE\b/i.test(trimmed) ||
        /^STYLE\b/i.test(trimmed) ||
        /^REGION\b/i.test(trimmed)
      ) {
        skipCueMetadata = true;
        continue;
      }

      if (skipCueMetadata) {
        continue;
      }

      if (/^\d+$/.test(trimmed)) {
        continue;
      }

      if (
        /^\d{2}:\d{2}:\d{2}[.,]\d{3}\s+-->\s+\d{2}:\d{2}:\d{2}[.,]\d{3}/.test(
          trimmed
        ) ||
        /^\d{2}:\d{2}[.,]\d{3}\s+-->\s+\d{2}:\d{2}[.,]\d{3}/.test(trimmed)
      ) {
        continue;
      }

      normalizedLines.push(trimmed);
    }

    const paragraphs = normalizedLines
      .join('\n')
      .split(/\n{2,}/)
      .map((paragraph) =>
        paragraph
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean)
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim()
      )
      .filter(Boolean);

    return paragraphs.join('\n\n').trim();
  }

  private buildTranscriptChunks(normalizedText: string) {
    const paragraphs = normalizedText
      .split(/\n{2,}/)
      .flatMap((paragraph) => this.splitLargeParagraph(paragraph.trim()))
      .filter(Boolean);

    const chunks: string[] = [];
    let currentChunk: string[] = [];
    let currentTokens = 0;

    const flushChunk = () => {
      if (!currentChunk.length) {
        return;
      }

      chunks.push(currentChunk.join('\n\n').trim());
      const overlapParagraphs: string[] = [];
      let overlapTokens = 0;

      for (let index = currentChunk.length - 1; index >= 0; index -= 1) {
        const paragraph = currentChunk[index];
        overlapParagraphs.unshift(paragraph);
        overlapTokens += this.estimateTokens(paragraph);
        if (overlapTokens >= OVERLAP_TOKENS) {
          break;
        }
      }

      currentChunk = overlapParagraphs;
      currentTokens = overlapParagraphs.reduce(
        (sum, paragraph) => sum + this.estimateTokens(paragraph),
        0
      );
    };

    for (const paragraph of paragraphs) {
      const paragraphTokens = this.estimateTokens(paragraph);

      if (!currentChunk.length) {
        currentChunk.push(paragraph);
        currentTokens = paragraphTokens;
        continue;
      }

      if (
        currentTokens >= MIN_CHUNK_TOKENS &&
        currentTokens + paragraphTokens > MAX_CHUNK_TOKENS
      ) {
        flushChunk();
      }

      currentChunk.push(paragraph);
      currentTokens += paragraphTokens;

      if (currentTokens >= MAX_CHUNK_TOKENS) {
        flushChunk();
      }
    }

    if (currentChunk.length) {
      chunks.push(currentChunk.join('\n\n').trim());
    }

    return uniq(chunks.map((chunk) => chunk.trim()).filter(Boolean));
  }

  private splitLargeParagraph(paragraph: string) {
    if (this.estimateTokens(paragraph) <= MAX_CHUNK_TOKENS) {
      return [paragraph];
    }

    const sentenceParts = paragraph
      .split(/(?<=[.!?])\s+/)
      .map((sentence) => sentence.trim())
      .filter(Boolean);

    if (sentenceParts.length <= 1) {
      return this.sliceByLength(paragraph, MAX_CHUNK_TOKENS * 4);
    }

    const segments: string[] = [];
    let current = '';

    for (const sentence of sentenceParts) {
      const next = current ? `${current} ${sentence}` : sentence;
      if (
        current &&
        this.estimateTokens(next) > MAX_CHUNK_TOKENS
      ) {
        segments.push(current.trim());
        current = sentence;
        continue;
      }

      current = next;
    }

    if (current.trim()) {
      segments.push(current.trim());
    }

    return segments.flatMap((segment) =>
      this.estimateTokens(segment) > MAX_CHUNK_TOKENS
        ? this.sliceByLength(segment, MAX_CHUNK_TOKENS * 4)
        : [segment]
    );
  }

  private sliceByLength(text: string, maxCharacters: number) {
    const slices: string[] = [];
    let remaining = text.trim();

    while (remaining.length > maxCharacters) {
      const slice = remaining.slice(0, maxCharacters + 1);
      const breakpoint = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf(' '));
      const safeEnd = breakpoint > Math.floor(maxCharacters * 0.6)
        ? breakpoint
        : maxCharacters;
      slices.push(remaining.slice(0, safeEnd).trim());
      remaining = remaining.slice(safeEnd).trim();
    }

    if (remaining) {
      slices.push(remaining);
    }

    return slices.filter(Boolean);
  }

  private estimateTokens(text: string) {
    return Math.max(1, Math.ceil(text.length / 4));
  }

  private resolveTitle(title: string | undefined, text: string) {
    if (title?.trim()) {
      return title.trim();
    }

    const firstLine = text
      .replace(/\r\n/g, '\n')
      .split('\n')
      .map((line) => line.trim())
      .find(Boolean);

    return (firstLine || 'Transcript import').slice(0, 120);
  }

  private mapDocument(document: any): KnowledgeDocumentResponse {
    const factCount = document.chunks.reduce((sum: number, chunk: any) => {
      return sum + this.readStringArray(chunk.factsJson).length;
    }, 0);

    return {
      id: document.id,
      title: document.title,
      sourceType: document.sourceType,
      inputMethod: document.inputMethod,
      status: document.status,
      createdAt: document.createdAt.toISOString(),
      updatedAt: document.updatedAt.toISOString(),
      deletedAt: document.deletedAt?.toISOString() || null,
      errorMessage: document.errorMessage,
      normalizedCharacterCount: document.normalizedText?.length || 0,
      chunkCount: document.chunks.length,
      factCount,
    };
  }

  private mapVoiceProfile(profile: VoiceProfile): VoiceProfileResponse {
    const snapshot = this.toVoiceProfileSnapshot(profile);

    return {
      id: profile.id,
      version: profile.version,
      isActive: profile.isActive,
      sourceDocumentCount: profile.sourceDocumentCount,
      approvedFacts: this.readStringArray(profile.approvedFactsJson),
      updatedAt: profile.updatedAt.toISOString(),
      ...snapshot,
    };
  }

  private toVoiceProfileSnapshot(profile: VoiceProfile): VoiceProfileSnapshot {
    return {
      sentenceLength:
        profile.sentenceLength === 'short' ||
        profile.sentenceLength === 'long'
          ? profile.sentenceLength
          : 'mixed',
      lineBreakHabit:
        profile.lineBreakHabit === 'tight' || profile.lineBreakHabit === 'airy'
          ? profile.lineBreakHabit
          : 'moderate',
      ctaStyle:
        profile.ctaStyle === 'none' ||
        profile.ctaStyle === 'question' ||
        profile.ctaStyle === 'direct'
          ? profile.ctaStyle
          : 'invite',
      vocabularyTendencies: this.readStringArray(profile.vocabularyTendencies),
      tabooPhrases: this.readStringArray(profile.tabooPhrases),
      preferredOpenings: this.readStringArray(profile.preferredOpenings),
      confidence: Number(
        Math.max(0, Math.min(1, profile.confidence || 0)).toFixed(2)
      ),
    };
  }

  private readStringArray(value: unknown) {
    if (!Array.isArray(value)) {
      return [];
    }

    return uniq(
      value
        .map((item) => (typeof item === 'string' ? item.trim() : ''))
        .filter(Boolean)
    );
  }

  private readStyleMarkers(value: unknown): ChunkStyleMarkers {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }

    const markers = value as Record<string, unknown>;
    return {
      transcriptSummary:
        typeof markers.transcriptSummary === 'string'
          ? markers.transcriptSummary
          : undefined,
      sentenceLength:
        markers.sentenceLength === 'short' ||
        markers.sentenceLength === 'long' ||
        markers.sentenceLength === 'mixed'
          ? markers.sentenceLength
          : undefined,
      lineBreakHabit:
        markers.lineBreakHabit === 'tight' ||
        markers.lineBreakHabit === 'moderate' ||
        markers.lineBreakHabit === 'airy'
          ? markers.lineBreakHabit
          : undefined,
      ctaStyle:
        markers.ctaStyle === 'none' ||
        markers.ctaStyle === 'question' ||
        markers.ctaStyle === 'invite' ||
        markers.ctaStyle === 'direct'
          ? markers.ctaStyle
          : undefined,
      vocabularyTendencies: this.readStringArray(markers.vocabularyTendencies),
      tabooPhrases: this.readStringArray(markers.tabooPhrases),
      preferredOpenings: this.readStringArray(markers.preferredOpenings),
      confidence:
        typeof markers.confidence === 'number' ? markers.confidence : undefined,
    };
  }

  private pickTopTerms(values: string[], limit: number) {
    const counts = values.reduce<Record<string, number>>((all, value) => {
      const normalized = value.trim();
      if (!normalized) {
        return all;
      }

      all[normalized] = (all[normalized] || 0) + 1;
      return all;
    }, {});

    return Object.entries(counts)
      .sort((a, b) => {
        if (b[1] !== a[1]) {
          return b[1] - a[1];
        }

        return b[0].length - a[0].length;
      })
      .slice(0, limit)
      .map(([value]) => value);
  }

  private pickMode<T extends string>(values: T[], fallback: T) {
    const counts = values.reduce<Record<string, number>>((all, value) => {
      all[value] = (all[value] || 0) + 1;
      return all;
    }, {});

    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    return (sorted[0]?.[0] as T) || fallback;
  }
}
