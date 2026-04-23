import {
  KnowledgeDocumentStatus,
  KnowledgeInputMethod,
  KnowledgeSourceType,
} from '@prisma/client';
import { Injectable, NotFoundException } from '@nestjs/common';
import {
  PrismaRepository as PrismaRepositoryWrapper,
  PrismaService,
} from '@gitroom/nestjs-libraries/database/prisma/prisma.service';

type StoredChunk = {
  chunkIndex: number;
  text: string;
  factsJson: string[];
  styleMarkersJson: Record<string, any>;
  charCount: number;
};

type StoredVoiceProfilePayload = {
  sentenceLength: string;
  lineBreakHabit: string;
  ctaStyle: string;
  vocabularyTendencies: string[];
  tabooPhrases: string[];
  preferredOpenings: string[];
  approvedFactsJson: string[];
  sourceDocumentCount: number;
  confidence: number;
};

@Injectable()
export class KnowledgeBaseRepository {
  constructor(
    private readonly _prismaService: PrismaService,
    private readonly _knowledgeDocument: PrismaRepositoryWrapper<'knowledgeDocument'>,
    private readonly _voiceProfile: PrismaRepositoryWrapper<'voiceProfile'>
  ) {}

  createDocument(params: {
    organizationId: string;
    createdByUserId: string;
    title: string;
    rawText: string;
    inputMethod: KnowledgeInputMethod;
  }) {
    return this._knowledgeDocument.model.knowledgeDocument.create({
      data: {
        organizationId: params.organizationId,
        createdByUserId: params.createdByUserId,
        title: params.title,
        rawText: params.rawText,
        inputMethod: params.inputMethod,
        sourceType: KnowledgeSourceType.TRANSCRIPT,
        status: KnowledgeDocumentStatus.PENDING,
      },
    });
  }

  listDocuments(orgId: string) {
    return this._knowledgeDocument.model.knowledgeDocument.findMany({
      where: {
        organizationId: orgId,
        deletedAt: null,
      },
      include: {
        chunks: {
          select: {
            factsJson: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  getDocumentById(orgId: string, documentId: string) {
    return this._knowledgeDocument.model.knowledgeDocument.findFirst({
      where: {
        id: documentId,
        organizationId: orgId,
        deletedAt: null,
      },
      include: {
        chunks: {
          orderBy: {
            chunkIndex: 'asc',
          },
        },
      },
    });
  }

  async getDocumentByIdOrThrow(orgId: string, documentId: string) {
    const document = await this.getDocumentById(orgId, documentId);
    if (!document) {
      throw new NotFoundException('Knowledge-base document not found');
    }

    return document;
  }

  async markDocumentProcessing(orgId: string, documentId: string) {
    await this.getDocumentByIdOrThrow(orgId, documentId);
    return this._knowledgeDocument.model.knowledgeDocument.update({
      where: {
        id: documentId,
      },
      data: {
        status: KnowledgeDocumentStatus.PROCESSING,
        errorMessage: null,
      },
    });
  }

  updateDocumentFailed(documentId: string, errorMessage: string) {
    return this._knowledgeDocument.model.knowledgeDocument.update({
      where: {
        id: documentId,
      },
      data: {
        status: KnowledgeDocumentStatus.FAILED,
        errorMessage: errorMessage.slice(0, 1000),
      },
    });
  }

  async saveDocumentProcessingResult(params: {
    documentId: string;
    normalizedText: string;
    chunks: StoredChunk[];
  }) {
    return this._prismaService.$transaction(async (tx) => {
      await tx.knowledgeChunk.deleteMany({
        where: {
          documentId: params.documentId,
        },
      });

      if (params.chunks.length) {
        await tx.knowledgeChunk.createMany({
          data: params.chunks.map((chunk) => ({
            documentId: params.documentId,
            chunkIndex: chunk.chunkIndex,
            text: chunk.text,
            factsJson: chunk.factsJson,
            styleMarkersJson: chunk.styleMarkersJson,
            charCount: chunk.charCount,
          })),
        });
      }

      return tx.knowledgeDocument.update({
        where: {
          id: params.documentId,
        },
        data: {
          normalizedText: params.normalizedText,
          status: KnowledgeDocumentStatus.READY,
          errorMessage: null,
        },
      });
    });
  }

  getReadyDocumentsWithChunks(orgId: string) {
    return this._knowledgeDocument.model.knowledgeDocument.findMany({
      where: {
        organizationId: orgId,
        deletedAt: null,
        status: KnowledgeDocumentStatus.READY,
      },
      include: {
        chunks: {
          orderBy: {
            chunkIndex: 'asc',
          },
        },
      },
      orderBy: {
        createdAt: 'asc',
      },
    });
  }

  async softDeleteDocument(orgId: string, documentId: string) {
    await this.getDocumentByIdOrThrow(orgId, documentId);
    return this._knowledgeDocument.model.knowledgeDocument.update({
      where: {
        id: documentId,
      },
      data: {
        deletedAt: new Date(),
      },
    });
  }

  getActiveVoiceProfile(orgId: string) {
    return this._voiceProfile.model.voiceProfile.findFirst({
      where: {
        organizationId: orgId,
        isActive: true,
      },
      orderBy: {
        version: 'desc',
      },
    });
  }

  getVoiceProfileById(orgId: string, profileId: string) {
    return this._voiceProfile.model.voiceProfile.findFirst({
      where: {
        id: profileId,
        organizationId: orgId,
      },
    });
  }

  async publishVoiceProfile(orgId: string, payload: StoredVoiceProfilePayload) {
    return this._prismaService.$transaction(async (tx) => {
      const latestProfile = await tx.voiceProfile.findFirst({
        where: {
          organizationId: orgId,
        },
        orderBy: {
          version: 'desc',
        },
      });

      await tx.voiceProfile.updateMany({
        where: {
          organizationId: orgId,
          isActive: true,
        },
        data: {
          isActive: false,
        },
      });

      return tx.voiceProfile.create({
        data: {
          organizationId: orgId,
          version: (latestProfile?.version || 0) + 1,
          isActive: true,
          sentenceLength: payload.sentenceLength,
          lineBreakHabit: payload.lineBreakHabit,
          ctaStyle: payload.ctaStyle,
          vocabularyTendencies: payload.vocabularyTendencies,
          tabooPhrases: payload.tabooPhrases,
          preferredOpenings: payload.preferredOpenings,
          approvedFactsJson: payload.approvedFactsJson,
          sourceDocumentCount: payload.sourceDocumentCount,
          confidence: payload.confidence,
        },
      });
    });
  }

  clearActiveVoiceProfiles(orgId: string) {
    return this._voiceProfile.model.voiceProfile.updateMany({
      where: {
        organizationId: orgId,
        isActive: true,
      },
      data: {
        isActive: false,
      },
    });
  }
}
