import { StripeService } from '@gitroom/nestjs-libraries/services/stripe.service';
const mockLaunchHistory = jest.fn();
jest.mock('stripe', () => ({ __esModule: true, default: jest.fn(() => ({
  subscriptions: { list: (...args: any[]) => mockLaunchHistory(...args) },
})) }));
import { SubscriptionRepository } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.repository';
import { SubscriptionService } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { AutopostRepository } from '@gitroom/nestjs-libraries/database/prisma/autopost/autopost.repository';

type Tier = 'STANDARD' | 'TEAM' | 'PRO' | 'ULTIMATE' | 'LAUNCH_V1';

type StoredSubscription = {
  id: string;
  organizationId: string;
  subscriptionTier: Tier;
  identifier: string | null;
  cancelAt: Date | null;
  period: 'MONTHLY' | 'YEARLY';
  totalChannels: number;
  isLifetime: boolean;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type IntegrationState = {
  id: string;
  disabled: boolean;
  disabledByBilling: boolean;
};

const ordinary = (tier: Tier = 'PRO', totalChannels = 30): StoredSubscription => ({
  id: 'sub_1',
  organizationId: 'org_1',
  subscriptionTier: tier,
  identifier: 'stripe_1',
  cancelAt: null,
  period: 'MONTHLY',
  totalChannels,
  isLifetime: false,
  deletedAt: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
});

const lifetime = (): StoredSubscription => ({
  ...ordinary('ULTIMATE', 100),
  identifier: 'lifetime_1',
  period: 'YEARLY',
  isLifetime: true,
  updatedAt: new Date('2026-01-02T00:00:00.000Z'),
});

const cloneSubscription = (value: StoredSubscription | null) =>
  value
    ? {
        ...value,
        cancelAt: value.cancelAt ? new Date(value.cancelAt) : null,
        createdAt: new Date(value.createdAt),
        updatedAt: new Date(value.updatedAt),
      }
    : null;

const makeReconciliationHarness = (
  initialSubscription: StoredSubscription | null = ordinary(),
  integrationCount = 8
) => {
  let subscriptionState = cloneSubscription(initialSubscription);
  let organizationState = {
    id: 'org_1',
    paymentId: 'cus_1',
    allowTrial: true,
    isTrailing: true,
  };
  let integrations: IntegrationState[] = Array.from(
    { length: integrationCount },
    (_, index) => ({
      id: `integration_${index}`,
      disabled: false,
      disabledByBilling: false,
    })
  );
  let transactionShouldFail = false;
  let afterCommit: undefined | (() => void | Promise<void>);
  let partialIntegrationFailure = false;
  let integrationReadFailure = false;
  let teamFailure = false;
  let temporalStopFailure = false;
  let teamDisabled = false;

  const makeSubscriptionModel = (
    getState: () => StoredSubscription | null,
    setState: (value: StoredSubscription | null) => void
  ) => ({
    findFirst: jest.fn(async ({ where }: any = {}) => {
      const current = getState();
      if (!current) {
        return null;
      }
      if (where?.organizationId && where.organizationId !== current.organizationId) {
        return null;
      }
      if (where?.identifier && where.identifier !== current.identifier) {
        return null;
      }
      if (where?.deletedAt === null && current.deletedAt !== null) {
        return null;
      }
      if (
        where?.organization?.paymentId &&
        where.organization.paymentId !== organizationState.paymentId
      ) {
        return null;
      }
      return cloneSubscription(current);
    }),
    updateMany: jest.fn(async ({ where, data }: any) => {
      const current = getState();
      if (!current) {
        return { count: 0 };
      }
      if (where?.organizationId && where.organizationId !== current.organizationId) {
        return { count: 0 };
      }
      if (where?.NOT?.subscriptionTier === current.subscriptionTier) return { count: 0 };
      if (where?.subscriptionTier && where.subscriptionTier !== current.subscriptionTier) return { count: 0 };
      if (where?.isLifetime === false && current.isLifetime) {
        return { count: 0 };
      }
      if (
        where?.organization?.paymentId &&
        where.organization.paymentId !== organizationState.paymentId
      ) {
        return { count: 0 };
      }
      setState({
        ...current,
        ...data,
        updatedAt: new Date(current.updatedAt.getTime() + 1000),
      });
      return { count: 1 };
    }),
    createMany: jest.fn(async ({ data }: any) => {
      if (getState()) {
        return { count: 0 };
      }
      const now = new Date('2026-01-03T00:00:00.000Z');
      setState({
        id: 'sub_created',
        createdAt: now,
        updatedAt: now,
        ...data,
      });
      return { count: 1 };
    }),
    deleteMany: jest.fn(async ({ where }: any = {}) => {
      const current = getState();
      if (!current) {
        return { count: 0 };
      }
      if (where?.organizationId && where.organizationId !== current.organizationId) {
        return { count: 0 };
      }
      if (where?.NOT?.subscriptionTier === current.subscriptionTier) return { count: 0 };
      if (where?.subscriptionTier && where.subscriptionTier !== current.subscriptionTier) return { count: 0 };
      if (where?.isLifetime === false && current.isLifetime) {
        return { count: 0 };
      }
      setState(null);
      return { count: 1 };
    }),
    upsert: jest.fn(async ({ update, create }: any) => {
      const current = getState();
      const now = new Date('2026-01-04T00:00:00.000Z');
      const next = current
        ? {
            ...current,
            ...update,
            updatedAt: now,
          }
        : {
            id: 'sub_lifetime',
            createdAt: now,
            updatedAt: now,
            ...create,
          };
      setState(next as StoredSubscription);
      return cloneSubscription(next as StoredSubscription);
    }),
  });

  const canonicalSubscriptionModel = makeSubscriptionModel(
    () => subscriptionState,
    (value) => {
      subscriptionState = cloneSubscription(value);
    }
  );

  const organizationModel = {
    findFirst: jest.fn(async ({ where }: any) => {
      if (where?.paymentId && where.paymentId !== organizationState.paymentId) {
        return null;
      }
      return { ...organizationState };
    }),
    update: jest.fn(async ({ data }: any) => {
      organizationState = { ...organizationState, ...data };
      return { ...organizationState };
    }),
  };

  let claimedCode: any = null;
  const usedCodesModel = {
    findFirst: jest.fn(),
    create: jest.fn(async ({ data }: any) => data),
  };

  const subscriptionRepository = new SubscriptionRepository(
    { model: { subscription: canonicalSubscriptionModel } } as any,
    { model: { organization: organizationModel } } as any,
    { model: { user: {} } } as any,
    { model: { credits: {} } } as any,
    { model: { usedCodes: usedCodesModel } } as any
  );

  const integrationService = {
    getIntegrationsList: jest.fn(async () => {
      if (integrationReadFailure) {
        integrationReadFailure = false;
        throw new Error('integration read failed');
      }
      return integrations.map((integration) => ({ ...integration }));
    }),
    disableIntegrations: jest.fn(async (_orgId: string, count: number) => {
      const enabled = integrations.filter((integration) => !integration.disabled);
      if (partialIntegrationFailure) {
        partialIntegrationFailure = false;
        if (enabled[0]) {
          enabled[0].disabled = true;
          enabled[0].disabledByBilling = true;
        }
        throw new Error('partial integration failure');
      }
      for (const integration of enabled.slice(0, count)) {
        integration.disabled = true;
        integration.disabledByBilling = true;
      }
    }),
    enableBillingDisabledIntegrations: jest.fn(
      async (_orgId: string, count: number) => {
        const billingDisabled = integrations.filter(
          (integration) =>
            integration.disabled && integration.disabledByBilling
        );
        for (const integration of billingDisabled.slice(0, count)) {
          integration.disabled = false;
          integration.disabledByBilling = false;
        }
      }
    ),
    changeActiveCron: jest.fn(async () => {
      if (temporalStopFailure) {
        temporalStopFailure = false;
        throw new Error('temporal stop failed');
      }
      return true;
    }),
    restoreActiveCron: jest.fn(async () => true),
  };

  const organizationService = {
    enforceSingleEnabledOwner: jest.fn().mockResolvedValue({ count: 1 }),
    disableOrEnableNonSuperAdminUsers: jest.fn(
      async (_orgId: string, disabled: boolean) => {
        if (teamFailure) {
          teamFailure = false;
          throw new Error('team reconciliation failed');
        }
        teamDisabled = disabled;
        return { count: 1 };
      }
    ),
  };

  const prismaTransaction = {
    model: {
      $transaction: jest.fn(async (operation: any) => {
        let stagedSubscription = cloneSubscription(subscriptionState);
        let stagedOrganization = { ...organizationState };
        let stagedClaim = claimedCode;
        const stagedSubscriptionModel = makeSubscriptionModel(
          () => stagedSubscription,
          (value) => {
            stagedSubscription = cloneSubscription(value);
          }
        );
        const stagedOrganizationModel = {
          findFirst: jest.fn(async ({ where }: any) => {
            if (
              where?.paymentId &&
              where.paymentId !== stagedOrganization.paymentId
            ) {
              return null;
            }
            return { ...stagedOrganization };
          }),
          update: jest.fn(async ({ data }: any) => {
            stagedOrganization = { ...stagedOrganization, ...data };
            return { ...stagedOrganization };
          }),
        };
        const result = await operation({
          subscription: stagedSubscriptionModel,
          organization: stagedOrganizationModel,
          usedCodes: {
            findFirst: jest.fn(async () => stagedClaim),
            create: jest.fn(async ({ data }: any) => {
              stagedClaim = { ...data };
              return usedCodesModel.create({ data });
            }),
          },
          $queryRaw: jest.fn(async () => []),
        });

        if (transactionShouldFail) {
          throw new Error('transaction failed before commit');
        }

        claimedCode = stagedClaim;
        subscriptionState = cloneSubscription(stagedSubscription);
        organizationState = { ...stagedOrganization };

        if (afterCommit) {
          const hook = afterCommit;
          afterCommit = undefined;
          await hook();
        }

        return result;
      }),
    },
  };

  const subscriptionService = new SubscriptionService(
    subscriptionRepository,
    integrationService as any,
    organizationService as any,
    prismaTransaction as any
  );

  return {
    subscriptionService,
    subscriptionRepository,
    integrationService,
    organizationService,
    prismaTransaction,
    usedCodesModel,
    getOrganization: () => ({ ...organizationState }),
    getSubscription: () => cloneSubscription(subscriptionState),
    setSubscription: (value: StoredSubscription | null) => {
      subscriptionState = cloneSubscription(value);
    },
    getIntegrations: () => integrations.map((integration) => ({ ...integration })),
    setIntegrations: (value: IntegrationState[]) => {
      integrations = value.map((integration) => ({ ...integration }));
    },
    getTeamDisabled: () => teamDisabled,
    setTransactionFailure: (value: boolean) => {
      transactionShouldFail = value;
    },
    setAfterCommit: (hook: () => void | Promise<void>) => {
      afterCommit = hook;
    },
    failNextIntegrationRead: () => {
      integrationReadFailure = true;
    },
    failNextIntegrationPartially: () => {
      partialIntegrationFailure = true;
    },
    failNextTeamUpdate: () => {
      teamFailure = true;
    },
    failNextTemporalStop: () => {
      temporalStopFailure = true;
    },
  };
};

describe('Stripe S1 authoritative entitlement reconciliation', () => {
  const originalBillingEnabled = process.env.BILLING_ENABLED;

  beforeEach(() => {
    process.env.BILLING_ENABLED = 'true';
  });

  afterAll(() => {
    if (originalBillingEnabled === undefined) {
      delete process.env.BILLING_ENABLED;
    } else {
      process.env.BILLING_ENABLED = originalBillingEnabled;
    }
  });

  it('launch reconciliation restores only billing-disabled channels without a finite cap and enforces one owner', async () => {
    const harness = makeReconciliationHarness(ordinary('LAUNCH_V1', 0), 0);
    harness.setIntegrations([
      { id: 'enabled', disabled: false, disabledByBilling: false },
      { id: 'billing_disabled', disabled: true, disabledByBilling: true },
      { id: 'manual_disabled', disabled: true, disabledByBilling: false },
    ]);
    await harness.subscriptionService.modifySubscriptionByOrg('org_1', 0, 'LAUNCH_V1');
    expect(harness.getIntegrations()).toEqual([
      { id: 'enabled', disabled: false, disabledByBilling: false },
      { id: 'billing_disabled', disabled: false, disabledByBilling: false },
      { id: 'manual_disabled', disabled: true, disabledByBilling: false },
    ]);
    expect(harness.organizationService.enforceSingleEnabledOwner).toHaveBeenCalledWith('org_1');
    expect(harness.organizationService.disableOrEnableNonSuperAdminUsers).not.toHaveBeenCalled();
    expect(harness.integrationService.changeActiveCron).toHaveBeenCalledWith('org_1');
  });

  it('a lifetime retry after post-commit failure reconciles without redeeming twice', async () => {
    const harness = makeReconciliationHarness(null, 0);
    harness.failNextIntegrationRead();
    const redeem = () => harness.subscriptionService.createOrUpdateSubscription(
      false, 'lifetime_id', 'org_1', 5, 'STANDARD', 'MONTHLY', null, 'same-code', 'org_1'
    );
    await expect(redeem()).rejects.toThrow('integration read failed');
    expect(harness.getSubscription()).toMatchObject({ isLifetime: true, totalChannels: 5 });
    await expect(redeem()).resolves.toBeUndefined();
    expect(harness.usedCodesModel.create).toHaveBeenCalledTimes(1);
    expect(harness.getSubscription()).toMatchObject({ isLifetime: true, totalChannels: 5 });
    expect(harness.integrationService.getIntegrationsList).toHaveBeenCalledTimes(2);
  });

  it('ordinary-first then lifetime-before-reconciliation converges to lifetime entitlements', async () => {
    const harness = makeReconciliationHarness(ordinary('PRO', 30), 8);
    harness.setAfterCommit(() => {
      harness.setSubscription(lifetime());
    });

    await harness.subscriptionService.createOrUpdateSubscription(
      false,
      'stripe_update',
      'cus_1',
      5,
      'STANDARD',
      'MONTHLY',
      null
    );

    expect(harness.getSubscription()).toMatchObject({
      isLifetime: true,
      subscriptionTier: 'ULTIMATE',
    });
    expect(harness.getIntegrations().filter((integration) => integration.disabled)).toHaveLength(0);
    expect(harness.getTeamDisabled()).toBe(false);
    expect(harness.integrationService.changeActiveCron).not.toHaveBeenCalled();
    expect(harness.integrationService.restoreActiveCron).toHaveBeenCalledWith('org_1');
  });

  it('ordinary deletion first then lifetime supersedes before reconciliation', async () => {
    const harness = makeReconciliationHarness(ordinary('PRO', 30), 8);
    harness.setAfterCommit(() => {
      harness.setSubscription(lifetime());
    });

    await harness.subscriptionService.deleteSubscription('cus_1');

    expect(harness.getSubscription()).toMatchObject({
      isLifetime: true,
      subscriptionTier: 'ULTIMATE',
    });
    expect(harness.getIntegrations().filter((integration) => integration.disabled)).toHaveLength(0);
    expect(harness.integrationService.restoreActiveCron).toHaveBeenCalledWith('org_1');
  });

  it('persistence transaction failure produces no entitlement or Temporal side effects', async () => {
    const harness = makeReconciliationHarness(ordinary('PRO', 30), 8);
    harness.setTransactionFailure(true);

    await expect(
      harness.subscriptionService.createOrUpdateSubscription(
        false,
        'stripe_update',
        'cus_1',
        5,
        'STANDARD',
        'MONTHLY',
        null
      )
    ).rejects.toThrow('transaction failed before commit');

    expect(harness.getSubscription()).toMatchObject({
      subscriptionTier: 'PRO',
      totalChannels: 30,
    });
    expect(harness.integrationService.getIntegrationsList).not.toHaveBeenCalled();
    expect(harness.organizationService.disableOrEnableNonSuperAdminUsers).not.toHaveBeenCalled();
    expect(harness.integrationService.changeActiveCron).not.toHaveBeenCalled();
    expect(harness.integrationService.restoreActiveCron).not.toHaveBeenCalled();
  });

  it('a reconciliation failure after commit is retryable against the persisted authoritative tier', async () => {
    const harness = makeReconciliationHarness(ordinary('PRO', 30), 8);
    harness.failNextIntegrationRead();

    await expect(
      harness.subscriptionService.createOrUpdateSubscription(
        false,
        'stripe_update',
        'cus_1',
        5,
        'STANDARD',
        'MONTHLY',
        null
      )
    ).rejects.toThrow('integration read failed');

    expect(harness.getSubscription()).toMatchObject({
      subscriptionTier: 'STANDARD',
      totalChannels: 5,
    });

    await harness.subscriptionService.createOrUpdateSubscription(
      false,
      'stripe_update',
      'cus_1',
      5,
      'STANDARD',
      'MONTHLY',
      null
    );

    expect(harness.getIntegrations().filter((integration) => !integration.disabled)).toHaveLength(5);
    expect(harness.getTeamDisabled()).toBe(true);
    expect(harness.integrationService.changeActiveCron).toHaveBeenCalled();
  });

  it('partial integration failure converges on retry without over-disabling', async () => {
    const harness = makeReconciliationHarness(ordinary('PRO', 30), 8);
    harness.failNextIntegrationPartially();

    await expect(
      harness.subscriptionService.createOrUpdateSubscription(
        false,
        'stripe_update',
        'cus_1',
        5,
        'STANDARD',
        'MONTHLY',
        null
      )
    ).rejects.toThrow('partial integration failure');

    expect(harness.getIntegrations().filter((integration) => !integration.disabled)).toHaveLength(7);

    await harness.subscriptionService.createOrUpdateSubscription(
      false,
      'stripe_update',
      'cus_1',
      5,
      'STANDARD',
      'MONTHLY',
      null
    );

    const finalIntegrations = harness.getIntegrations();
    expect(finalIntegrations.filter((integration) => !integration.disabled)).toHaveLength(5);
    expect(
      finalIntegrations.filter(
        (integration) => integration.disabled && integration.disabledByBilling
      )
    ).toHaveLength(3);
  });

  it('team reconciliation retries even when the subscription tier already equals the target', async () => {
    const harness = makeReconciliationHarness(ordinary('STANDARD', 5), 5);
    harness.failNextTeamUpdate();

    await expect(
      harness.subscriptionService.createOrUpdateSubscription(
        false,
        'stripe_update',
        'cus_1',
        5,
        'STANDARD',
        'MONTHLY',
        null
      )
    ).rejects.toThrow('team reconciliation failed');

    await harness.subscriptionService.createOrUpdateSubscription(
      false,
      'stripe_update',
      'cus_1',
      5,
      'STANDARD',
      'MONTHLY',
      null
    );

    expect(harness.organizationService.disableOrEnableNonSuperAdminUsers).toHaveBeenCalledTimes(2);
    expect(harness.getTeamDisabled()).toBe(true);
  });

  it('Temporal stop failure remains visible and a retry converges', async () => {
    const harness = makeReconciliationHarness(ordinary('STANDARD', 5), 5);
    harness.failNextTemporalStop();

    await expect(
      harness.subscriptionService.createOrUpdateSubscription(
        false,
        'stripe_update',
        'cus_1',
        5,
        'STANDARD',
        'MONTHLY',
        null
      )
    ).rejects.toThrow('temporal stop failed');

    await expect(
      harness.subscriptionService.createOrUpdateSubscription(
        false,
        'stripe_update',
        'cus_1',
        5,
        'STANDARD',
        'MONTHLY',
        null
      )
    ).resolves.toBeUndefined();

    expect(harness.integrationService.changeActiveCron).toHaveBeenCalledTimes(2);
  });

  it('paid/lifetime reconciliation restores only billing-disabled integrations', async () => {
    const harness = makeReconciliationHarness(lifetime(), 0);
    harness.setIntegrations([
      { id: 'enabled', disabled: false, disabledByBilling: false },
      { id: 'billing-disabled', disabled: true, disabledByBilling: true },
      { id: 'user-disabled', disabled: true, disabledByBilling: false },
    ]);

    await harness.subscriptionService.modifySubscriptionByOrg(
      'org_1',
      0,
      'FREE'
    );

    const finalIntegrations = harness.getIntegrations();
    expect(finalIntegrations.find((item) => item.id === 'billing-disabled')).toMatchObject({
      disabled: false,
      disabledByBilling: false,
    });
    expect(finalIntegrations.find((item) => item.id === 'user-disabled')).toMatchObject({
      disabled: true,
      disabledByBilling: false,
    });
  });

  it('a deletion retry after commit-before-reconciliation converges to FREE', async () => {
    const harness = makeReconciliationHarness(ordinary('PRO', 30), 4);
    harness.failNextIntegrationRead();

    await expect(
      harness.subscriptionService.deleteSubscription('cus_1')
    ).rejects.toThrow('integration read failed');

    expect(harness.getSubscription()).toBeNull();

    await expect(
      harness.subscriptionService.deleteSubscription('cus_1')
    ).resolves.toBe(false);

    expect(harness.getIntegrations().filter((integration) => !integration.disabled)).toHaveLength(0);
    expect(harness.getTeamDisabled()).toBe(true);
    expect(harness.integrationService.changeActiveCron).toHaveBeenCalled();
  });

  it('lifetime persistence participates in post-commit entitlement reconciliation', async () => {
    const harness = makeReconciliationHarness(ordinary('STANDARD', 5), 5);

    await harness.subscriptionService.lifeTime('org_1', 'lifetime_code', 'PRO');

    expect(harness.getSubscription()).toMatchObject({
      isLifetime: true,
      subscriptionTier: 'PRO',
      totalChannels: 30,
    });
    expect(harness.getTeamDisabled()).toBe(false);
    expect(harness.integrationService.restoreActiveCron).toHaveBeenCalledWith('org_1');
  });
});

describe('Stripe S1 Temporal/autopost reconciliation contract', () => {
  it('does not start inactive autopost workflows during paid reconciliation', async () => {
    const start = jest.fn().mockResolvedValue(undefined);
    const service = Object.create(IntegrationService.prototype) as any;
    service._autopostsRepository = {
      getAutoposts: jest.fn().mockResolvedValue([
        { id: 'active_1', active: true },
        { id: 'inactive_1', active: false },
      ]),
    };
    service._temporalService = {
      client: {
        getRawClient: () => ({
          workflow: { start },
        }),
      },
    };

    await service.restoreActiveCron('org_1');

    expect(start).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledWith(
      'autoPostWorkflow',
      expect.objectContaining({
        workflowId: 'autopost-active_1',
      })
    );
  });

  it('surfaces Temporal termination failures instead of silently accepting reconciliation', async () => {
    const service = Object.create(IntegrationService.prototype) as any;
    service._autopostsRepository = {
      getAutoposts: jest.fn().mockResolvedValue([
        { id: 'active_1', active: true },
      ]),
    };
    service._temporalService = {
      terminateWorkflow: jest.fn().mockRejectedValue(new Error('temporal unavailable')),
    };

    await expect(service.changeActiveCron('org_1')).rejects.toThrow(
      'temporal unavailable'
    );
  });

  it('relies on the autopost repository contract to exclude deleted workflows', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const repository = new AutopostRepository({
      model: {
        autoPost: {
          findMany,
        },
      },
    } as any);

    await repository.getAutoposts('org_1');

    expect(findMany).toHaveBeenCalledWith({
      where: {
        organizationId: 'org_1',
        deletedAt: null,
      },
    });
  });
});


