import { Injectable } from '@nestjs/common';
import { MediaTranscriptionStatus, Prisma } from '@prisma/client';
import { PrismaService } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';

export const TRANSCRIPTION_PROCESSING_LEASE_MS = 2 * 60 * 60 * 1000;

@Injectable()
export class MediaTranscriptionRepository {
  constructor(private readonly _prisma: PrismaService) {}

  private async lockActiveMedia(
    transaction: Prisma.TransactionClient,
    organizationId: string,
    mediaId: string
  ) {
    const rows = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id"
      FROM "Media"
      WHERE "id" = ${mediaId}
        AND "organizationId" = ${organizationId}
        AND "deletedAt" IS NULL
      FOR UPDATE
    `);

    return rows.length > 0;
  }

  async ensurePendingForActiveMedia(organizationId: string, mediaId: string) {
    return this._prisma.$transaction(async (transaction) => {
      if (!(await this.lockActiveMedia(transaction, organizationId, mediaId))) {
        return null;
      }

      const existing = await transaction.mediaTranscription.findUnique({
        where: { mediaId },
      });

      if (existing) {
        const processingSince = existing.startedAt || existing.updatedAt;
        if (
          existing.status === MediaTranscriptionStatus.PROCESSING &&
          processingSince.getTime() <=
            Date.now() - TRANSCRIPTION_PROCESSING_LEASE_MS
        ) {
          const recovered = await transaction.mediaTranscription.updateMany({
            where: {
              id: existing.id,
              generation: existing.generation,
              status: MediaTranscriptionStatus.PROCESSING,
            },
            data: {
              generation: { increment: 1 },
              status: MediaTranscriptionStatus.PENDING,
              text: null,
              errorCode: null,
              errorMessage: null,
              requestedAt: new Date(),
              startedAt: null,
              completedAt: null,
            },
          });

          if (recovered.count === 1) {
            return transaction.mediaTranscription.findUnique({
              where: { id: existing.id },
            });
          }

          return transaction.mediaTranscription.findUnique({
            where: { id: existing.id },
          });
        }

        return existing;
      }

      return transaction.mediaTranscription.create({
        data: {
          mediaId,
          generation: 1,
          status: MediaTranscriptionStatus.PENDING,
        },
      });
    });
  }

  async retryFailedForActiveMedia(organizationId: string, mediaId: string) {
    return this._prisma.$transaction(async (transaction) => {
      if (!(await this.lockActiveMedia(transaction, organizationId, mediaId))) {
        return null;
      }

      const current = await transaction.mediaTranscription.findUnique({
        where: { mediaId },
      });

      if (!current) {
        return transaction.mediaTranscription.create({
          data: {
            mediaId,
            generation: 1,
            status: MediaTranscriptionStatus.PENDING,
          },
        });
      }

      if (current.status !== MediaTranscriptionStatus.FAILED) {
        return current;
      }

      return transaction.mediaTranscription.update({
        where: { id: current.id },
        data: {
          generation: { increment: 1 },
          status: MediaTranscriptionStatus.PENDING,
          text: null,
          errorCode: null,
          errorMessage: null,
          requestedAt: new Date(),
          startedAt: null,
          completedAt: null,
        },
      });
    });
  }

  async claimForProcessing(transcriptionId: string, generation: number) {
    const result = await this._prisma.mediaTranscription.updateMany({
      where: {
        id: transcriptionId,
        generation,
        status: MediaTranscriptionStatus.PENDING,
        media: { deletedAt: null },
      },
      data: {
        status: MediaTranscriptionStatus.PROCESSING,
        startedAt: new Date(),
        completedAt: null,
        errorCode: null,
        errorMessage: null,
      },
    });

    return result.count === 1;
  }

  getActiveWorkerInput(transcriptionId: string, generation: number) {
    return this._prisma.mediaTranscription.findFirst({
      where: {
        id: transcriptionId,
        generation,
        status: MediaTranscriptionStatus.PROCESSING,
        media: { deletedAt: null },
      },
      include: { media: true },
    });
  }

  async completeIfActive(
    transcriptionId: string,
    generation: number,
    text: string | null
  ) {
    const result = await this._prisma.mediaTranscription.updateMany({
      where: {
        id: transcriptionId,
        generation,
        status: MediaTranscriptionStatus.PROCESSING,
        media: { deletedAt: null },
      },
      data: {
        status: MediaTranscriptionStatus.READY,
        text,
        errorCode: null,
        errorMessage: null,
        completedAt: new Date(),
      },
    });

    return result.count === 1;
  }

  async failIfActive(
    transcriptionId: string,
    generation: number,
    errorCode: string,
    errorMessage: string
  ) {
    const result = await this._prisma.mediaTranscription.updateMany({
      where: {
        id: transcriptionId,
        generation,
        status: MediaTranscriptionStatus.PROCESSING,
        media: { deletedAt: null },
      },
      data: {
        status: MediaTranscriptionStatus.FAILED,
        text: null,
        errorCode,
        errorMessage,
        completedAt: new Date(),
      },
    });

    return result.count === 1;
  }

  async failIfPendingOrProcessing(
    transcriptionId: string,
    generation: number,
    errorCode: string,
    errorMessage: string
  ) {
    const result = await this._prisma.mediaTranscription.updateMany({
      where: {
        id: transcriptionId,
        generation,
        status: {
          in: [
            MediaTranscriptionStatus.PENDING,
            MediaTranscriptionStatus.PROCESSING,
          ],
        },
        media: { deletedAt: null },
      },
      data: {
        status: MediaTranscriptionStatus.FAILED,
        text: null,
        errorCode,
        errorMessage,
        completedAt: new Date(),
      },
    });

    return result.count === 1;
  }

  async deleteMediaLifecycle(organizationId: string, mediaId: string) {
    return this._prisma.$transaction(async (transaction) => {
      if (!(await this.lockActiveMedia(transaction, organizationId, mediaId))) {
        return null;
      }

      const transcription = await transaction.mediaTranscription.findUnique({
        where: { mediaId },
        select: { id: true, generation: true },
      });

      await transaction.media.update({
        where: { id: mediaId },
        data: { deletedAt: new Date() },
      });
      await transaction.mediaTranscription.deleteMany({ where: { mediaId } });

      return { transcription };
    });
  }
}
