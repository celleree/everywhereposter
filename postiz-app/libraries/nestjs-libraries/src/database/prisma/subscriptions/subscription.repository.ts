import { Injectable } from '@nestjs/common';
import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import dayjs from 'dayjs';
import { Organization, Prisma } from '@prisma/client';

@Injectable()
export class SubscriptionRepository {
  constructor(
    private readonly _subscription: PrismaRepository<'subscription'>,
    private readonly _organization: PrismaRepository<'organization'>,
    private readonly _user: PrismaRepository<'user'>,
    private readonly _credits: PrismaRepository<'credits'>,
    private _usedCodes: PrismaRepository<'usedCodes'>
  ) {}

  getUserAccount(userId: string) {
    return this._user.model.user.findFirst({
      where: {
        id: userId,
      },
      select: {
        account: true,
        connectedAccount: true,
      },
    });
  }

  getCode(code: string) {
    return this._usedCodes.model.usedCodes.findFirst({
      where: {
        code,
      },
    });
  }

  updateAccount(userId: string, account: string) {
    return this._user.model.user.update({
      where: {
        id: userId,
      },
      data: {
        account,
      },
    });
  }

  getSubscriptionByOrganizationId(organizationId: string) {
    return this._subscription.model.subscription.findFirst({
      where: {
        organizationId,
        deletedAt: null,
      },
    });
  }

  updateConnectedStatus(account: string, accountCharges: boolean) {
    return this._user.model.user.updateMany({
      where: {
        account,
      },
      data: {
        connectedAccount: accountCharges,
      },
    });
  }

  getCustomerIdByOrgId(organizationId: string) {
    return this._organization.model.organization.findFirst({
      where: {
        id: organizationId,
      },
      select: {
        paymentId: true,
      },
    });
  }

  checkSubscription(organizationId: string, subscriptionId: string) {
    return this._subscription.model.subscription.findFirst({
      where: {
        organizationId,
        identifier: subscriptionId,
        deletedAt: null,
      },
    });
  }

  deleteSubscriptionByCustomerId(customerId: string) {
    return this._subscription.model.subscription.deleteMany({
      where: {
        isLifetime: false,
        organization: {
          paymentId: customerId,
        },
      },
    });
  }

  updateCustomerId(organizationId: string, customerId: string) {
    return this._organization.model.organization.update({
      where: {
        id: organizationId,
      },
      data: {
        paymentId: customerId,
      },
    });
  }

  async getSubscriptionByOrgId(orgId: string) {
    return this._subscription.model.subscription.findFirst({
      where: {
        organizationId: orgId,
      },
    });
  }

  async getSubscriptionByCustomerId(customerId: string) {
    return this._subscription.model.subscription.findFirst({
      where: {
        organization: {
          paymentId: customerId,
        },
      },
    });
  }

  async getOrganizationByCustomerId(customerId: string) {
    return this._organization.model.organization.findFirst({
      where: {
        paymentId: customerId,
      },
    });
  }

  private async persistOrdinarySubscriptionWithClient(
    client: Pick<Prisma.TransactionClient, 'organization' | 'subscription'>,
    isTrailing: boolean,
    identifier: string,
    customerId: string,
    totalChannels: number,
    billing: 'STANDARD' | 'TEAM' | 'PRO' | 'ULTIMATE',
    period: 'MONTHLY' | 'YEARLY',
    cancelAt: number | null
  ) {
    const findOrg = await client.organization.findFirst({
      where: {
        paymentId: customerId,
      },
      select: {
        id: true,
      },
    });

    if (!findOrg) {
      return { applied: false as const };
    }

    const current = await client.subscription.findFirst({
      where: {
        organizationId: findOrg.id,
      },
    });

    const updated = await client.subscription.updateMany({
      where: {
        organizationId: findOrg.id,
        isLifetime: false,
        organization: {
          paymentId: customerId,
        },
      },
      data: {
        subscriptionTier: billing,
        totalChannels,
        period,
        identifier,
        cancelAt: cancelAt ? new Date(cancelAt * 1000) : null,
        deletedAt: null,
      },
    });

    if (updated.count === 0) {
      if (current) {
        return { applied: false as const };
      }

      const created = await client.subscription.createMany({
        data: {
          organizationId: findOrg.id,
          subscriptionTier: billing,
          isLifetime: false,
          totalChannels,
          period,
          cancelAt: cancelAt ? new Date(cancelAt * 1000) : null,
          identifier,
          deletedAt: null,
        },
        skipDuplicates: true,
      });

      if (created.count !== 1) {
        return { applied: false as const };
      }
    }

    await client.organization.update({
      where: {
        id: findOrg.id,
      },
      data: {
        isTrailing,
        allowTrial: false,
      },
    });

    return {
      applied: true as const,
      organizationId: findOrg.id,
      previousTier: current?.subscriptionTier || 'FREE',
    };
  }

