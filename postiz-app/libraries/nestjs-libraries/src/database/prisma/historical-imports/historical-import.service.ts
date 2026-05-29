import { Injectable } from '@nestjs/common';
import { Integration, Prisma } from '@prisma/client';
import {
  HistoricalImportJobCreateInput,
  HistoricalImportJobUpdateInput,
  HistoricalImportRepository,
  HistoricalImportSourceUpsertInput,
  HistoricalPostMetricCreateInput,
  HistoricalPostUpsertInput,
} from '@gitroom/nestjs-libraries/database/prisma/historical-imports/historical-import.repository';
import { SocialProvider } from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';

const INSTAGRAM_PLATFORM = 'instagram';
const DEFAULT_INSTAGRAM_BACKFILL_MAX_PAGES = 1;
const MAX_INSTAGRAM_BACKFILL_PAGES = 5;

export type InstagramHistoricalImportSummary = {
  sourceId: string;
  jobId: string;
  platform: string;
  platformAccountId: string;
  postsSeen: number;
  postsCreated: number;
  postsUpdated: number;
  postsSkipped: number;
  metricsUpdated: number;
  errors: string[];
};

export type InstagramHistoricalImportInput = {
  organizationId: string;
  requestedByUserId?: string;
  integration: Integration;
  provider: SocialProvider;
  maxPages?: number;
};

@Injectable()
export class HistoricalImportService {
  constructor(private _historicalImportRepository: HistoricalImportRepository) {}

  createOrUpdateSource(input: HistoricalImportSourceUpsertInput) {
    return this._historicalImportRepository.createOrUpdateSource(input);
  }

  createJobRecord(input: HistoricalImportJobCreateInput) {
    return this._historicalImportRepository.createJobRecord(input);
  }

  updateJobRecord(input: HistoricalImportJobUpdateInput) {
    return this._historicalImportRepository.updateJobRecord(input);
  }

  upsertHistoricalPost(input: HistoricalPostUpsertInput) {
    return this._historicalImportRepository.upsertHistoricalPost(input);
  }

  insertHistoricalPostMetrics(metrics: HistoricalPostMetricCreateInput[]) {
    return this._historicalImportRepository.insertHistoricalPostMetrics(metrics);
  }

