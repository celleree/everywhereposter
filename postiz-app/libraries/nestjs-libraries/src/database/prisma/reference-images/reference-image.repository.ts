import { Prisma } from '@prisma/client';
import { Injectable } from '@nestjs/common';
import {
  PrismaRepository,
  PrismaService,
} from '@gitroom/nestjs-libraries/database/prisma/prisma.service';

export type ReferenceImageTransaction = Prisma.TransactionClient;

export interface StoredReferenceImage {
  mediaId: string;
  organizationId: string;
  name: string;
  tags: string[];
  brand?: string;
  aspectRatio?: string;
  styleNotes?: string;
  isActive: boolean;
  isPrimary: boolean;
  archivedAt?: Date;
  usageCount: number;
  lastUsedAt?: Date;
  lastPlatforms: string[];
  createdAt: Date;
  updatedAt: Date;
  mediaName: string;
  originalName?: string;
  path: string;
  mediaType: string;
  alt?: string;
}

export interface ReferenceImageState {
  mediaId: string;
  organizationId: string;
  name: string;
  tags: string[];
  brand?: string;
  aspectRatio?: string;
  styleNotes?: string;
  isActive: boolean;
  isPrimary: boolean;
  archivedAt?: Date;
  usageCount: number;
  lastUsedAt?: Date;
  lastPlatforms: string[];
}

type ReferenceImageRow = Omit<
  StoredReferenceImage,
  'tags' | 'lastPlatforms' | 'brand' | 'aspectRatio' | 'styleNotes' | 'archivedAt' | 'lastUsedAt' | 'originalName' | 'alt'
> & {
  tags: unknown;
  lastPlatforms: unknown;
  brand: string | null;
  aspectRatio: string | null;
  styleNotes: string | null;
  archivedAt: Date | null;
  lastUsedAt: Date | null;
  originalName: string | null;
  alt: string | null;
};

@Injectable()
export class ReferenceImageRepository {
  private tableReady?: Promise<void>;

  constructor(
    private readonly _media: PrismaRepository<'media'>,
    private readonly _prismaService: PrismaService
  ) {}

