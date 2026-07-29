import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  REFERENCE_IMAGE_METADATA_PREFIX,
  ReferenceImageRepository,
} from '@gitroom/nestjs-libraries/database/prisma/reference-images/reference-image.repository';

const MAX_ACTIVE_REFERENCES = 4;

export type ReferenceImageAspectRatio = '1:1' | '4:5' | '16:9' | '9:16';

export interface ReferenceImageMetadata {
  version: 1;
  kind: 'reference-image';
  name: string;
  tags: string[];
  brand?: string;
  aspectRatio?: ReferenceImageAspectRatio;
  styleNotes?: string;
  isActive: boolean;
  isPrimary: boolean;
  archivedAt?: string;
  usageCount: number;
  lastUsedAt?: string;
  lastPlatforms?: string[];
}

export interface ReferenceImageContext {
  id: string;
  name: string;
  path: string;
  tags: string[];
  brand?: string;
  aspectRatio?: ReferenceImageAspectRatio;
  styleNotes?: string;
  isPrimary: boolean;
}

export interface CreateReferenceImageInput {
  mediaId: string;
  name?: string;
  tags?: string[];
  brand?: string;
  aspectRatio?: ReferenceImageAspectRatio;
  styleNotes?: string;
  isActive?: boolean;
  isPrimary?: boolean;
}

export type UpdateReferenceImageInput = Partial<
  Omit<CreateReferenceImageInput, 'mediaId'>
>;

@Injectable()
export class ReferenceImageService {
  constructor(private readonly _repository: ReferenceImageRepository) {}

  async list(orgId: string, includeArchived = false) {
    const media = await this._repository.list(orgId);
    return media
      .map((item) => this.toResponse(item))
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
      .filter((item) => includeArchived || !item.archivedAt);
  }

  async create(orgId: string, input: CreateReferenceImageInput) {
    const media = await this._repository.getMedia(orgId, input.mediaId);
    if (!media) {
      throw new NotFoundException('Uploaded reference image was not found.');
    }
    if (media.type !== 'image') {
      throw new BadRequestException('Only image files can be saved as references.');
    }
    if (this.parseMetadata(media.alt)) {
      throw new BadRequestException('This image is already in the reference library.');
    }

    const metadata: ReferenceImageMetadata = {
      version: 1,
      kind: 'reference-image',
      name: this.cleanText(
        input.name || media.originalName || media.name || 'Visual reference',
        120
      ),
      tags: this.cleanTags(input.tags),
      ...(this.cleanOptional(input.brand, 120)
        ? { brand: this.cleanOptional(input.brand, 120) }
        : {}),
      ...(input.aspectRatio ? { aspectRatio: input.aspectRatio } : {}),
      ...(this.cleanOptional(input.styleNotes, 1000)
        ? { styleNotes: this.cleanOptional(input.styleNotes, 1000) }
        : {}),
      isActive: Boolean(input.isActive || input.isPrimary),
      isPrimary: Boolean(input.isPrimary),
      usageCount: 0,
    };

    if (metadata.isActive) {
      await this.assertActiveLimit(orgId);
    }
    if (metadata.isPrimary) {
      await this.clearPrimary(orgId);
    }

    const saved = await this._repository.updateMetadata(
      orgId,
      media.id,
      this.serializeMetadata(metadata)
    );
    return this.toResponse(saved);
  }

  async update(orgId: string, id: string, input: UpdateReferenceImageInput) {
    const media = await this._repository.getMedia(orgId, id);
    const current = media ? this.parseMetadata(media.alt) : undefined;
    if (!media || !current) {
      throw new NotFoundException('Reference image was not found.');
    }

    const next: ReferenceImageMetadata = {
      ...current,
      ...(typeof input.name === 'string'
        ? { name: this.cleanText(input.name, 120) }
        : {}),
      ...(Array.isArray(input.tags) ? { tags: this.cleanTags(input.tags) } : {}),
      ...(typeof input.brand === 'string'
        ? { brand: this.cleanOptional(input.brand, 120) }
        : {}),
      ...(input.aspectRatio ? { aspectRatio: input.aspectRatio } : {}),
      ...(typeof input.styleNotes === 'string'
        ? { styleNotes: this.cleanOptional(input.styleNotes, 1000) }
        : {}),
      ...(typeof input.isActive === 'boolean'
        ? { isActive: input.isActive }
        : {}),
      ...(typeof input.isPrimary === 'boolean'
        ? { isPrimary: input.isPrimary }
        : {}),
    };

    if (next.isPrimary) {
      next.isActive = true;
      await this.clearPrimary(orgId, id);
    }
    if (!next.isActive) {
      next.isPrimary = false;
    }
    if (!current.isActive && next.isActive) {
      await this.assertActiveLimit(orgId);
    }

    const saved = await this._repository.updateMetadata(
      orgId,
      id,
      this.serializeMetadata(next)
    );
    return this.toResponse(saved);
  }

