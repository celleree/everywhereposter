import { Prisma } from '@prisma/client';
import { Injectable } from '@nestjs/common';
import {
  PrismaRepository,
  PrismaService,
} from '@gitroom/nestjs-libraries/database/prisma/prisma.service';

export const REFERENCE_IMAGE_METADATA_PREFIX =
  '__everywhereposter_reference_image_v1__:';

export type ReferenceImageTransaction = Prisma.TransactionClient;

@Injectable()
export class ReferenceImageRepository {
  constructor(
    private readonly _media: PrismaRepository<'media'>,
    private readonly _prismaService: PrismaService
  ) {}

  withOrganizationMutationLock<T>(
    orgId: string,
    callback: (transaction: ReferenceImageTransaction) => Promise<T>
  ) {
    return this._prismaService.$transaction(async (transaction) => {
      await transaction.$queryRaw`
        SELECT pg_advisory_xact_lock(
          hashtext('everywhereposter-reference-images'),
          hashtext(${orgId})
        )
      `;

      return callback(transaction);
    });
  }

  getMedia(
    orgId: string,
    mediaId: string,
    transaction?: ReferenceImageTransaction
  ) {
    return this.getMediaModel(transaction).findFirst({
      where: {
        id: mediaId,
        organizationId: orgId,
        deletedAt: null,
      },
      select: {
        id: true,
        name: true,
        originalName: true,
        path: true,
        type: true,
        alt: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  getMediaWithOrganization(
    mediaId: string,
    transaction?: ReferenceImageTransaction
  ) {
    return this.getMediaModel(transaction).findFirst({
      where: {
        id: mediaId,
        deletedAt: null,
      },
      select: {
        id: true,
        organizationId: true,
      },
    });
  }

  list(orgId: string, transaction?: ReferenceImageTransaction) {
    return this.getMediaModel(transaction).findMany({
      where: {
        organizationId: orgId,
        deletedAt: null,
        type: 'image',
        alt: {
          startsWith: REFERENCE_IMAGE_METADATA_PREFIX,
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      select: {
        id: true,
        name: true,
        originalName: true,
        path: true,
        type: true,
        alt: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  updateMetadata(
    orgId: string,
    mediaId: string,
    alt: string,
    transaction?: ReferenceImageTransaction
  ) {
    return this.getMediaModel(transaction).update({
      where: {
        id: mediaId,
        organizationId: orgId,
      },
      data: {
        alt,
      },
      select: {
        id: true,
        name: true,
        originalName: true,
        path: true,
        type: true,
        alt: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  private getMediaModel(transaction?: ReferenceImageTransaction) {
    return (transaction?.media ||
      this._media.model.media) as ReferenceImageTransaction['media'];
  }
}
