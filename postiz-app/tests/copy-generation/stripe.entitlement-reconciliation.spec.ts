import { SubscriptionRepository } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.repository';
import { SubscriptionService } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { AutopostRepository } from '@gitroom/nestjs-libraries/database/prisma/autopost/autopost.repository';

type Tier = 'STANDARD' | 'TEAM' | 'PRO' | 'ULTIMATE';

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
          usedCodes: usedCodesModel,
        });

        if (transactionShouldFail) {
          throw new Error('transaction failed before commit');
        }

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