  async withOrganizationMutationLock<T>(
    orgId: string,
    callback: (transaction: ReferenceImageTransaction) => Promise<T>
  ) {
    await this.ensureTable();
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

  async getReference(
    orgId: string,
    mediaId: string,
    transaction?: ReferenceImageTransaction
  ) {
    if (!transaction) await this.ensureTable();
    const client = transaction || this._prismaService;
    const rows = await client.$queryRaw<ReferenceImageRow[]>(Prisma.sql`
      SELECT
        reference."mediaId",
        reference."organizationId",
        reference."name",
        reference."tags",
        reference."brand",
        reference."aspectRatio",
        reference."styleNotes",
        reference."isActive",
        reference."isPrimary",
        reference."archivedAt",
        reference."usageCount",
        reference."lastUsedAt",
        reference."lastPlatforms",
        reference."createdAt",
        reference."updatedAt",
        media."name" AS "mediaName",
        media."originalName",
        media."path",
        media."type" AS "mediaType",
        media."alt"
      FROM "ReferenceImage" reference
      INNER JOIN "Media" media ON media."id" = reference."mediaId"
      WHERE reference."organizationId" = ${orgId}
        AND reference."mediaId" = ${mediaId}
        AND media."deletedAt" IS NULL
      LIMIT 1
    `);
    return rows[0] ? this.normalizeRow(rows[0]) : undefined;
  }

  async list(orgId: string, transaction?: ReferenceImageTransaction) {
    if (!transaction) await this.ensureTable();
    const client = transaction || this._prismaService;
    const rows = await client.$queryRaw<ReferenceImageRow[]>(Prisma.sql`
      SELECT
        reference."mediaId",
        reference."organizationId",
        reference."name",
        reference."tags",
        reference."brand",
        reference."aspectRatio",
        reference."styleNotes",
        reference."isActive",
        reference."isPrimary",
        reference."archivedAt",
        reference."usageCount",
        reference."lastUsedAt",
        reference."lastPlatforms",
        reference."createdAt",
        reference."updatedAt",
        media."name" AS "mediaName",
        media."originalName",
        media."path",
        media."type" AS "mediaType",
        media."alt"
      FROM "ReferenceImage" reference
      INNER JOIN "Media" media ON media."id" = reference."mediaId"
      WHERE reference."organizationId" = ${orgId}
        AND media."deletedAt" IS NULL
      ORDER BY reference."createdAt" DESC
    `);
    return rows.map((row) => this.normalizeRow(row));
  }

  async countActive(
    orgId: string,
    transaction: ReferenceImageTransaction
  ) {
    const rows = await transaction.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
      SELECT COUNT(*)::bigint AS "count"
      FROM "ReferenceImage"
      WHERE "organizationId" = ${orgId}
        AND "isActive" = TRUE
        AND "archivedAt" IS NULL
    `);
    return Number(rows[0]?.count || 0);
  }

  async createReference(
    state: ReferenceImageState,
    transaction: ReferenceImageTransaction
  ) {
    await transaction.$executeRaw(Prisma.sql`
      INSERT INTO "ReferenceImage" (
        "mediaId",
        "organizationId",
        "name",
        "tags",
        "brand",
        "aspectRatio",
        "styleNotes",
        "isActive",
        "isPrimary",
        "archivedAt",
        "usageCount",
        "lastUsedAt",
        "lastPlatforms",
        "createdAt",
        "updatedAt"
      ) VALUES (
        ${state.mediaId},
        ${state.organizationId},
        ${state.name},
        CAST(${JSON.stringify(state.tags)} AS jsonb),
        ${state.brand || null},
        ${state.aspectRatio || null},
        ${state.styleNotes || null},
        ${state.isActive},
        ${state.isPrimary},
        ${state.archivedAt || null},
        ${state.usageCount},
        ${state.lastUsedAt || null},
        CAST(${JSON.stringify(state.lastPlatforms)} AS jsonb),
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      )
    `);
    return this.getReference(state.organizationId, state.mediaId, transaction);
  }

  async updateReference(
    state: ReferenceImageState,
    transaction: ReferenceImageTransaction
  ) {
    await transaction.$executeRaw(Prisma.sql`
      UPDATE "ReferenceImage"
      SET
        "name" = ${state.name},
        "tags" = CAST(${JSON.stringify(state.tags)} AS jsonb),
        "brand" = ${state.brand || null},
        "aspectRatio" = ${state.aspectRatio || null},
        "styleNotes" = ${state.styleNotes || null},
        "isActive" = ${state.isActive},
        "isPrimary" = ${state.isPrimary},
        "archivedAt" = ${state.archivedAt || null},
        "usageCount" = ${state.usageCount},
        "lastUsedAt" = ${state.lastUsedAt || null},
        "lastPlatforms" = CAST(${JSON.stringify(state.lastPlatforms)} AS jsonb),
        "updatedAt" = CURRENT_TIMESTAMP
      WHERE "mediaId" = ${state.mediaId}
        AND "organizationId" = ${state.organizationId}
    `);
    return this.getReference(state.organizationId, state.mediaId, transaction);
  }

  clearPrimary(
    orgId: string,
    exceptMediaId: string | undefined,
    transaction: ReferenceImageTransaction
  ) {
    return transaction.$executeRaw(Prisma.sql`
      UPDATE "ReferenceImage"
      SET "isPrimary" = FALSE, "updatedAt" = CURRENT_TIMESTAMP
      WHERE "organizationId" = ${orgId}
        AND "isPrimary" = TRUE
        ${exceptMediaId ? Prisma.sql`AND "mediaId" <> ${exceptMediaId}` : Prisma.empty}
    `);
  }

  async incrementUsage(
    orgId: string,
    mediaId: string,
    platforms: string[],
    transaction: ReferenceImageTransaction
  ) {
    await transaction.$executeRaw(Prisma.sql`
      UPDATE "ReferenceImage"
      SET
        "usageCount" = "usageCount" + 1,
        "lastUsedAt" = CURRENT_TIMESTAMP,
        "lastPlatforms" = CAST(${JSON.stringify(platforms)} AS jsonb),
        "updatedAt" = CURRENT_TIMESTAMP
      WHERE "mediaId" = ${mediaId}
        AND "organizationId" = ${orgId}
    `);
  }

  private ensureTable() {
    if (!this.tableReady) {
      this.tableReady = this.createTable().catch((error) => {
        this.tableReady = undefined;
        throw error;
      });
    }
    return this.tableReady;
  }

  private async createTable() {
    await this._prismaService.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "ReferenceImage" (
        "mediaId" TEXT PRIMARY KEY,
        "organizationId" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "tags" JSONB NOT NULL DEFAULT '[]'::jsonb,
        "brand" TEXT,
        "aspectRatio" TEXT,
        "styleNotes" TEXT,
        "isActive" BOOLEAN NOT NULL DEFAULT FALSE,
        "isPrimary" BOOLEAN NOT NULL DEFAULT FALSE,
        "archivedAt" TIMESTAMP(3),
        "usageCount" INTEGER NOT NULL DEFAULT 0,
        "lastUsedAt" TIMESTAMP(3),
        "lastPlatforms" JSONB NOT NULL DEFAULT '[]'::jsonb,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "ReferenceImage_mediaId_fkey"
          FOREIGN KEY ("mediaId") REFERENCES "Media"("id")
          ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "ReferenceImage_organizationId_fkey"
          FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
          ON DELETE CASCADE ON UPDATE CASCADE
      )
    `);
    await this._prismaService.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "ReferenceImage_organizationId_archivedAt_idx"
      ON "ReferenceImage"("organizationId", "archivedAt")
    `);
    await this._prismaService.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "ReferenceImage_organizationId_isActive_idx"
      ON "ReferenceImage"("organizationId", "isActive")
    `);
  }

  private normalizeRow(row: ReferenceImageRow): StoredReferenceImage {
    return {
      ...row,
      tags: this.stringArray(row.tags),
      lastPlatforms: this.stringArray(row.lastPlatforms),
      brand: row.brand || undefined,
      aspectRatio: row.aspectRatio || undefined,
      styleNotes: row.styleNotes || undefined,
      archivedAt: row.archivedAt || undefined,
      lastUsedAt: row.lastUsedAt || undefined,
      originalName: row.originalName || undefined,
      alt: row.alt || undefined,
    };
  }

  private stringArray(value: unknown) {
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string')
      : [];
  }

  private getMediaModel(transaction?: ReferenceImageTransaction) {
    return (transaction?.media ||
      this._media.model.media) as ReferenceImageTransaction['media'];
  }
}