describe('Launch webhook status authority', () => {
  const saved = process.env.BILLING_ENABLED;
  beforeEach(() => { process.env.BILLING_ENABLED = 'true'; mockLaunchHistory.mockReset(); });
  afterAll(() => { if (saved === undefined) delete process.env.BILLING_ENABLED; else process.env.BILLING_ENABLED = saved; });
  const event = (status: string, id = 'sub_launch', cancelAt: number | null = null) => ({
    type: 'customer.subscription.updated', data: { object: {
      id, customer: 'cus_1', status, cancel_at: cancelAt,
      metadata: { service: 'gitroom', billing: 'LAUNCH_V1', period: 'MONTHLY', uniqueId: id },
      items: { data: [{ quantity: 1, price: { currency: 'usd', type: 'recurring', unit_amount: 900,
        recurring: { interval: 'month', interval_count: 1 }, billing_scheme: 'per_unit',
        lookup_key: 'everywhereposter_launch_v1_monthly', metadata: { plan_version: 'LAUNCH_V1' } } }] },
    } },
  } as any);
  const harness = (initial: StoredSubscription | null = ordinary('LAUNCH_V1', 0)) => {
    const h = makeReconciliationHarness(initial, 2);
    const stripe = new StripeService(h.subscriptionService, {} as any, {} as any, {} as any);
    jest.spyOn(stripe, 'checkValidCard').mockResolvedValue(true);
    return { ...h, stripe };
  };
  const history = (...events: any[]) => mockLaunchHistory.mockResolvedValue({ data: events.map(e => e.data.object), has_more: false });

  it.each(['unpaid', 'paused', 'incomplete_expired'])('revokes %s access and converges on duplicate delivery', async status => {
    const h = harness(); const e = event(status); history(e);
    await h.stripe.updateSubscription(e); await h.stripe.updateSubscription(e);
    expect(h.getSubscription()).toBeNull();
    expect(h.getIntegrations().every(i => i.disabled && i.disabledByBilling)).toBe(true);
    expect(h.getOrganization().isTrailing).toBe(false);
    expect(h.stripe.checkValidCard).not.toHaveBeenCalled();
  });
  it.each(['unpaid', 'paused', 'incomplete_expired', 'incomplete', 'canceled'])('cannot initially grant %s', async status => {
    const h = harness(null); history(event(status));
    await h.stripe.createSubscription(event(status));
    expect(h.getSubscription()).toBeNull();
  });
  it.each(['active', 'trialing', 'past_due'])('restores %s from persisted tier and preserves period-end cancellation', async status => {
    const h = harness(); history(event('unpaid')); await h.stripe.updateSubscription(event('unpaid'));
    history(event(status, 'sub_recovered', 2000000000));
    await h.stripe.updateSubscription(event(status));
    expect(h.getSubscription()).toMatchObject({ subscriptionTier: 'LAUNCH_V1', identifier: 'sub_recovered', cancelAt: new Date(2000000000000) });
    expect(h.getIntegrations().every(i => !i.disabled)).toBe(true);
    expect(h.getOrganization().isTrailing).toBe(status === 'trialing');
  });
  it('ignores delayed grant/revocation payloads in favor of current Stripe state', async () => {
    const h = harness(); history(event('unpaid'));
    await h.stripe.createSubscription(event('active'));
    expect(h.getSubscription()).toBeNull();
    history(event('active', 'sub_new'));
    await h.stripe.updateSubscription(event('unpaid', 'sub_old'));
    await h.stripe.deleteSubscription(event('canceled', 'sub_old'));
    expect(h.getSubscription()).toMatchObject({ subscriptionTier: 'LAUNCH_V1', identifier: 'sub_new' });
    expect(h.getIntegrations().every(i => !i.disabled)).toBe(true);
  });
  it.each([ordinary(), lifetime()])('preserves legacy/lifetime persistence', async initial => {
    const h = harness(initial); history(event('unpaid'));
    await h.stripe.updateSubscription(event('unpaid'));
    await h.stripe.deleteSubscription(event('canceled'));
    expect(h.getSubscription()).toEqual(initial);
    expect(mockLaunchHistory).not.toHaveBeenCalled();
  });
  it('does not let stale legacy update/delete events replace a Launch subscription', async () => {
    const h = harness(); const before = h.getSubscription(); const old = event('active', 'old_legacy');
    old.data.object.metadata.billing = 'PRO'; old.data.object.items.data[0].price.lookup_key = null;
    old.data.object.items.data[0].price.metadata = {};
    await h.stripe.updateSubscription(old); await h.stripe.deleteSubscription(old);
    expect(h.getSubscription()).toEqual(before);
    expect(h.getIntegrations().every(i => !i.disabled)).toBe(true);
  });
  it.each(['unpaid', 'paused', 'incomplete_expired'])('rejects stale legacy grants after %s revocation and still recovers', async status => {
    const h = harness(); history(event(status)); await h.stripe.updateSubscription(event(status));
    const old = event('active', 'old_legacy'); old.data.object.metadata.billing = 'PRO';
    old.data.object.items.data[0].price.lookup_key = null; old.data.object.items.data[0].price.metadata = {};
    await h.stripe.createSubscription(old); await h.stripe.updateSubscription(old);
    expect(h.getSubscription()).toBeNull(); expect(h.getIntegrations().every(i => i.disabled)).toBe(true);
    history(event('active', 'recovered')); await h.stripe.updateSubscription(event(status));
    expect(h.getSubscription()).toMatchObject({ subscriptionTier: 'LAUNCH_V1', identifier: 'recovered' });
    expect(h.getIntegrations().every(i => !i.disabled)).toBe(true);
  });
  it('preserves an initial legacy grant for a customer with no Launch history', async () => {
    const h = harness(null); const legacy = event('active', 'legacy'); legacy.data.object.metadata.billing = 'PRO';
    legacy.data.object.items.data[0].price.lookup_key = null; legacy.data.object.items.data[0].price.metadata = {};
    history(legacy); await h.stripe.createSubscription(legacy);
    expect(h.getSubscription()).toMatchObject({ subscriptionTier: 'PRO', identifier: 'legacy' });
  });
  it.each(['read', 'pagination'])('does not create legacy access on %s verification failure', async failure => {
    const h = harness(null); const old = event('active', 'legacy'); old.data.object.metadata.billing = 'PRO';
    old.data.object.items.data[0].price.lookup_key = null; old.data.object.items.data[0].price.metadata = {};
    if (failure === 'read') mockLaunchHistory.mockRejectedValue(Error('offline read failure'));
    else mockLaunchHistory.mockResolvedValue({ data: [], has_more: true });
    await expect(h.stripe.updateSubscription(old)).rejects.toThrow();
    expect(h.getSubscription()).toBeNull();
  });
  it('makes no read or entitlement changes while billing is disabled', async () => {
    const h = harness(); process.env.BILLING_ENABLED = 'false';
    await h.stripe.updateSubscription(event('unpaid'));
    expect(h.getSubscription()?.subscriptionTier).toBe('LAUNCH_V1');
    expect(mockLaunchHistory).not.toHaveBeenCalled();
  });
  it.each(['read', 'pagination', 'multiple', 'transaction'])('does not mutate on %s failure', async failure => {
    const h = harness(); const before = h.getSubscription(); history(event('unpaid'));
    if (failure === 'read') mockLaunchHistory.mockRejectedValue(Error('offline read failure'));
    if (failure === 'pagination') mockLaunchHistory.mockResolvedValue({ data: [], has_more: true });
    if (failure === 'multiple') history(event('active'), event('trialing', 'second'));
    if (failure === 'transaction') h.setTransactionFailure(true);
    await expect(h.stripe.updateSubscription(event('unpaid'))).rejects.toThrow();
    expect(h.getSubscription()).toEqual(before);
    expect(h.getIntegrations().every(i => !i.disabled)).toBe(true);
  });
  it('retries reconciliation after a revocation commits before a downstream failure', async () => {
    const h = harness(); history(event('unpaid')); h.failNextIntegrationRead();
    await expect(h.stripe.updateSubscription(event('unpaid'))).rejects.toThrow('integration read failed');
    expect(h.getSubscription()).toBeNull();
    await h.stripe.updateSubscription(event('active'));
    expect(h.getSubscription()).toBeNull();
    expect(h.getIntegrations().every(i => i.disabled)).toBe(true);
  });
});
