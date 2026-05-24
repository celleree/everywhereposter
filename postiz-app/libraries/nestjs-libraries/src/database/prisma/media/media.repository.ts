import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { Injectable } from '@nestjs/common';
import { SaveMediaInformationDto } from '@gitroom/nestjs-libraries/dtos/media/save.media.information.dto';

@Injectable()
export class MediaRepository {
  constructor(
    private _media: PrismaRepository<'media'>,
    private _post: PrismaRepository<'post'>
  ) {}

  saveFile(
    org: string,
    fileName: string,
    filePath: string,
    originalName?: string,
    mimeType?: string
  ) {
    return this._media.model.media.create({
      data: {
        organization: {
          connect: {
            id: org,
          },
        },
        name: fileName,
        path: filePath,
        originalName: originalName || null,
        type: this.getMediaType(filePath, fileName, originalName, mimeType),
      },
      select: {
        id: true,
        name: true,
        originalName: true,
        path: true,
        type: true,
        thumbnail: true,
        alt: true,
      },
    });
  }

  getMediaById(id: string) {
    return this._media.model.media.findUnique({
      where: {
        id,
      },
    });
  }

  getMediaByOrganizationIdAndId(org: string, id: string) {
    return this._media.model.media.findFirst({
      where: {
        id,
        organizationId: org,
        deletedAt: null,
      },
    });
  }

  deleteMedia(org: string, id: string) {
    return this._media.model.media.update({
      where: {
        id,
        organizationId: org,
      },
      data: {
        deletedAt: new Date(),
      },
    });
  }

  saveMediaInformation(org: string, data: SaveMediaInformationDto) {
    return this._media.model.media.update({
      where: {
        id: data.id,
        organizationId: org,
      },
      data: {
        alt: data.alt,
        thumbnail: data.thumbnail,
        thumbnailTimestamp: data.thumbnailTimestamp,
      },
      select: {
        id: true,
        name: true,
        originalName: true,
        alt: true,
        thumbnail: true,
        path: true,
        type: true,
        thumbnailTimestamp: true,
      },
    });
  }

  async getMedia(org: string, page: number) {
    const pageNum = (page || 1) - 1;
    const query = {
      where: {
        organization: {
          id: org,
        },
      },
    };
    const pages = Math.ceil((await this._media.model.media.count(query)) / 18);
    const results = await this._media.model.media.findMany({
      where: {
        organizationId: org,
        deletedAt: null,
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
        thumbnail: true,
        alt: true,
        thumbnailTimestamp: true,
      },
      skip: pageNum * 18,
      take: 18,
    });

    return {
      pages,
      results,
    };
  }

  async getPostAttachedMedia(org: string, page: number) {
    const pageNum = (page || 1) - 1;
    const posts = await this._post.model.post.findMany({
      where: {
        organizationId: org,
        deletedAt: null,
      },
      orderBy: {
        publishDate: 'desc',
      },
      select: {
        image: true,
      },
    });
    const seen = new Set<string>();
    const media = posts.flatMap((post) => {
      const images = this.parsePostImages(post.image);
      return images
        .map((image) => this.normalizePostAttachedMedia(image))
        .filter((image) => {
          if (!image || seen.has(image.path)) {
            return false;
          }

          seen.add(image.path);
          return true;
        });
    });
    const pages = Math.ceil(media.length / 18);

    return {
      pages,
      results: media.slice(pageNum * 18, pageNum * 18 + 18),
    };
  }

  private parsePostImages(image?: string | null) {
    if (!image) {
      return [];
    }

    try {
      const parsed = JSON.parse(image);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private normalizePostAttachedMedia(image: any) {
    if (!image || typeof image !== 'object' || Array.isArray(image)) {
      return;
    }

    const path = typeof image.path === 'string' ? image.path.trim() : '';
    if (!path || !this.isLocalPostAttachedPath(path)) {
      return;
    }

    const name =
      typeof image.name === 'string' && image.name
        ? image.name
        : path.split('/').pop() || 'posted-media';

    return {
      id: `post-attached-${this.createPathHash(path)}`,
      mediaId:
        typeof image.id === 'string' && image.id.trim() ? image.id : null,
      name,
      originalName:
        typeof image.originalName === 'string' ? image.originalName : null,
      path,
      thumbnail:
        typeof image.thumbnail === 'string' ? image.thumbnail : null,
      alt: typeof image.alt === 'string' ? image.alt : null,
      thumbnailTimestamp:
        typeof image.thumbnailTimestamp === 'number'
          ? image.thumbnailTimestamp
          : null,
      type: this.getMediaType(path, name, image.originalName, image.mimetype),
      postedMedia: true,
    };
  }

  private getMediaType(
    filePath: string,
    fileName?: string | null,
    originalName?: string | null,
    mimeType?: string | null
  ) {
    const normalizedMimeType = (mimeType || '')
      .split(';')[0]
      .trim()
      .toLowerCase();

    if (normalizedMimeType.startsWith('video/')) {
      return 'video';
    }

    if (normalizedMimeType.startsWith('image/')) {
      return 'image';
    }

    const fileIdentity = [filePath, fileName, originalName]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    return /\.(mp4|mov|m4v)(?:$|[?#\s])/i.test(fileIdentity)
      ? 'video'
      : 'image';
  }

  private isLocalPostAttachedPath(path: string) {
    if (/^(data:|blob:)/i.test(path)) {
      return false;
    }

    if (!/^https?:\/\//i.test(path)) {
      return true;
    }

    const localPrefixes = [
      process.env.FRONTEND_URL,
      process.env.CLOUDFLARE_BUCKET_URL,
    ].filter((prefix): prefix is string => !!prefix);

    return localPrefixes.some((prefix) => path.startsWith(prefix));
  }

  private createPathHash(path: string) {
    let hash = 0;
    for (let i = 0; i < path.length; i++) {
      hash = (hash << 5) - hash + path.charCodeAt(i);
      hash |= 0;
    }

    return Math.abs(hash).toString(36);
  }
}
