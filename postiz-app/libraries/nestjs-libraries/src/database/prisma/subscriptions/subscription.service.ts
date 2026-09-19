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

    if (!this._transaction) {
      throw new Error('Subscription mutation transaction is unavailable.');
    }

    const deleted = await this._transaction.model.$transaction(
      (transaction) =>
        this._subscriptionRepository.deleteOrdinarySubscription(
          transaction,
          customerId
        )
    );

    if (!deleted.applied) {
      if ('reconcile' in deleted && deleted.reconcile) {
        await this.reconcileAuthoritativeEntitlements(deleted.organizationId);
      }
      return false;
    }

    await this.reconcileAuthoritativeEntitlements(deleted.organizationId);
    return deleted.result;
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

  private async getAuthoritativeEntitlementState(organizationId: string) {
    const subscription =
      await this._subscriptionRepository.getSubscription(organizationId);
    const tier = subscription?.subscriptionTier || 'FREE';
    const plan = pricing[tier] || pricing.FREE;

    return {
      fingerprint: JSON.stringify({
        id: subscription?.id || null,
        subscriptionTier: tier,
        totalChannels: subscription?.totalChannels ?? 0,
        isLifetime: subscription?.isLifetime ?? false,
        identifier: subscription?.identifier || null,
        period: subscription?.period || null,
        cancelAt: subscription?.cancelAt || null,
        createdAt: subscription?.createdAt || null,
        updatedAt: subscription?.updatedAt || null,
      }),
      totalChannels: subscription?.totalChannels ?? 0,
      teamMembers: !!plan.team_members,
      autoPost: !!plan.autoPost,
    };
  }

  private async isEntitlementStateCurrent(
    organizationId: string,
    fingerprint: string
  ) {
    return (
      (await this.getAuthoritativeEntitlementState(organizationId))
        .fingerprint === fingerprint
    );
  }

  private async reconcileIntegrationEntitlements(
    organizationId: string,
    totalChannels: number
  ) {
    const integrations =
      await this._integrationService.getIntegrationsList(organizationId);
    const enabled = integrations.filter((integration) => !integration.disabled);

    if (enabled.length > totalChannels) {
      await this._integrationService.disableIntegrations(
        organizationId,
        enabled.length - totalChannels
      );
      return;
    }

    if (enabled.length >= totalChannels) {
      return;
    }

    const billingDisabled = integrations.filter(
      (integration) =>
        integration.disabled && integration.disabledByBilling
    );
    const restoreCount = Math.min(
      totalChannels - enabled.length,
      billingDisabled.length
    );

    if (restoreCount > 0) {
      await this._integrationService.enableBillingDisabledIntegrations(
        organizationId,
        restoreCount
      );
    }
  }

  private async reconcileAuthoritativeEntitlements(organizationId: string) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const desired =
        await this.getAuthoritativeEntitlementState(organizationId);

      await this.reconcileIntegrationEntitlements(
        organizationId,
        desired.totalChannels
      );
      if (
        !(await this.isEntitlementStateCurrent(
          organizationId,
          desired.fingerprint
        ))
      ) {
        continue;
      }

      await this._organizationService.disableOrEnableNonSuperAdminUsers(
        organizationId,
        !desired.teamMembers
      );
      if (
        !(await this.isEntitlementStateCurrent(
          organizationId,
          desired.fingerprint
        ))
      ) {
        continue;
      }

      if (desired.autoPost) {
        await this._integrationService.restoreActiveCron(organizationId);
      } else {
        await this._integrationService.changeActiveCron(organizationId);
      }

      if (
        await this.isEntitlementStateCurrent(
          organizationId,
          desired.fingerprint
        )
      ) {
        return true;
      }
    }

    throw new Error(
      'Subscription changed repeatedly while entitlements were reconciling.'
    );
  }

  async modifySubscriptionByOrg(
    organizationId: string,
    _totalChannels: number,
    _billing: 'FREE' | 'STANDARD' | 'TEAM' | 'PRO' | 'ULTIMATE'
  ) {
    if (!organizationId) {
      return false;
    }

    if (!isBillingEnabled()) {
      return true;
    }

    return this.reconcileAuthoritativeEntitlements(organizationId);
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
    if (code) {
      if (!isBillingEnabled()) {
        return false;
      }

      if (!this._transaction) {
        throw new Error('Subscription mutation transaction is unavailable.');
      }

      const persisted = await this._transaction.model.$transaction(
        (transaction) =>
          this._subscriptionRepository.persistLifetimeSubscription(
            transaction,
            isTrailing,
            identifier,
            customerId,
            totalChannels,
            billing,
            period,
            cancelAt,
            code,
            org ? { id: org } : undefined
          )
      );

      if (!persisted.applied) {
        return;
      }

      await this.reconcileAuthoritativeEntitlements(
        persisted.organizationId
      );
      return;
    }

    if (!isBillingEnabled()) {
      return this._subscriptionRepository.bookkeepSubscriptionWhileBillingDisabled(
        identifier,
        customerId,
        period,
        cancelAt
      );
    }

    if (!this._transaction) {
      throw new Error('Subscription mutation transaction is unavailable.');
    }

    const persisted = await this._transaction.model.$transaction(
      (transaction) =>
        this._subscriptionRepository.persistOrdinarySubscription(
          transaction,
          isTrailing,
          identifier,
          customerId,
          totalChannels,
          billing,
          period,
          cancelAt
        )
    );

    if (!persisted.applied) {
      return {};
    }

    await this.reconcileAuthoritativeEntitlements(persisted.organizationId);
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
