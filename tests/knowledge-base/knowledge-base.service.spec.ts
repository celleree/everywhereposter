import { KnowledgeInputMethod } from '@prisma/client';
import { KnowledgeBaseService } from '@gitroom/nestjs-libraries/database/prisma/knowledge-base/knowledge-base.service';

const createRepository = (overrides: Record<string, any> = {}) => ({
  createDocument: jest.fn().mockResolvedValue({ id: 'doc-1' }),
  listDocuments: jest.fn().mockResolvedValue([
    {
      id: 'doc-1',
      title: 'Transcript import',
      sourceType: 'TRANSCRIPT',
      inputMethod: 'PASTE',
      status: 'READY',
      createdAt: new Date('2026-04-22T10:00:00.000Z'),
      updatedAt: new Date('2026-04-22T10:05:00.000Z'),
      deletedAt: null,
      errorMessage: null,
      normalizedText: 'We label every batch by hand. That keeps mistakes from shipping.',
      chunks: [
        {
          factsJson: [
            'We label every batch by hand',
            'That keeps mistakes from shipping',
          ],
        },
      ],
    },
  ]),
  getActiveVoiceProfile: jest.fn().mockResolvedValue({
    id: 'profile-1',
    version: 1,
    isActive: true,
    sentenceLength: 'mixed',
    lineBreakHabit: 'moderate',
    ctaStyle: 'invite',
    vocabularyTendencies: ['batch', 'shipping'],
    tabooPhrases: ['game changer'],
    preferredOpenings: ['One thing we keep doing'],
    approvedFactsJson: ['We label every batch by hand'],
    sourceDocumentCount: 1,
    confidence: 0.74,
    updatedAt: new Date('2026-04-22T10:05:00.000Z'),
  }),
  getVoiceProfileById: jest.fn().mockResolvedValue(undefined),
  getDocumentByIdOrThrow: jest.fn().mockResolvedValue({
    id: 'doc-1',
    rawText: `1
00:00:00,000 --> 00:00:02,000
We label every batch by hand.

2
00:00:02,500 --> 00:00:05,000
That keeps mistakes from shipping.`,
  }),
  markDocumentProcessing: jest.fn().mockResolvedValue(undefined),
  saveDocumentProcessingResult: jest.fn().mockResolvedValue(undefined),
  updateDocumentFailed: jest.fn().mockResolvedValue(undefined),
  getReadyDocumentsWithChunks: jest.fn().mockResolvedValue([
    {
      id: 'doc-1',
      chunks: [
        {
          text: 'We label every batch by hand. That keeps mistakes from shipping.',
          factsJson: [
            'We label every batch by hand',
            'That keeps mistakes from shipping',
          ],
          styleMarkersJson: {
            sentenceLength: 'mixed',
            lineBreakHabit: 'moderate',
            ctaStyle: 'invite',
            vocabularyTendencies: ['batch', 'shipping'],
            tabooPhrases: ['game changer'],
            preferredOpenings: ['One thing we keep doing'],
            confidence: 0.74,
          },
        },
      ],
    },
  ]),
  publishVoiceProfile: jest.fn().mockResolvedValue(undefined),
  clearActiveVoiceProfiles: jest.fn().mockResolvedValue(undefined),
  softDeleteDocument: jest.fn().mockResolvedValue(undefined),
  ...overrides,
});

const createModelService = (overrides: Record<string, any> = {}) => ({
  summarizeTranscript: jest.fn().mockResolvedValue({
    transcriptSummary:
      'The speaker explains why the team still hand-labels every batch.',
    facts: [
      'We label every batch by hand',
      'That keeps mistakes from shipping',
    ],
    unknowns: [],
    coreMessage: 'Manual checks still matter.',
    sourceConfidence: 0.74,
    voiceProfile: {
      sentenceLength: 'mixed',
      lineBreakHabit: 'moderate',
      ctaStyle: 'invite',
      vocabularyTendencies: ['batch', 'shipping'],
      tabooPhrases: ['game changer'],
      preferredOpenings: ['One thing we keep doing'],
      confidence: 0.74,
    },
  }),
  ...overrides,
});

describe('KnowledgeBaseService', () => {
  it('ingests a transcript, stores chunks, and publishes an active voice profile', async () => {
    const repository = createRepository();
    const modelService = createModelService();
    const service = new KnowledgeBaseService(repository as any, modelService as any);

    const summary = await service.ingestTranscript({
      orgId: 'org-1',
      userId: 'user-1',
      text: `1
00:00:00,000 --> 00:00:02,000
We label every batch by hand.

2
00:00:02,500 --> 00:00:05,000
That keeps mistakes from shipping.`,
      inputMethod: KnowledgeInputMethod.PASTE,
    });

    expect(repository.createDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-1',
        createdByUserId: 'user-1',
        inputMethod: KnowledgeInputMethod.PASTE,
      })
    );
    expect(repository.saveDocumentProcessingResult).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: 'doc-1',
        normalizedText:
          'We label every batch by hand.\n\nThat keeps mistakes from shipping.',
      })
    );
    expect(repository.publishVoiceProfile).toHaveBeenCalledWith(
      'org-1',
      expect.objectContaining({
        approvedFactsJson: [
          'That keeps mistakes from shipping',
          'We label every batch by hand',
        ],
        sourceDocumentCount: 1,
      })
    );
    expect(summary.activeVoiceProfile?.sourceDocumentCount).toBe(1);
  });

  it('clears the active profile when the last ready document is removed', async () => {
    const repository = createRepository({
      getReadyDocumentsWithChunks: jest.fn().mockResolvedValue([]),
    });
    const service = new KnowledgeBaseService(
      repository as any,
      createModelService() as any
    );

    await service.deleteDocument('org-1', 'doc-1');

    expect(repository.softDeleteDocument).toHaveBeenCalledWith('org-1', 'doc-1');
    expect(repository.clearActiveVoiceProfiles).toHaveBeenCalledWith('org-1');
    expect(repository.publishVoiceProfile).not.toHaveBeenCalled();
  });

  it('resolves stored personalization for copy generation', async () => {
    const repository = createRepository();
    const service = new KnowledgeBaseService(
      repository as any,
      createModelService() as any
    );

    const personalization = await service.resolvePersonalization('org-1');

    expect(personalization.voiceProfile).toMatchObject({
      sentenceLength: 'mixed',
      lineBreakHabit: 'moderate',
      ctaStyle: 'invite',
    });
    expect(personalization.storedFacts).toEqual([
      'We label every batch by hand',
    ]);
    expect(personalization.overlapReferenceTexts).toEqual([
      'We label every batch by hand. That keeps mistakes from shipping.',
    ]);
  });

  it('normalizes subtitle timestamps into clean transcript text', () => {
    const service = new KnowledgeBaseService(
      createRepository() as any,
      createModelService() as any
    );

    const normalized = (service as any).normalizeTranscriptText(`WEBVTT

00:00:00.000 --> 00:00:02.000
We still write labels by hand.

00:00:02.500 --> 00:00:04.000
That catches mistakes early.`);

    expect(normalized).toBe(
      'We still write labels by hand.\n\nThat catches mistakes early.'
    );
  });
});