  async importInstagramBackfill(
    input: InstagramHistoricalImportInput
  ): Promise<InstagramHistoricalImportSummary> {
    if (input.integration.providerIdentifier !== INSTAGRAM_PLATFORM) {
      throw new Error('Historical import is only supported for Instagram');
    }

    if (!input.provider.listMedia) {
      throw new Error('Instagram provider does not support media listing');
    }

    const maxPages = this.safeMaxPages(input.maxPages);
    const attemptedAt = new Date();
    const platformAccountId = input.integration.internalId;
    const platformAccountName =
      input.integration.profile || input.integration.name || undefined;

    const source = await this.createOrUpdateSource({
      organizationId: input.organizationId,
      platform: INSTAGRAM_PLATFORM,
      platformAccountId,
      connectedAccountId: input.integration.id,
      platformAccountName,
      status: 'active',
      lastAttemptedSyncAt: attemptedAt,
    });

    const job = await this.createJobRecord({
      sourceId: source.id,
      organizationId: input.organizationId,
      platform: INSTAGRAM_PLATFORM,
      jobType: 'manual_backfill',
      status: 'running',
      startedAt: attemptedAt,
      requestedByUserId: input.requestedByUserId,
      postsSeenCount: 0,
      postsCreatedCount: 0,
      postsUpdatedCount: 0,
      postsSkippedCount: 0,
      metricsUpdatedCount: 0,
    });

    const summary: InstagramHistoricalImportSummary = {
      sourceId: source.id,
      jobId: job.id,
      platform: INSTAGRAM_PLATFORM,
      platformAccountId,
      postsSeen: 0,
      postsCreated: 0,
      postsUpdated: 0,
      postsSkipped: 0,
      metricsUpdated: 0,
      errors: [],
    };

    const seenPlatformPostIds = new Set<string>();
    let oldestImportedPublishedAt: Date | undefined;
    let newestImportedPublishedAt: Date | undefined;

    try {
      for (let page = 1; page <= maxPages; page++) {
        const mediaPage = await input.provider.listMedia(
          input.integration.token,
          { page },
          input.integration.internalId,
          input.integration
        );
        const results = Array.isArray(mediaPage?.results)
          ? mediaPage.results
          : [];

        for (const item of results) {
          summary.postsSeen++;

          const platformPostId = item.id ? String(item.id) : '';
          if (!platformPostId) {
            summary.postsSkipped++;
            summary.errors.push(`Skipped Instagram media on page ${page} without id`);
            continue;
          }

          if (seenPlatformPostIds.has(platformPostId)) {
            summary.postsSkipped++;
            continue;
          }
          seenPlatformPostIds.add(platformPostId);

          if (!item.publishedAt) {
            summary.postsSkipped++;
            summary.errors.push(
              `Skipped Instagram media ${platformPostId} without publishedAt`
            );
            continue;
          }

          const publishedAt = new Date(item.publishedAt);
          if (Number.isNaN(publishedAt.getTime())) {
            summary.postsSkipped++;
            summary.errors.push(
              `Skipped Instagram media ${platformPostId} with invalid publishedAt`
            );
            continue;
          }

          const existing =
            await this._historicalImportRepository.getHistoricalPostByPlatformIdentity({
              organizationId: input.organizationId,
              platform: INSTAGRAM_PLATFORM,
              platformAccountId,
              platformPostId,
            });

          await this.upsertHistoricalPost({
            organizationId: input.organizationId,
            sourceId: source.id,
            platform: INSTAGRAM_PLATFORM,
            platformAccountId,
            platformPostId,
            connectedAccountId: input.integration.id,
            platformPermalink: item.url || undefined,
            canonicalUrl: item.url || undefined,
            postType: item.type || 'unknown',
            caption: item.name || undefined,
            mediaPreviewUrl: item.thumbnail || undefined,
            thumbnailUrl: item.thumbnail || undefined,
            publishedAt,
            lastSyncedAt: new Date(),
            rawPlatformData: this.toJson(item),
          });

          if (existing) {
            summary.postsUpdated++;
          } else {
            summary.postsCreated++;
          }

          if (
            !oldestImportedPublishedAt ||
            publishedAt < oldestImportedPublishedAt
          ) {
            oldestImportedPublishedAt = publishedAt;
          }
          if (
            !newestImportedPublishedAt ||
            publishedAt > newestImportedPublishedAt
          ) {
            newestImportedPublishedAt = publishedAt;
          }
        }

        const availablePages = this.safeMaxPages(mediaPage?.pages);
        if (page >= availablePages) {
          break;
        }
      }

      const finishedAt = new Date();
      await this.updateJobRecord({
        id: job.id,
        status: 'completed',
        finishedAt,
        postsSeenCount: summary.postsSeen,
        postsCreatedCount: summary.postsCreated,
        postsUpdatedCount: summary.postsUpdated,
        postsSkippedCount: summary.postsSkipped,
        metricsUpdatedCount: summary.metricsUpdated,
      });

      await this.createOrUpdateSource({
        organizationId: input.organizationId,
        platform: INSTAGRAM_PLATFORM,
        platformAccountId,
        connectedAccountId: input.integration.id,
        platformAccountName,
        status: 'active',
        lastAttemptedSyncAt: attemptedAt,
        lastSuccessfulSyncAt: finishedAt,
        initialBackfillCompletedAt:
          source.initialBackfillCompletedAt || finishedAt,
        oldestImportedPublishedAt,
        newestImportedPublishedAt,
      });

      return summary;
    } catch (err) {
      const message = this.errorMessage(err);
      summary.errors.push(message);

      await this.updateJobRecord({
        id: job.id,
        status: 'failed',
        finishedAt: new Date(),
        postsSeenCount: summary.postsSeen,
        postsCreatedCount: summary.postsCreated,
        postsUpdatedCount: summary.postsUpdated,
        postsSkippedCount: summary.postsSkipped,
        metricsUpdatedCount: summary.metricsUpdated,
        errorCode: 'instagram_historical_import_failed',
        errorMessage: message,
      });

      await this.createOrUpdateSource({
        organizationId: input.organizationId,
        platform: INSTAGRAM_PLATFORM,
        platformAccountId,
        connectedAccountId: input.integration.id,
        platformAccountName,
        status: 'error',
        lastAttemptedSyncAt: attemptedAt,
      });

      return summary;
    }
  }

  private safeMaxPages(maxPages?: number) {
    const requested = Number(maxPages || DEFAULT_INSTAGRAM_BACKFILL_MAX_PAGES);
    if (!Number.isFinite(requested)) {
      return DEFAULT_INSTAGRAM_BACKFILL_MAX_PAGES;
    }

    return Math.min(
      MAX_INSTAGRAM_BACKFILL_PAGES,
      Math.max(1, Math.floor(requested))
    );
  }

  private toJson(input: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(input)) as Prisma.InputJsonValue;
  }

  private errorMessage(err: unknown) {
    if (err instanceof Error) {
      return err.message;
    }

    return String(err);
  }
}
