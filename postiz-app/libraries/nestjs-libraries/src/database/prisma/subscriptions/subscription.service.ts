import { Injectable } from '@nestjs/common';
import { pricing } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/pricing';
import { SubscriptionRepository } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.repository';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { OrganizationService } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';
import { Organization, Prisma } from '@prisma/client';
import dayjs, { Dayjs } from 'dayjs';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import { PrismaTransaction } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { isBillingEnabled } from '@gitroom/helpers/utils/billing.enabled';

type OrganizationSubscription = {
  subscriptionTier?: string | null;
  createdAt?: Date | string | null;
};

type CreditWindow = {
  from: Dayjs;
  limit: number;
};

@Injectable()
export class SubscriptionService {
  constructor(
    private readonly _subscriptionRepository: SubscriptionRepository,
    private readonly _integrationService: IntegrationService,
    private readonly _organizationService: OrganizationService,
    private readonly _transaction?: PrismaTransaction
  ) {}

  getSubscriptionByOrganizationId(organizationId: string) {
    return this._subscriptionRepository.getSubscriptionByOrganizationId(
      organizationId
    );
  }

  useCredit<T>(
    organization: Organization,
    type = 'ai_images',
    func: () => Promise<T>
  ): Promise<T> {
    return this._subscriptionRepository.useCredit(organization, type, func);
  }

  async useCreditWithinLimit<T>(
    organization: Organization,
    type = 'ai_images',
    func: () => Promise<T>
  ): Promise<{ allowed: true; value: T } | { allowed: false }> {
    const window = await this.getCreditWindow(organization, type);
    if (window.limit <= 0) {
      return { allowed: false };
    }

    const reservation = await this.reserveCredit(
      organization.id,
      type,
      window.from,
      window.limit
    );
    if (!reservation) {
      return { allowed: false };
    }

    try {
      return { allowed: true, value: await func() };
    } catch (error) {
      await this.releaseCredit(reservation.id);
      throw error;
    }
  }

  getCode(code: string) {
    return this._subscriptionRepository.getCode(code);
  }

  async deleteSubscription(customerId: string) {
    if (!isBillingEnabled()) {
      return;
    }

    const modified = await this.modifySubscription(
      customerId,
      pricing.FREE.channel || 0,
      'FREE'
    );
    if (!modified) {
      return false;
    }

    return this._subscriptionRepository.deleteSubscriptionByCustomerId(
      customerId
    );
  }

  updateCustomerId(organizationId: string, customerId: string) {
    return this._subscriptionRepository.updateCustomerId(
      organizationId,
      customerId
    );
  }

  async checkSubscription(organizationId: string, subscriptionId: string) {
    return await this._subscriptionRepository.checkSubscription(
      organizationId,
      subscriptionId
    );
  }

  async modifySubscriptionByOrg(
    organizationId: string,
    totalChannels: number,
    billing: 'FREE' | 'STANDARD' | 'TEAM' | 'PRO' | 'ULTIMATE'
  ) {
    if (!organizationId) {
      return false;
    }

    if (!isBillingEnabled()) {
      return true;
    }

    const getCurrentSubscription =
      (await this._subscriptionRepository.getSubscriptionByOrgId(
        organizationId
      ))!;

    const from = pricing[getCurrentSubscription?.subscriptionTier || 'FREE'];
    const to = pricing[billing];

    const currentTotalChannels = (
      await this._integrationService.getIntegrationsList(organizationId)
    ).filter((f) => !f.disabled);

    if (currentTotalChannels.length > totalChannels) {
      await this._integrationService.disableIntegrations(
        organizationId,
        currentTotalChannels.length - totalChannels
      );
    }

    if (from.team_members && !to.team_members) {
      await this._organizationService.disableOrEnableNonSuperAdminUsers(
        organizationId,
        true
      );
    }

    if (!from.team_members && to.team_members) {
      await this._organizationService.disableOrEnableNonSuperAdminUsers(
        organizationId,
        false
      );
    }

    if (billing === 'FREE') {
      await this._integrationService.changeActiveCron(organizationId);
    }

    return true;
  }

  async modifySubscription(
    customerId: string,
    totalChannels: number,
    billing: 'FREE' | 'STANDARD' | 'TEAM' | 'PRO' | 'ULTIMATE'
  ) {
    if (!customerId) {
      return false;
    }

    const getOrgByCustomerId =
      await this._subscriptionRepository.getOrganizationByCustomerId(
        customerId
      );

    const getCurrentSubscription =
      (await this._subscriptionRepository.getSubscriptionByCustomerId(
        customerId
      ))!;

    if (
      !getOrgByCustomerId ||
      (getCurrentSubscription && getCurrentSubscription?.isLifetime)
    ) {
      return false;
    }

    if (!isBillingEnabled()) {
      return true;
    }

    const from = pricing[getCurrentSubscription?.subscriptionTier || 'FREE'];
    const to = pricing[billing];

    const currentTotalChannels = (
      await this._integrationService.getIntegrationsList(
        getOrgByCustomerId?.id!
      )
    ).filter((f) => !f.disabled);

    if (currentTotalChannels.length > totalChannels) {
      await this._integrationService.disableIntegrations(
        getOrgByCustomerId?.id!,
        currentTotalChannels.length - totalChannels
      );
    }

    if (from.team_members && !to.team_members) {
      await this._organizationService.disableOrEnableNonSuperAdminUsers(
        getOrgByCustomerId?.id!,
        true
      );
    }

    if (!from.team_members && to.team_members) {
      await this._organizationService.disableOrEnableNonSuperAdminUsers(
        getOrgByCustomerId?.id!,
        false
      );
    }

    if (billing === 'FREE') {
      await this._integrationService.changeActiveCron(getOrgByCustomerId?.id!);
    }

    return true;
  }

