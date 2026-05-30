import { Prisma } from '@prisma/client';
import { Injectable } from '@nestjs/common';
import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';

export type HistoricalImportSourceUpsertInput = {
  organizationId: string;
  platform: string;
  platformAccountId: string;
  ownerUserId?: string;
  connectedAccountId?: string;
  platformAccountName?: string;
  status?: string;
  lastSuccessfulSyncAt?: Date;
  lastAttemptedSyncAt?: Date;
  initialBackfillCompletedAt?: Date;
  syncCursor?: Prisma.InputJsonValue;
  oldestImportedPublishedAt?: Date;
  newestImportedPublishedAt?: Date;
};

export type HistoricalImportJobCreateInput = {
  sourceId: string;
  organizationId: string;
  platform: string;
  jobType: string;
  status?: string;
  startedAt?: Date;
  finishedAt?: Date;
  requestedByUserId?: string;
  cursorBefore?: Prisma.InputJsonValue;
  cursorAfter?: Prisma.InputJsonValue;
  windowStart?: Date;
  windowEnd?: Date;
  postsSeenCount?: number;
  postsCreatedCount?: number;
  postsUpdatedCount?: number;
  postsSkippedCount?: number;
  metricsUpdatedCount?: number;
  errorCode?: string;
  errorMessage?: string;
  retryCount?: number;
};

export type HistoricalImportJobUpdateInput = {
  id: string;
  status?: string;
  finishedAt?: Date;
  cursorAfter?: Prisma.InputJsonValue;
  postsSeenCount?: number;
  postsCreatedCount?: number;
  postsUpdatedCount?: number;
  postsSkippedCount?: number;
  metricsUpdatedCount?: number;
  errorCode?: string;
  errorMessage?: string;
};

export type HistoricalPostPlatformIdentityInput = {
  organizationId: string;
  platform: string;
  platformAccountId: string;
  platformPostId: string;
};

export type HistoricalPostUpsertInput = {
  organizationId: string;
  sourceId: string;
  platform: string;
  platformAccountId: string;
  platformPostId: string;
  connectedAccountId?: string;
  platformPermalink?: string | null;
  canonicalUrl?: string | null;
  postType?: string;
  caption?: string;
  mediaPreviewUrl?: string;
  thumbnailUrl?: string;
  publishedAt: Date;
  lastSyncedAt?: Date;
  deletedOrUnavailableAt?: Date;
  visibility?: string;
  language?: string;
  rawPlatformData?: Prisma.InputJsonValue;
};

export type HistoricalPostMetricCreateInput = {
  historicalPostId: string;
  organizationId: string;
  platform: string;
  metricName: string;
  metricValue: number;
  metricUnit?: string;
  metricPeriod?: string;
  periodStart?: Date;
  periodEnd?: Date;
  observedAt?: Date;
};

@Injectable()
export class HistoricalImportRepository {
  constructor(
    private _sources: PrismaRepository<'historicalImportSource'>,
    private _jobs: PrismaRepository<'historicalImportJob'>,
    private _posts: PrismaRepository<'historicalPost'>,
    private _metrics: PrismaRepository<'historicalPostMetric'>
  ) {}

  createOrUpdateSource(input: HistoricalImportSourceUpsertInput) {
    return this._sources.model.historicalImportSource.upsert({
      where: {
        organizationId_platform_platformAccountId: {
          organizationId: input.organizationId,
          platform: input.platform,
          platformAccountId: input.platformAccountId,
        },
      },
      create: {
        organizationId: input.organizationId,
        ownerUserId: input.ownerUserId,
        platform: input.platform,
        connectedAccountId: input.connectedAccountId,
        platformAccountId: input.platformAccountId,
        platformAccountName: input.platformAccountName,
        status: input.status || 'active',
        lastSuccessfulSyncAt: input.lastSuccessfulSyncAt,
        lastAttemptedSyncAt: input.lastAttemptedSyncAt,
        initialBackfillCompletedAt: input.initialBackfillCompletedAt,
        syncCursor: input.syncCursor,
        oldestImportedPublishedAt: input.oldestImportedPublishedAt,
        newestImportedPublishedAt: input.newestImportedPublishedAt,
      },
      update: {
        ownerUserId: input.ownerUserId,
        connectedAccountId: input.connectedAccountId,
        platformAccountName: input.platformAccountName,
        status: input.status,
        lastSuccessfulSyncAt: input.lastSuccessfulSyncAt,
        lastAttemptedSyncAt: input.lastAttemptedSyncAt,
        initialBackfillCompletedAt: input.initialBackfillCompletedAt,
        syncCursor: input.syncCursor,
        oldestImportedPublishedAt: input.oldestImportedPublishedAt,
        newestImportedPublishedAt: input.newestImportedPublishedAt,
      },
    });
  }

