import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ReferenceImageRepository,
  ReferenceImageState,
  ReferenceImageTransaction,
  StoredReferenceImage,
} from '@gitroom/nestjs-libraries/database/prisma/reference-images/reference-image.repository';

const MAX_ACTIVE_REFERENCES = 4;

export type ReferenceImageAspectRatio = '1:1' | '4:5' | '16:9' | '9:16';

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
    return this.listFromRepository(orgId, includeArchived);
  }

  async create(orgId: string, input: CreateReferenceImageInput) {
    return this._repository.withOrganizationMutationLock(
      orgId,
      async (transaction) => {
        const media = await this._repository.getMedia(
          orgId,
          input.mediaId,
          transaction
        );
        if (!media) {
          throw new NotFoundException('Uploaded reference image was not found.');
        }
        if (media.type !== 'image') {
          throw new BadRequestException('Only image files can be saved as references.');
        }
        if (
          await this._repository.getReference(orgId, input.mediaId, transaction)
        ) {
          throw new BadRequestException(
            'This image is already in the reference library.'
          );
        }

        const brand = this.cleanOptional(input.brand, 120);
        const styleNotes = this.cleanOptional(input.styleNotes, 1000);
        const reference: ReferenceImageState = {
          mediaId: media.id,
          organizationId: orgId,
          name: this.cleanText(
            input.name || media.originalName || media.name || 'Visual reference',
            120
          ),
          tags: this.cleanTags(input.tags),
          ...(brand ? { brand } : {}),
          ...(input.aspectRatio ? { aspectRatio: input.aspectRatio } : {}),
          ...(styleNotes ? { styleNotes } : {}),
          isActive: Boolean(input.isActive || input.isPrimary),
          isPrimary: Boolean(input.isPrimary),
          usageCount: 0,
          lastPlatforms: [],
        };

        if (reference.isActive) {
          await this.assertActiveLimit(orgId, transaction);
        }
        if (reference.isPrimary) {
          await this.clearPrimary(orgId, undefined, transaction);
        }

        const saved = await this._repository.createReference(
          reference,
          transaction
        );
        if (!saved) {
          throw new NotFoundException('Reference image could not be saved.');
        }
        return this.toResponse(saved);
      }
    );
  }

  async update(orgId: string, id: string, input: UpdateReferenceImageInput) {
    return this._repository.withOrganizationMutationLock(
      orgId,
      async (transaction) => {
        const current = await this._repository.getReference(
          orgId,
          id,
          transaction
        );
        if (!current) {
          throw new NotFoundException('Reference image was not found.');
        }

        const next: ReferenceImageState = {
          mediaId: current.mediaId,
          organizationId: current.organizationId,
          name:
            typeof input.name === 'string'
              ? this.cleanText(input.name, 120)
              : current.name,
          tags: Array.isArray(input.tags)
            ? this.cleanTags(input.tags)
            : current.tags,
          brand:
            typeof input.brand === 'string'
              ? this.cleanOptional(input.brand, 120)
              : current.brand,
          aspectRatio: input.aspectRatio || current.aspectRatio,
          styleNotes:
            typeof input.styleNotes === 'string'
              ? this.cleanOptional(input.styleNotes, 1000)
              : current.styleNotes,
          isActive:
            typeof input.isActive === 'boolean'
              ? input.isActive
              : current.isActive,
          isPrimary:
            typeof input.isPrimary === 'boolean'
              ? input.isPrimary
              : current.isPrimary,
          archivedAt: current.archivedAt,
          usageCount: current.usageCount,
          lastUsedAt: current.lastUsedAt,
          lastPlatforms: current.lastPlatforms,
        };

        if (next.isPrimary) {
          next.isActive = true;
          await this.clearPrimary(orgId, id, transaction);
        }
        if (!next.isActive) {
          next.isPrimary = false;
        }
        if (!current.isActive && next.isActive) {
          await this.assertActiveLimit(orgId, transaction);
        }

        const saved = await this._repository.updateReference(next, transaction);
        if (!saved) {
          throw new NotFoundException('Reference image was not found.');
        }
        return this.toResponse(saved);
      }
    );
  }

  async archive(orgId: string, id: string) {
    return this._repository.withOrganizationMutationLock(
      orgId,
      async (transaction) => {
        const current = await this._repository.getReference(
          orgId,
          id,
          transaction
        );
        if (!current) {
          throw new NotFoundException('Reference image was not found.');
        }

        const saved = await this._repository.updateReference(
          {
            ...this.toState(current),
            isActive: false,
            isPrimary: false,
            archivedAt: new Date(),
          },
          transaction
        );
        if (!saved) {
          throw new NotFoundException('Reference image was not found.');
        }
        return this.toResponse(saved);
      }
    );
  }

  async restore(orgId: string, id: string) {
    return this._repository.withOrganizationMutationLock(
      orgId,
      async (transaction) => {
        const current = await this._repository.getReference(
          orgId,
          id,
          transaction
        );
        if (!current) {
          throw new NotFoundException('Reference image was not found.');
        }

        const state = this.toState(current);
        delete state.archivedAt;
        const saved = await this._repository.updateReference(state, transaction);
        if (!saved) {
          throw new NotFoundException('Reference image was not found.');
        }
        return this.toResponse(saved);
      }
    );
  }

  async getActiveForSourceMedia(
    mediaId: string
  ): Promise<ReferenceImageContext[]> {
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

  async markUsedForSourceMedia(
    mediaId: string,
    references: ReferenceImageContext[],
    platforms: string[]
  ) {
    const source = await this._repository.getMediaWithOrganization(mediaId);
    if (!source) return;
    await this.markUsed(source.organizationId, references, platforms);
  }

  async markUsed(
    orgId: string,
    references: ReferenceImageContext[],
    platforms: string[]
  ) {
    await this._repository.withOrganizationMutationLock(
      orgId,
      async (transaction) => {
        const uniquePlatforms = Array.from(new Set(platforms));
        for (const reference of references) {
          await this._repository.incrementUsage(
            orgId,
            reference.id,
            uniquePlatforms,
            transaction
          );
        }
      }
    );
  }

  private async listFromRepository(
    orgId: string,
    includeArchived = false,
    transaction?: ReferenceImageTransaction
  ) {
    const references = await this._repository.list(orgId, transaction);
    return references
      .filter((item) => includeArchived || !item.archivedAt)
      .map((item) => this.toResponse(item));
  }

  private async assertActiveLimit(
    orgId: string,
    transaction: ReferenceImageTransaction
  ) {
    const activeCount = await this._repository.countActive(orgId, transaction);
    if (activeCount >= MAX_ACTIVE_REFERENCES) {
      throw new BadRequestException(
        `You can activate up to ${MAX_ACTIVE_REFERENCES} reference images at once.`
      );
    }
  }

  private clearPrimary(
    orgId: string,
    exceptId: string | undefined,
    transaction: ReferenceImageTransaction
  ) {
    return this._repository.clearPrimary(orgId, exceptId, transaction);
  }

  private toState(reference: StoredReferenceImage): ReferenceImageState {
    return {
      mediaId: reference.mediaId,
      organizationId: reference.organizationId,
      name: reference.name,
      tags: reference.tags,
      brand: reference.brand,
      aspectRatio: reference.aspectRatio,
      styleNotes: reference.styleNotes,
      isActive: reference.isActive,
      isPrimary: reference.isPrimary,
      archivedAt: reference.archivedAt,
      usageCount: reference.usageCount,
      lastUsedAt: reference.lastUsedAt,
      lastPlatforms: reference.lastPlatforms,
    };
  }

  private toResponse(reference: StoredReferenceImage) {
    return {
      id: reference.mediaId,
      mediaId: reference.mediaId,
      path: reference.path,
      originalName: reference.originalName || null,
      alt: reference.alt || null,
      createdAt: reference.createdAt,
      updatedAt: reference.updatedAt,
      name: reference.name,
      tags: reference.tags,
      ...(reference.brand ? { brand: reference.brand } : {}),
      ...(reference.aspectRatio
        ? { aspectRatio: reference.aspectRatio as ReferenceImageAspectRatio }
        : {}),
      ...(reference.styleNotes ? { styleNotes: reference.styleNotes } : {}),
      isActive: reference.isActive,
      isPrimary: reference.isPrimary,
      ...(reference.archivedAt
        ? { archivedAt: reference.archivedAt.toISOString() }
        : {}),
      usageCount: reference.usageCount,
      ...(reference.lastUsedAt
        ? { lastUsedAt: reference.lastUsedAt.toISOString() }
        : {}),
      lastPlatforms: reference.lastPlatforms,
    };
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