  async createOrUpdateSubscription(
    isTrailing: boolean,
    identifier: string,
    customerId: string,
    totalChannels: number,
    billing: 'STANDARD' | 'TEAM' | 'PRO' | 'ULTIMATE',
    period: 'MONTHLY' | 'YEARLY',
    cancelAt: number | null,
    code?: string,
    org?: string
  ) {
    if (!code) {
      try {
        const load = await this.modifySubscription(
          customerId,
          totalChannels,
          billing
        );
        if (!load) {
          return {};
        }
      } catch (e) {
        return {};
      }
    }

    if (!code && !isBillingEnabled()) {
      return this._subscriptionRepository.bookkeepSubscriptionWhileBillingDisabled(
        identifier,
        customerId,
        period,
        cancelAt
      );
    }

    return this._subscriptionRepository.createOrUpdateSubscription(
      isTrailing,
      identifier,
      customerId,
      totalChannels,
      billing,
      period,
      cancelAt,
      code,
      org ? { id: org } : undefined
    );
  }

  getSubscriptionByIdentifier(identifier: string) {
    return this._subscriptionRepository.getSubscriptionByIdentifier(identifier);
  }

  async getSubscription(organizationId: string) {
    return this._subscriptionRepository.getSubscription(organizationId);
  }

  async checkCredits(organization: Organization, checkType = 'ai_images') {
    const window = await this.getCreditWindow(organization, checkType);
    if (window.limit <= 0) {
      return { credits: 0 };
    }

    const totalUse = await this._subscriptionRepository.getCreditsFrom(
      organization.id,
      window.from,
      checkType
    );

    return {
      credits: window.limit - totalUse,
    };
  }

  async lifeTime(orgId: string, identifier: string, subscription: any) {
    if (!isBillingEnabled()) {
      return false;
    }

    return this.createOrUpdateSubscription(
      false,
      identifier,
      identifier,
      pricing[subscription].channel!,
      subscription,
      'YEARLY',
      null,
      identifier,
      orgId
    );
  }

  async addSubscription(orgId: string, userId: string, subscription: any) {
    if (!isBillingEnabled()) {
      return false;
    }

    await this._subscriptionRepository.setCustomerId(orgId, userId);
    return this.createOrUpdateSubscription(
      false,
      makeId(5),
      userId,
      pricing[subscription].channel!,
      subscription,
      'MONTHLY',
      null,
      undefined,
      orgId
    );
  }

  private async getCreditWindow(
    organization: Organization,
    checkType: string
  ): Promise<CreditWindow> {
    const suppliedSubscription = (
      organization as Organization & { subscription?: OrganizationSubscription | null }
    ).subscription;
    const subscription = suppliedSubscription?.createdAt
      ? suppliedSubscription
      : await this._subscriptionRepository.getSubscription(organization.id);
    const tier =
      subscription?.subscriptionTier ||
      suppliedSubscription?.subscriptionTier ||
      'FREE';
    const plan = pricing[tier] || pricing.FREE;

    if (tier === 'FREE' || !subscription?.createdAt) {
      return { from: dayjs(), limit: 0 };
    }

    let date = dayjs(subscription.createdAt);
    if (!date.isValid()) {
      return { from: dayjs(), limit: 0 };
    }

    const now = dayjs();
    while (date.isBefore(now)) {
      date = date.add(1, 'month');
    }

    return {
      from: date.subtract(1, 'month'),
      limit:
        checkType === 'ai_images'
          ? plan.image_generation_count
          : plan.generate_videos,
    };
  }

  private async reserveCredit(
    organizationId: string,
    type: string,
    from: Dayjs,
    limit: number
  ) {
    if (!this._transaction) {
      throw new Error('Credit reservation transaction is unavailable.');
    }

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this._transaction.model.$transaction(
          async (transaction) => {
            const current = await transaction.credits.aggregate({
              where: {
                organizationId,
                type,
                createdAt: {
                  gte: from.toDate(),
                },
              },
              _sum: {
                credits: true,
              },
            });

            if ((current._sum.credits || 0) >= limit) {
              return null;
            }

            return transaction.credits.create({
              data: {
                organizationId,
                credits: 1,
                type,
              },
              select: {
                id: true,
              },
            });
          },
          {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          }
        );
      } catch (error) {
        const code =
          error && typeof error === 'object' && 'code' in error
            ? String((error as { code?: unknown }).code || '')
            : '';
        if (code !== 'P2034' || attempt === 2) {
          throw error;
        }
      }
    }

    return null;
  }

  private async releaseCredit(id: string) {
    if (!this._transaction) {
      throw new Error('Credit reservation transaction is unavailable.');
    }

    await this._transaction.model.$transaction((transaction) =>
      transaction.credits.deleteMany({
        where: {
          id,
        },
      })
    );
  }
}