  createJobRecord(input: HistoricalImportJobCreateInput) {
    return this._jobs.model.historicalImportJob.create({
      data: {
        sourceId: input.sourceId,
        organizationId: input.organizationId,
        platform: input.platform,
        jobType: input.jobType,
        status: input.status || 'queued',
        startedAt: input.startedAt,
        finishedAt: input.finishedAt,
        requestedByUserId: input.requestedByUserId,
        cursorBefore: input.cursorBefore,
        cursorAfter: input.cursorAfter,
        windowStart: input.windowStart,
        windowEnd: input.windowEnd,
        postsSeenCount: input.postsSeenCount,
        postsCreatedCount: input.postsCreatedCount,
        postsUpdatedCount: input.postsUpdatedCount,
        postsSkippedCount: input.postsSkippedCount,
        metricsUpdatedCount: input.metricsUpdatedCount,
        errorCode: input.errorCode,
        errorMessage: input.errorMessage,
        retryCount: input.retryCount,
      },
    });
  }

  updateJobRecord(input: HistoricalImportJobUpdateInput) {
    return this._jobs.model.historicalImportJob.update({
      where: { id: input.id },
      data: {
        status: input.status,
        finishedAt: input.finishedAt,
        cursorAfter: input.cursorAfter,
        postsSeenCount: input.postsSeenCount,
        postsCreatedCount: input.postsCreatedCount,
        postsUpdatedCount: input.postsUpdatedCount,
        postsSkippedCount: input.postsSkippedCount,
        metricsUpdatedCount: input.metricsUpdatedCount,
        errorCode: input.errorCode,
        errorMessage: input.errorMessage,
      },
    });
  }

  getHistoricalPostByPlatformIdentity(
    input: HistoricalPostPlatformIdentityInput
  ) {
    return this._posts.model.historicalPost.findUnique({
      where: {
        organizationId_platform_platformAccountId_platformPostId: {
          organizationId: input.organizationId,
          platform: input.platform,
          platformAccountId: input.platformAccountId,
          platformPostId: input.platformPostId,
        },
      },
    });
  }

  upsertHistoricalPost(input: HistoricalPostUpsertInput) {
    const lastSyncedAt = input.lastSyncedAt || new Date();

    return this._posts.model.historicalPost.upsert({
      where: {
        organizationId_platform_platformAccountId_platformPostId: {
          organizationId: input.organizationId,
          platform: input.platform,
          platformAccountId: input.platformAccountId,
          platformPostId: input.platformPostId,
        },
      },
      create: {
        organizationId: input.organizationId,
        sourceId: input.sourceId,
        platform: input.platform,
        connectedAccountId: input.connectedAccountId,
        platformAccountId: input.platformAccountId,
        platformPostId: input.platformPostId,
        platformPermalink: input.platformPermalink,
        canonicalUrl: input.canonicalUrl,
        postType: input.postType || 'unknown',
        caption: input.caption,
        mediaPreviewUrl: input.mediaPreviewUrl,
        thumbnailUrl: input.thumbnailUrl,
        publishedAt: input.publishedAt,
        lastSyncedAt,
        deletedOrUnavailableAt: input.deletedOrUnavailableAt,
        visibility: input.visibility || 'unknown',
        language: input.language,
        isHistoricalImport: true,
        readOnly: true,
        rawPlatformData: input.rawPlatformData,
      },
      update: {
        sourceId: input.sourceId,
        connectedAccountId: input.connectedAccountId,
        platformPermalink: input.platformPermalink,
        canonicalUrl: input.canonicalUrl,
        postType: input.postType,
        caption: input.caption,
        mediaPreviewUrl: input.mediaPreviewUrl,
        thumbnailUrl: input.thumbnailUrl,
        publishedAt: input.publishedAt,
        lastSyncedAt,
        deletedOrUnavailableAt: input.deletedOrUnavailableAt,
        visibility: input.visibility,
        language: input.language,
        isHistoricalImport: true,
        readOnly: true,
        rawPlatformData: input.rawPlatformData,
      },
    });
  }

  insertHistoricalPostMetrics(metrics: HistoricalPostMetricCreateInput[]) {
    if (metrics.length === 0) {
      return { count: 0 };
    }

    return this._metrics.model.historicalPostMetric.createMany({
      data: metrics.map((metric) => ({
        historicalPostId: metric.historicalPostId,
        organizationId: metric.organizationId,
        platform: metric.platform,
        metricName: metric.metricName,
        metricValue: metric.metricValue,
        metricUnit: metric.metricUnit || 'count',
        metricPeriod: metric.metricPeriod || 'lifetime',
        periodStart: metric.periodStart,
        periodEnd: metric.periodEnd,
        observedAt: metric.observedAt,
      })),
    });
  }
}
