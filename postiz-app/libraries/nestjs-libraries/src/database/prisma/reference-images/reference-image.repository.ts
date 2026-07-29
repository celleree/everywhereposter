import { Injectable } from '@nestjs/common';
import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';

export const REFERENCE_IMAGE_METADATA_PREFIX =
  '__everywhereposter_reference_image_v1__:';

@Injectable()
export class ReferenceImageRepository {
  constructor(private readonly _media: PrismaRepository<'media'>) {}

  getMedia(orgId: string, mediaId: string) {
    return this._media.model.media.findFirst({
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

  getMediaWithOrganization(mediaId: string) {
    return this._media.model.media.findFirst({
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

  list(orgId: string) {
    return this._media.model.media.findMany({
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

  updateMetadata(orgId: string, mediaId: string, alt: string) {
    return this._media.model.media.update({
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
}