  async archive(orgId: string, id: string) {
    const media = await this._repository.getMedia(orgId, id);
    const current = media ? this.parseMetadata(media.alt) : undefined;
    if (!media || !current) {
      throw new NotFoundException('Reference image was not found.');
    }

    const saved = await this._repository.updateMetadata(
      orgId,
      id,
      this.serializeMetadata({
        ...current,
        isActive: false,
        isPrimary: false,
        archivedAt: new Date().toISOString(),
      })
    );
    return this.toResponse(saved);
  }

  async restore(orgId: string, id: string) {
    const media = await this._repository.getMedia(orgId, id);
    const current = media ? this.parseMetadata(media.alt) : undefined;
    if (!media || !current) {
      throw new NotFoundException('Reference image was not found.');
    }

    const { archivedAt: _archivedAt, ...rest } = current;
    const saved = await this._repository.updateMetadata(
      orgId,
      id,
      this.serializeMetadata(rest)
    );
    return this.toResponse(saved);
  }

  async getActiveForSourceMedia(mediaId: string): Promise<ReferenceImageContext[]> {
    const source = await this._repository.getMediaWithOrganization(mediaId);
    if (!source) return [];

    const references = await this.list(source.organizationId);
    return references
      .filter((item) => item.isActive && !item.archivedAt)
      .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary))
      .slice(0, MAX_ACTIVE_REFERENCES)
      .map((item) => ({
        id: item.id,
        name: item.name,
        path: item.path,
        tags: item.tags,
        ...(item.brand ? { brand: item.brand } : {}),
        ...(item.aspectRatio ? { aspectRatio: item.aspectRatio } : {}),
        ...(item.styleNotes ? { styleNotes: item.styleNotes } : {}),
        isPrimary: item.isPrimary,
      }));
  }

  async markUsed(
    orgId: string,
    references: ReferenceImageContext[],
    platforms: string[]
  ) {
    await Promise.all(
      references.map(async (reference) => {
        const media = await this._repository.getMedia(orgId, reference.id);
        const metadata = media ? this.parseMetadata(media.alt) : undefined;
        if (!media || !metadata) return;

        await this._repository.updateMetadata(
          orgId,
          reference.id,
          this.serializeMetadata({
            ...metadata,
            usageCount: metadata.usageCount + 1,
            lastUsedAt: new Date().toISOString(),
            lastPlatforms: Array.from(new Set(platforms)),
          })
        );
      })
    );
  }

  private async assertActiveLimit(orgId: string) {
    const active = (await this.list(orgId)).filter((item) => item.isActive);
    if (active.length >= MAX_ACTIVE_REFERENCES) {
      throw new BadRequestException(
        `You can activate up to ${MAX_ACTIVE_REFERENCES} reference images at once.`
      );
    }
  }

  private async clearPrimary(orgId: string, exceptId?: string) {
    const references = await this.list(orgId, true);
    await Promise.all(
      references
        .filter((item) => item.isPrimary && item.id !== exceptId)
        .map(async (item) => {
          const media = await this._repository.getMedia(orgId, item.id);
          const metadata = media ? this.parseMetadata(media.alt) : undefined;
          if (!metadata) return;
          await this._repository.updateMetadata(
            orgId,
            item.id,
            this.serializeMetadata({ ...metadata, isPrimary: false })
          );
        })
    );
  }

  private toResponse(media: {
    id: string;
    name: string;
    originalName: string | null;
    path: string;
    alt: string | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    const metadata = this.parseMetadata(media.alt);
    if (!metadata) return;
    return {
      id: media.id,
      mediaId: media.id,
      path: media.path,
      originalName: media.originalName,
      createdAt: media.createdAt,
      updatedAt: media.updatedAt,
      ...metadata,
    };
  }

  private parseMetadata(value?: string | null): ReferenceImageMetadata | undefined {
    if (!value?.startsWith(REFERENCE_IMAGE_METADATA_PREFIX)) return;
    try {
      const parsed = JSON.parse(
        value.slice(REFERENCE_IMAGE_METADATA_PREFIX.length)
      ) as ReferenceImageMetadata;
      if (parsed?.version !== 1 || parsed?.kind !== 'reference-image') return;
      return {
        ...parsed,
        tags: Array.isArray(parsed.tags) ? parsed.tags : [],
        isActive: Boolean(parsed.isActive),
        isPrimary: Boolean(parsed.isPrimary),
        usageCount: Number.isFinite(parsed.usageCount) ? parsed.usageCount : 0,
      };
    } catch {
      return;
    }
  }

  private serializeMetadata(metadata: ReferenceImageMetadata) {
    return `${REFERENCE_IMAGE_METADATA_PREFIX}${JSON.stringify(metadata)}`;
  }

  private cleanTags(tags?: string[]) {
    return Array.from(
      new Set(
        (tags || [])
          .map((tag) => this.cleanText(tag, 40))
          .filter(Boolean)
      )
    ).slice(0, 12);
  }

  private cleanText(value: string, maxLength: number) {
    return value.trim().replace(/\s+/g, ' ').slice(0, maxLength);
  }

  private cleanOptional(value: string | undefined, maxLength: number) {
    const cleaned = this.cleanText(value || '', maxLength);
    return cleaned || undefined;
  }
}