  persistOrdinarySubscription(
    transaction: Prisma.TransactionClient,
    isTrailing: boolean,
    identifier: string,
    customerId: string,
    totalChannels: number,
    billing: 'STANDARD' | 'TEAM' | 'PRO' | 'ULTIMATE',
    period: 'MONTHLY' | 'YEARLY',
    cancelAt: number | null
  ) {
    return this.persistOrdinarySubscriptionWithClient(
      transaction,
      isTrailing,
      identifier,
      customerId,
      totalChannels,
      billing,
      period,
      cancelAt
    );
  }

  async deleteOrdinarySubscription(
    transaction: Prisma.TransactionClient,
    customerId: string
  ) {
    const findOrg = await transaction.organization.findFirst({
      where: {
        paymentId: customerId,
      },
      select: {
        id: true,
      },
    });

    if (!findOrg) {
      return { applied: false as const };
    }

    const current = await transaction.subscription.findFirst({
      where: {
        organizationId: findOrg.id,
      },
    });

    if (!current) {
      return {
        applied: false as const,
        organizationId: findOrg.id,
        reconcile: true as const,
      };
    }

    if (current.isLifetime) {
      return { applied: false as const };
    }

    const deleted = await transaction.subscription.deleteMany({
      where: {
        organizationId: findOrg.id,
        isLifetime: false,
        organization: {
          paymentId: customerId,
        },
      },
    });

    if (deleted.count !== 1) {
      const authoritative = await transaction.subscription.findFirst({
        where: {
          organizationId: findOrg.id,
        },
      });

      if (!authoritative) {
        return {
          applied: false as const,
          organizationId: findOrg.id,
          reconcile: true as const,
        };
      }

      return { applied: false as const };
    }

    return {
      applied: true as const,
      organizationId: findOrg.id,
      previousTier: current.subscriptionTier,
      result: deleted,
    };
  }

  async bookkeepSubscriptionWhileBillingDisabled(
    identifier: string,
    customerId: string,
    period: 'MONTHLY' | 'YEARLY',
    cancelAt: number | null
  ) {
    const findOrg = await this.getOrganizationByCustomerId(customerId);
    if (!findOrg) {
      return;
    }

    const updated = await this._subscription.model.subscription.updateMany({
      where: {
        organizationId: findOrg.id,
        isLifetime: false,
        identifier,
        deletedAt: null,
        organization: {
          paymentId: customerId,
        },
      },
      data: {
        period,
        cancelAt: cancelAt ? new Date(cancelAt * 1000) : null,
      },
    });

    return updated.count === 1 ? true : undefined;
  }

