import { MediaTranscriptionStatus } from '@prisma/client';
import { MediaTranscriptionRepository } from '@gitroom/nestjs-libraries/database/prisma/media-transcription/media-transcription.repository';

const createRepository = () => {
  const transaction = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: 'media-1' }]),
    media: {
      update: jest.fn().mockResolvedValue({ id: 'media-1' }),
    },
    mediaTranscription: {
      findUnique: jest.fn(),
      updateMany: jest.fn(),
      create: jest.fn(),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const prisma = {
    $transaction: jest.fn(async (operation) => operation(transaction)),
    mediaTranscription: {
      updateMany: jest.fn(),
    },
  };

  return {
    repository: new MediaTranscriptionRepository(prisma as any),
    prisma,
    transaction,
  };
};

describe('MediaTranscriptionRepository recovery and deletion', () => {
  it('recovers an expired PROCESSING lease with a new generation', async () => {
    const { repository, transaction } = createRepository();
    const stale = {
      id: 'transcription-1',
      mediaId: 'media-1',
      generation: 3,
      status: MediaTranscriptionStatus.PROCESSING,
      startedAt: new Date('2020-01-01T00:00:00Z'),
      updatedAt: new Date('2020-01-01T00:00:00Z'),
    };
    const recovered = {
      ...stale,
      generation: 4,
      status: MediaTranscriptionStatus.PENDING,
      startedAt: null,
    };
    transaction.mediaTranscription.findUnique
      .mockResolvedValueOnce(stale)
      .mockResolvedValueOnce(recovered);
    transaction.mediaTranscription.updateMany.mockResolvedValue({ count: 1 });

    await expect(
      repository.ensurePendingForActiveMedia('org-1', 'media-1')
    ).resolves.toEqual(recovered);
    expect(transaction.mediaTranscription.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'transcription-1',
          generation: 3,
          status: MediaTranscriptionStatus.PROCESSING,
        },
        data: expect.objectContaining({
          generation: { increment: 1 },
          status: MediaTranscriptionStatus.PENDING,
          startedAt: null,
          completedAt: null,
        }),
      })
    );
  });

  it('marks media deleted and removes its transcript in one transaction', async () => {
    const { repository, transaction } = createRepository();
    transaction.mediaTranscription.findUnique.mockResolvedValue({
      id: 'transcription-1',
      generation: 2,
    });

    await expect(
      repository.deleteMediaLifecycle('org-1', 'media-1')
    ).resolves.toEqual({
      transcription: { id: 'transcription-1', generation: 2 },
    });
    expect(transaction.media.update).toHaveBeenCalledWith({
      where: { id: 'media-1' },
      data: { deletedAt: expect.any(Date) },
    });
    expect(transaction.mediaTranscription.deleteMany).toHaveBeenCalledWith({
      where: { mediaId: 'media-1' },
    });
    expect(
      transaction.media.update.mock.invocationCallOrder[0]
    ).toBeLessThan(
      transaction.mediaTranscription.deleteMany.mock.invocationCallOrder[0]
    );
  });

  it('cannot fail a stale generation or a transcript whose media was deleted', async () => {
    const { repository, prisma } = createRepository();
    prisma.mediaTranscription.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      repository.failIfPendingOrProcessing(
        'transcription-1',
        1,
        'TRANSCRIPTION_FAILED',
        'Safe failure'
      )
    ).resolves.toBe(false);
    expect(prisma.mediaTranscription.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'transcription-1',
          generation: 1,
          status: {
            in: [
              MediaTranscriptionStatus.PENDING,
              MediaTranscriptionStatus.PROCESSING,
            ],
          },
          media: { deletedAt: null },
        }),
      })
    );
  });
});
