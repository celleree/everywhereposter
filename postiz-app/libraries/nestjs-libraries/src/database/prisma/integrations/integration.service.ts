import {
  forwardRef,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import { IntegrationRepository } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.repository';
import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';
import {
  AnalyticsData,
  SocialProvider,
} from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import { Integration, Organization } from '@prisma/client';
import { NotificationService } from '@gitroom/nestjs-libraries/database/prisma/notifications/notification.service';
import dayjs from 'dayjs';
import { timer } from '@gitroom/helpers/utils/timer';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import { RefreshToken } from '@gitroom/nestjs-libraries/integrations/social.abstract';
import { IntegrationTimeDto } from '@gitroom/nestjs-libraries/dtos/integrations/integration.time.dto';
import { UploadFactory } from '@gitroom/nestjs-libraries/upload/upload.factory';
import { PlugDto } from '@gitroom/nestjs-libraries/dtos/plugs/plug.dto';
import { difference, uniq } from 'lodash';
import utc from 'dayjs/plugin/utc';
import { AutopostRepository } from '@gitroom/nestjs-libraries/database/prisma/autopost/autopost.repository';
import { RefreshIntegrationService } from '@gitroom/nestjs-libraries/integrations/refresh.integration.service';
import { TemporalService } from 'nestjs-temporal-core';
import { isBillingEnabled } from '@gitroom/helpers/utils/billing.enabled';
import { TypedSearchAttributes } from '@temporalio/common';
import { organizationId } from '@gitroom/nestjs-libraries/temporal/temporal.search.attribute';

dayjs.extend(utc);

type CheckAnalyticsOptions = {
  forceRefresh?: boolean;
  forceAnalyticsRefresh?: boolean;
  enableInstagramBusinessSnapshots?: boolean;
};

@Injectable()
export class IntegrationService {
  private storage = UploadFactory.createStorage();
  private instagramBusinessSnapshotMetrics = [
    'likes',
    'views',
    'comments',
    'shares',
    'saves',
    'replies',
  ];

  private normalizeDisplayName<T extends { providerIdentifier: string; profile?: string | null; name: string }>(
    integration: T
  ): T {
    if (
      ['instagram', 'instagram-standalone'].includes(
        integration.providerIdentifier
      ) &&
      integration.profile
    ) {
      return {
        ...integration,
        name: integration.profile,
      };
    }

    return integration;
  }

  constructor(
    private _integrationRepository: IntegrationRepository,
    private _autopostsRepository: AutopostRepository,
    private _integrationManager: IntegrationManager,
    private _notificationService: NotificationService,
    @Inject(forwardRef(() => RefreshIntegrationService))
    private _refreshIntegrationService: RefreshIntegrationService,
    private _temporalService: TemporalService
  ) {}

  private isTemporalError(error: unknown, expectedName: string) {
    return (
      !!error &&
      typeof error === 'object' &&
      'name' in error &&
      String((error as { name?: unknown }).name || '') === expectedName
    );
  }

  async changeActiveCron(orgId: string) {
    const data = await this._autopostsRepository.getAutoposts(orgId);

    for (const item of data.filter((autopost) => autopost.active)) {
      try {
        await this._temporalService.terminateWorkflow(`autopost-${item.id}`);
      } catch (error) {
        if (!this.isTemporalError(error, 'WorkflowNotFoundError')) {
          throw error;
        }
      }
    }

    return true;
  }

  async restoreActiveCron(orgId: string) {
    const data = await this._autopostsRepository.getAutoposts(orgId);
    const client = this._temporalService.client.getRawClient();

    if (!client) {
      throw new Error('Temporal workflow client is unavailable.');
    }

    for (const item of data.filter((autopost) => autopost.active)) {
      try {
        await client.workflow.start('autoPostWorkflow', {
          workflowId: `autopost-${item.id}`,
          taskQueue: 'main',
          args: [{ id: item.id, immediately: true }],
          typedSearchAttributes: new TypedSearchAttributes([
            {
              key: organizationId,
              value: orgId,
            },
          ]),
        });
      } catch (error) {
        if (
          !this.isTemporalError(
            error,
            'WorkflowExecutionAlreadyStartedError'
          )
        ) {
          throw error;
        }
      }
    }

    return true;
  }

  getMentions(platform: string, q: string) {
    return this._integrationRepository.getMentions(platform, q);
  }

  insertMentions(
    platform: string,
    mentions: { name: string; username: string; image: string }[]
  ) {
    return this._integrationRepository.insertMentions(platform, mentions);
  }

  async setTimes(
    orgId: string,
    integrationId: string,
    times: IntegrationTimeDto
  ) {
    return this._integrationRepository.setTimes(orgId, integrationId, times);
  }

  updateProviderSettings(org: string, id: string, additionalSettings: string) {
    return this._integrationRepository.updateProviderSettings(
      org,
      id,
      additionalSettings
    );
  }

  checkPreviousConnections(org: string, id: string) {
    return this._integrationRepository.checkPreviousConnections(org, id);
  }

  async createOrUpdateIntegration(
    additionalSettings:
      | {
          title: string;
          description: string;
          type: 'checkbox' | 'text' | 'textarea';
          value: any;
          regex?: string;
        }[]
      | undefined,
    oneTimeToken: boolean,
    org: string,
    name: string,
    picture: string | undefined,
    type: 'article' | 'social',
    internalId: string,
    provider: string,
    token: string,
    refreshToken = '',
    expiresIn?: number,
    username?: string,
    isBetweenSteps = false,
    refresh?: string,
    timezone?: number,
    customInstanceDetails?: string
  ) {
    let uploadedPicture: string | undefined;
    if (picture) {
      try {
        uploadedPicture =
          picture.indexOf('imagedelivery.net') > -1
            ? picture
            : await this.storage.uploadSimple(picture);
      } catch (err) {
        console.warn(
          `Skipping profile picture import for ${provider} integration ${internalId}.`,
          err
        );
      }
    }

    return this._integrationRepository.createOrUpdateIntegration(
      additionalSettings,
      oneTimeToken,
      org,
      name,
      uploadedPicture,
      type,
      internalId,
      provider,
      token,
      refreshToken,
      expiresIn,
      username,
      isBetweenSteps,
      refresh,
      timezone,
      customInstanceDetails
    );
  }

  updateIntegrationGroup(org: string, id: string, group: string) {
    return this._integrationRepository.updateIntegrationGroup(org, id, group);
  }

  updateOnCustomerName(org: string, id: string, name: string) {
    return this._integrationRepository.updateOnCustomerName(org, id, name);
  }

  async getIntegrationsList(org: string) {
    return (await this._integrationRepository.getIntegrationsList(org)).map(
      (integration) => this.normalizeDisplayName(integration)
    );
  }

  async getIntegrationForOrder(
    id: string,
    order: string,
    user: string,
    org: string
  ) {
    const integration = await this._integrationRepository.getIntegrationForOrder(
      id,
      order,
      user,
      org
    );

    return integration ? this.normalizeDisplayName(integration) : integration;
  }

  updateNameAndUrl(id: string, name: string, url: string) {
    return this._integrationRepository.updateNameAndUrl(id, name, url);
  }

  async getIntegrationById(org: string, id: string) {
    const integration = await this._integrationRepository.getIntegrationById(
      org,
      id
    );

    return integration ? this.normalizeDisplayName(integration) : integration;
  }

  async refreshToken(provider: SocialProvider, refresh: string) {
    try {
      const { refreshToken, accessToken, expiresIn } =
        await provider.refreshToken(refresh);

      if (!refreshToken || !accessToken || !expiresIn) {
        return false;
      }

      return { refreshToken, accessToken, expiresIn };
    } catch (e) {
      return false;
    }
  }

  async disconnectChannel(orgId: string, integration: Integration) {
    await this._integrationRepository.disconnectChannel(orgId, integration.id);
    await this.informAboutRefreshError(orgId, integration);
  }

  async informAboutRefreshError(
    orgId: string,
    integration: Integration,
    err = ''
  ) {
    await this._notificationService.inAppNotification(
      orgId,
      `Could not refresh your ${integration.providerIdentifier} channel ${err}`,
      `Could not refresh your ${integration.providerIdentifier} channel ${err}. Please go back to the system and connect it again ${process.env.FRONTEND_URL}/launches`,
      true,
      false,
      'info'
    );
  }

  async refreshNeeded(org: string, id: string) {
    return this._integrationRepository.refreshNeeded(org, id);
  }

  async setBetweenRefreshSteps(id: string) {
    return this._integrationRepository.setBetweenRefreshSteps(id);
  }

  async refreshTokens() {
    const integrations = await this._integrationRepository.needsToBeRefreshed();
    for (const integration of integrations) {
      const provider = this._integrationManager.getSocialIntegration(
        integration.providerIdentifier
      );

      const data = await this.refreshToken(provider, integration.refreshToken!);

      if (!data) {
        await this.informAboutRefreshError(
          integration.organizationId,
          integration
        );
        await this._integrationRepository.refreshNeeded(
          integration.organizationId,
          integration.id
        );
        return;
      }

      const { refreshToken, accessToken, expiresIn } = data;

      await this.createOrUpdateIntegration(
        undefined,
        !!provider.oneTimeToken,
        integration.organizationId,
        integration.name,
        undefined,
        'social',
        integration.internalId,
        integration.providerIdentifier,
        accessToken,
        refreshToken,
        expiresIn
      );
    }
  }

  async disableChannel(org: string, id: string) {
    return this._integrationRepository.disableChannel(org, id);
  }

  async enableChannel(org: string, totalChannels: number, id: string) {
    const integrations = (
      await this._integrationRepository.getIntegrationsList(org)
    ).filter((f) => !f.disabled);
    if (
      isBillingEnabled() &&
      integrations.length >= totalChannels
    ) {
      throw new Error('You have reached the maximum number of channels');
    }

    return this._integrationRepository.enableChannel(org, id);
  }

  async getPostsForChannel(org: string, id: string) {
    return this._integrationRepository.getPostsForChannel(org, id);
  }

  async deleteChannel(org: string, id: string) {
    return this._integrationRepository.deleteChannel(org, id);
  }

  async scrubIntegrationsForMetaUser(
    metaUserId: string,
    providerIdentifiers: string[]
  ) {
    return this._integrationRepository.scrubIntegrationsForMetaUser(
      metaUserId,
      providerIdentifiers
    );
  }

  async disableIntegrations(org: string, totalChannels: number) {
    return this._integrationRepository.disableIntegrations(org, totalChannels);
  }

  async enableBillingDisabledIntegrations(
    org: string,
    totalChannels: number
  ) {
    return this._integrationRepository.enableBillingDisabledIntegrations(
      org,
      totalChannels
    );
  }

  async checkForDeletedOnceAndUpdate(org: string, page: string) {
    return this._integrationRepository.checkForDeletedOnceAndUpdate(org, page);
  }

  async saveProviderPage(org: string, id: string, data: any) {
    const getIntegration = await this._integrationRepository.getIntegrationById(
      org,
      id
    );
    if (!getIntegration) {
      throw new HttpException('Integration not found', HttpStatus.NOT_FOUND);
    }
    if (!getIntegration.inBetweenSteps) {
      throw new HttpException('Invalid request', HttpStatus.BAD_REQUEST);
    }

    const provider = this._integrationManager.getSocialIntegration(
      getIntegration.providerIdentifier
    );

    if (!provider.fetchPageInformation) {
      throw new HttpException(
        'Provider does not support page selection',
        HttpStatus.BAD_REQUEST
      );
    }

    const getIntegrationInformation = await provider.fetchPageInformation(
      getIntegration.token,
      data
    );

    await this.checkForDeletedOnceAndUpdate(
      org,
      String(getIntegrationInformation.id)
    );
    await this._integrationRepository.updateIntegration(id, {
      picture: getIntegrationInformation.picture,
      internalId: String(getIntegrationInformation.id),
      organizationId: org,
      name: getIntegrationInformation.name,
      inBetweenSteps: false,
      token: getIntegrationInformation.access_token,
      profile: getIntegrationInformation.username,
    });

    return { success: true };
  }

  async checkAnalytics(
    org: Organization,
    integration: string,
    date: string,
    options: boolean | CheckAnalyticsOptions = false
  ): Promise<AnalyticsData[]> {
    const forceRefresh =
      typeof options === 'boolean' ? options : !!options.forceRefresh;
    const forceAnalyticsRefresh =
      typeof options === 'object' && !!options.forceAnalyticsRefresh;
    const enableInstagramBusinessSnapshots =
      typeof options === 'object' && !!options.enableInstagramBusinessSnapshots;

    const getIntegration = await this.getIntegrationById(org.id, integration);

    if (!getIntegration) {
      throw new Error('Invalid integration');
    }

    if (getIntegration.type !== 'social') {
      return [];
    }

    const integrationProvider = this._integrationManager.getSocialIntegration(
      getIntegration.providerIdentifier
    );
    const useInstagramBusinessSnapshots =
      enableInstagramBusinessSnapshots &&
      getIntegration.providerIdentifier === 'instagram';
    const snapshotCacheDate = dayjs.utc().format('YYYY-MM-DD');
    const cacheKey = useInstagramBusinessSnapshots
      ? `integration:${org.id}:${integration}:${date}:igbiz-snapshots:v1:${snapshotCacheDate}`
      : `integration:${org.id}:${integration}:${date}`;

    if (
      dayjs(getIntegration?.tokenExpiration).isBefore(dayjs()) ||
      forceRefresh
    ) {
      const data = await this._refreshIntegrationService.refresh(
        getIntegration
      );
      if (!data) {
        return [];
      }

      const { accessToken } = data;

      if (accessToken) {
        getIntegration.token = accessToken;

        if (integrationProvider.refreshWait) {
          await timer(10000);
        }
      } else {
        await this.disconnectChannel(org.id, getIntegration);
        return [];
      }
    }

    if (!forceAnalyticsRefresh) {
      const getIntegrationData = await ioRedis.get(cacheKey);
      if (getIntegrationData) {
        return JSON.parse(getIntegrationData);
      }
    }

    if (integrationProvider.analytics) {
      try {
        const loadAnalytics = await integrationProvider.analytics(
          getIntegration.internalId,
          getIntegration.token,
          +date
        );
        const analytics = useInstagramBusinessSnapshots
          ? await this.applyInstagramBusinessSnapshots(
              org.id,
              getIntegration,
              +date,
              loadAnalytics
            )
          : loadAnalytics;
        await ioRedis.set(
          cacheKey,
          JSON.stringify(analytics),
          'EX',
          useInstagramBusinessSnapshots
            ? 900
            : !process.env.NODE_ENV || process.env.NODE_ENV === 'development'
              ? 1
              : 3600
        );
        return analytics;
      } catch (e) {
        if (e instanceof RefreshToken) {
          return this.checkAnalytics(org, integration, date, {
            ...(typeof options === 'object' ? options : {}),
            forceRefresh: true,
            forceAnalyticsRefresh: true,
          });
        }
      }
    }

    return [];
  }

  private async applyInstagramBusinessSnapshots(
    organizationId: string,
    integration: Integration,
    date: number,
    analytics: AnalyticsData[]
  ): Promise<AnalyticsData[]> {
    const rangeDays = Math.max(1, Number(date) || 1);
    const snapshotDate = dayjs.utc().startOf('day').toDate();
    const observedAt = new Date();
    const totalValueMetrics = analytics.filter(
      (item) =>
        item.seriesType === 'total_value' &&
        item.metricName &&
        this.instagramBusinessSnapshotMetrics.includes(item.metricName)
    );

    for (const item of totalValueMetrics) {
      const value = Number(item.data?.[0]?.total);

      if (!Number.isFinite(value) || !item.metricName) {
        continue;
      }

      await this._integrationRepository.upsertIntegrationAnalyticsSnapshot({
        organizationId,
        integrationId: integration.id,
        providerIdentifier: integration.providerIdentifier,
        metricName: item.metricName,
        rangeDays,
        snapshotDate,
        value,
        observedAt,
      });
    }

    const snapshots =
      await this._integrationRepository.getIntegrationAnalyticsSnapshots({
        organizationId,
        integrationId: integration.id,
        metricNames: this.instagramBusinessSnapshotMetrics,
        rangeDays,
        fromDate: dayjs
          .utc()
          .subtract(rangeDays - 1, 'day')
          .startOf('day')
          .toDate(),
        toDate: snapshotDate,
      });

    const snapshotsByMetric = snapshots.reduce(
      (all, snapshot) => {
        all[snapshot.metricName] ||= [];
        all[snapshot.metricName].push(snapshot);
        return all;
      },
      {} as Record<string, typeof snapshots>
    );

    return analytics.map((item) => {
      if (
        item.seriesType !== 'total_value' ||
        !item.metricName ||
        !this.instagramBusinessSnapshotMetrics.includes(item.metricName)
      ) {
        return item;
      }

      const metricSnapshots = snapshotsByMetric[item.metricName] || [];

      if (metricSnapshots.length === 0) {
        return item;
      }

      return {
        ...item,
        seriesType: 'range_total_snapshot' as const,
        summaryType: 'latest' as const,
        data: metricSnapshots.map((snapshot) => ({
          total: snapshot.value,
          date: dayjs.utc(snapshot.snapshotDate).format('YYYY-MM-DD'),
        })),
      };
    });
  }

  customers(orgId: string) {
    return this._integrationRepository.customers(orgId);
  }

  getPlugsByIntegrationId(org: string, integrationId: string) {
    return this._integrationRepository.getPlugsByIntegrationId(
      org,
      integrationId
    );
  }

  async processInternalPlug(
    data: {
      post: string;
      originalIntegration: string;
      integration: string;
      plugName: string;
      orgId: string;
      delay: number;
      information: any;
    },
    forceRefresh = false
  ): Promise<any> {
    const originalIntegration =
      await this._integrationRepository.getIntegrationById(
        data.orgId,
        data.originalIntegration
      );

    const getIntegration = await this._integrationRepository.getIntegrationById(
      data.orgId,
      data.integration
    );

    if (!getIntegration || !originalIntegration) {
      return;
    }

    const getAllInternalPlugs = this._integrationManager
      .getInternalPlugs(getIntegration.providerIdentifier)
      .internalPlugs.find((p: any) => p.identifier === data.plugName);

    if (!getAllInternalPlugs) {
      return;
    }

    const getSocialIntegration = this._integrationManager.getSocialIntegration(
      getIntegration.providerIdentifier
    );

    // @ts-ignore
    await getSocialIntegration?.[getAllInternalPlugs.methodName]?.(
      getIntegration,
      originalIntegration,
      data.post,
      data.information
    );

    return;
  }

  async processPlugs(data: {
    plugId: string;
    postId: string;
    delay: number;
    totalRuns: number;
    currentRun: number;
  }) {
    const getPlugById = await this._integrationRepository.getPlug(data.plugId);
    if (!getPlugById) {
      return true;
    }

    const integration = this._integrationManager.getSocialIntegration(
      getPlugById.integration.providerIdentifier
    );

    // @ts-ignore
    const process = await integration[getPlugById.plugFunction](
      getPlugById.integration,
      data.postId,
      JSON.parse(getPlugById.data).reduce((all: any, current: any) => {
        all[current.name] = current.value;
        return all;
      }, {})
    );

    if (process) {
      return true;
    }

    if (data.totalRuns === data.currentRun) {
      return true;
    }

    return false;
  }

  async createOrUpdatePlug(
    orgId: string,
    integrationId: string,
    body: PlugDto
  ) {
    const { activated } = await this._integrationRepository.createOrUpdatePlug(
      orgId,
      integrationId,
      body
    );

    return {
      activated,
    };
  }

  async changePlugActivation(orgId: string, plugId: string, status: boolean) {
    const { id, integrationId, plugFunction } =
      await this._integrationRepository.changePlugActivation(
        orgId,
        plugId,
        status
      );

    return { id };
  }

  async getPlugs(orgId: string, integrationId: string) {
    return this._integrationRepository.getPlugs(orgId, integrationId);
  }

  async loadExisingData(
    methodName: string,
    integrationId: string,
    id: string[]
  ) {
    const exisingData = await this._integrationRepository.loadExisingData(
      methodName,
      integrationId,
      id
    );
    const loadOnlyIds = exisingData.map((p) => p.value);
    return difference(id, loadOnlyIds);
  }

  async findFreeDateTime(
    orgId: string,
    integrationsId?: string
  ): Promise<number[]> {
    const findTimes = await this._integrationRepository.getPostingTimes(
      orgId,
      integrationsId
    );
    return uniq(
      findTimes.reduce((all: any, current: any) => {
        return [
          ...all,
          ...JSON.parse(current.postingTimes).map(
            (p: { time: number }) => p.time
          ),
        ];
      }, [] as number[])
    );
  }
}