  private async persistLifetimeSubscriptionWithClient(
    client: Pick<
      Prisma.TransactionClient,
      'organization' | 'subscription' | 'usedCodes'
    >,
    isTrailing: boolean,
    identifier: string,
    customerId: string,
    totalChannels: number,
    billing: 'STANDARD' | 'TEAM' | 'PRO' | 'ULTIMATE',
    period: 'MONTHLY' | 'YEARLY',
    cancelAt: number | null,
    code: string,
    org?: { id: string }
  ) {
    const findOrg =
      org ||
      (await client.organization.findFirst({
        where: {
          paymentId: customerId,
        },
        select: {
          id: true,
        },
      }));

    if (!findOrg) {
      return { applied: false as const };
    }

    await client.subscription.upsert({
      where: {
        organizationId: findOrg.id,
      },
      update: {
        subscriptionTier: billing,
        totalChannels,
        period,
        identifier,
        isLifetime: true,
        cancelAt: cancelAt ? new Date(cancelAt * 1000) : null,
        deletedAt: null,
      },
      create: {
        organizationId: findOrg.id,
        subscriptionTier: billing,
        isLifetime: true,
        totalChannels,
        period,
        cancelAt: cancelAt ? new Date(cancelAt * 1000) : null,
        identifier,
        deletedAt: null,
      },
    });

    await client.organization.update({
      where: {
        id: findOrg.id,
      },
      data: {
        isTrailing,
        allowTrial: false,
      },
    });

    await client.usedCodes.create({
      data: {
        code,
        orgId: findOrg.id,
      },
    });

    return {
      applied: true as const,
      organizationId: findOrg.id,
    };
  }

  persistLifetimeSubscription(
    transaction: Prisma.TransactionClient,
    isTrailing: boolean,
    identifier: string,
    customerId: string,
    totalChannels: number,
    billing: 'STANDARD' | 'TEAM' | 'PRO' | 'ULTIMATE',
    period: 'MONTHLY' | 'YEARLY',
    cancelAt: number | null,
    code: string,
    org?: { id: string }
  ) {
    return this.persistLifetimeSubscriptionWithClient(
      transaction,
      isTrailing,
      identifier,
      customerId,
      totalChannels,
      billing,
      period,
      cancelAt,
      code,
      org
    );
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
    org?: { id: string }
  ) {
    if (!code) {
      return this.persistOrdinarySubscriptionWithClient(
        {
          organization: this._organization.model.organization,
          subscription: this._subscription.model.subscription,
        } as unknown as Pick<
          Prisma.TransactionClient,
          'organization' | 'subscription'
        >,
        isTrailing,
        identifier,
        customerId,
        totalChannels,
        billing,
        period,
        cancelAt
      );
    }

    return this.persistLifetimeSubscriptionWithClient(
      {
        organization: this._organization.model.organization,
        subscription: this._subscription.model.subscription,
        usedCodes: this._usedCodes.model.usedCodes,
      } as unknown as Pick<
        Prisma.TransactionClient,
        'organization' | 'subscription' | 'usedCodes'
      >,
      isTrailing,
      identifier,
      customerId,
      totalChannels,
      billing,
      period,
      cancelAt,
      code,
      org
    );
  }

  getSubscriptionByIdentifier(identifier: string) {
    return this._subscription.model.subscription.findFirst({
      where: {
        identifier,
        deletedAt: null,
      },
      include: {
        organization: true,
      },
    });
  }

  getSubscription(organizationId: string) {
    return this._subscription.model.subscription.findFirst({
      where: {
        organizationId,
        deletedAt: null,
      },
    });
  }

  async getCreditsFrom(
    organizationId: string,
    from: dayjs.Dayjs,
    type = 'ai_images'
  ) {
    const load = await this._credits.model.credits.groupBy({
      by: ['organizationId'],
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

    return load?.[0]?._sum?.credits || 0;
  }

  async useCredit<T>(
    org: Organization,
    type = 'ai_images',
    func: () => Promise<T>
  ) {
    const data = await this._credits.model.credits.create({
      data: {
        organizationId: org.id,
        credits: 1,
        type,
      },
    });

    try {
      return await func();
    } catch (err) {
      await this._credits.model.credits.delete({
        where: {
          id: data.id,
        },
      });
      throw err;
    }
  }

  setCustomerId(orgId: string, customerId: string) {
    return this._organization.model.organization.update({
      where: {
        id: orgId,
      },
      data: {
        paymentId: customerId,
      },
    });
  }
}
