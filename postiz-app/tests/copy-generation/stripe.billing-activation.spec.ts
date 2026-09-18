import { BillingController } from '../../apps/backend/src/api/routes/billing.controller';
import { UsersController } from '../../apps/backend/src/api/routes/users.controller';
import { StripeController } from '../../apps/backend/src/api/routes/stripe.controller';
import { SubscriptionRepository } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.repository';
import { SubscriptionService } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service';
import { StripeService } from '@gitroom/nestjs-libraries/services/stripe.service';
import { pricing } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/pricing';

const originalBillingEnabled = process.env.BILLING_ENABLED;
const originalSigningKey = process.env.STRIPE_SIGNING_KEY;

const setBillingEnabled = (value: string | undefined) => {
  if (value === undefined) {
    delete process.env.BILLING_ENABLED;
    return;
  }
  process.env.BILLING_ENABLED = value;
};

const makeEvent = (
  type:
    | 'customer.subscription.created'
    | 'customer.subscription.updated'
    | 'customer.subscription.deleted',
  status = 'active',
  uniqueId = 'unique_1'
) =>
  ({
    type,
    data: {
      object: {
        id: 'sub_1',
        customer: 'cus_1',
        status,
        cancel_at: null,
        metadata: {
          service: 'gitroom',
          uniqueId,
          billing: 'STANDARD',
          period: 'MONTHLY',
        },
      },
    },
  }) as any;

type SubscriptionState = {
  id: string;
  organizationId: string;
  subscriptionTier: 'STANDARD' | 'TEAM' | 'PRO' | 'ULTIMATE';
  identifier: string | null;
  cancelAt: Date | null;
  period: 'MONTHLY' | 'YEARLY';
  totalChannels: number;
  isLifetime: boolean;
  deletedAt: Date | null;
};

const normalSubscription = (): SubscriptionState => ({
  id: 'stored_subscription',
  organizationId: 'org_1',
  subscriptionTier: 'PRO',
  identifier: 'unique_1',
  cancelAt: null,
  period: 'YEARLY',
  totalChannels: 40,
  isLifetime: false,
  deletedAt: null,
});

const lifetimeSubscription = (): SubscriptionState => ({
  ...normalSubscription(),
  subscriptionTier: 'ULTIMATE',
  identifier: 'lifetime_identifier',
  totalChannels: 1000,
  isLifetime: true,
});

const makeHarness = (
  initialSubscription: SubscriptionState | null = normalSubscription()
) => {
  let subscriptionState = initialSubscription
    ? { ...initialSubscription }
    : null;
  let beforeUpdateMany:
    | (() => void | Promise<void>)
    | undefined;
  let beforeDeleteMany:
    | (() => void | Promise<void>)
    | undefined;
  const organizationState = {
    id: 'org_1',
    name: 'Example org',
    paymentId: 'cus_1',
    allowTrial: true,
    isTrailing: true,
  };

  const subscriptionModel = {
    findFirst: jest.fn(async ({ where }: any) => {
      if (!subscriptionState) {
        return null;
      }
      if (
        where?.organizationId &&
        where.organizationId !== organizationState.id
      ) {
        return null;
      }
      if (
        where?.organization?.paymentId &&
        where.organization.paymentId !== organizationState.paymentId
      ) {
        return null;
      }
      if (
        where?.identifier &&
        where.identifier !== subscriptionState.identifier
      ) {
        return null;
      }
      if (where?.deletedAt === null && subscriptionState.deletedAt !== null) {
        return null;
      }
      return { ...subscriptionState };
    }),
    upsert: jest.fn(async ({ update, create }: any) => {
      subscriptionState = subscriptionState
        ? { ...subscriptionState, ...update }
        : {
            id: 'stored_subscription',
            ...create,
          };
      return subscriptionState;
    }),
    update: jest.fn(async ({ data }: any) => {
      if (!subscriptionState) {
        throw new Error('Cannot update a missing subscription');
      }
      subscriptionState = { ...subscriptionState, ...data };
      return subscriptionState;
    }),
    updateMany: jest.fn(async ({ where, data }: any) => {
      if (beforeUpdateMany) {
        const hook = beforeUpdateMany;
        beforeUpdateMany = undefined;
        await hook();
      }

      if (!subscriptionState) {
        return { count: 0 };
      }
      if (
        where?.organizationId &&
        where.organizationId !== subscriptionState.organizationId
      ) {
        return { count: 0 };
      }
      if (where?.isLifetime === false && subscriptionState.isLifetime) {
        return { count: 0 };
      }
      if (
        where?.identifier &&
        where.identifier !== subscriptionState.identifier
      ) {
        return { count: 0 };
      }
      if (where?.deletedAt === null && subscriptionState.deletedAt !== null) {
        return { count: 0 };
      }
      if (
        where?.organization?.paymentId &&
        where.organization.paymentId !== organizationState.paymentId
      ) {
        return { count: 0 };
      }

      subscriptionState = { ...subscriptionState, ...data };
      return { count: 1 };
    }),
    createMany: jest.fn(async ({ data }: any) => {
      if (subscriptionState) {
        return { count: 0 };
      }

      subscriptionState = {
        id: 'stored_subscription',
        ...data,
      };
      return { count: 1 };
    }),
    deleteMany: jest.fn(async ({ where }: any = {}) => {
      if (beforeDeleteMany) {
        const hook = beforeDeleteMany;
        beforeDeleteMany = undefined;
        await hook();
      }

      if (!subscriptionState) {
        return { count: 0 };
      }
      if (
        where?.organizationId &&
        where.organizationId !== subscriptionState.organizationId
      ) {
        return { count: 0 };
      }
      if (where?.isLifetime === false && subscriptionState.isLifetime) {
        return { count: 0 };
      }
      if (
        where?.organization?.paymentId &&
        where.organization.paymentId !== organizationState.paymentId
      ) {
        return { count: 0 };
      }

      subscriptionState = null;
      return { count: 1 };
    }),
  };

  const organizationModel = {
    findFirst: jest.fn(async ({ where }: any) => {
      if (
        where?.paymentId &&
        where.paymentId !== organizationState.paymentId
      ) {
        return null;
      }
      if (where?.id && where.id !== organizationState.id) {
        return null;
      }
      return { ...organizationState };
    }),
    update: jest.fn(async ({ data }: any) => {
      Object.assign(organizationState, data);
      return { ...organizationState };
    }),
  };

  const subscriptionRepository = new SubscriptionRepository(
    { model: { subscription: subscriptionModel } } as any,
    { model: { organization: organizationModel } } as any,
    { model: { user: {} } } as any,
    { model: { credits: {} } } as any,
    {
      model: {
        usedCodes: {
          create: jest.fn(),
          findFirst: jest.fn(),
        },
      },
    } as any
  );

  const integrations = Array.from({ length: 40 }, (_, index) => ({
    id: 'integration_' + index,
    disabled: false,
  }));
  const integrationService = {
    getIntegrationsList: jest.fn().mockResolvedValue(integrations),
    disableIntegrations: jest.fn().mockResolvedValue(undefined),
    changeActiveCron: jest.fn().mockResolvedValue(undefined),
  };
  const entitlementOrganizationService = {
    disableOrEnableNonSuperAdminUsers: jest.fn().mockResolvedValue(undefined),
  };

  const transactionClient = {
    subscription: subscriptionModel,
    organization: organizationModel,
  };
  const prismaTransaction = {
    model: {
      $transaction: jest.fn(async (operation: any) =>
        operation(transactionClient)
      ),
    },
  };

  const subscriptionService = new SubscriptionService(
    subscriptionRepository,
    integrationService as any,
    entitlementOrganizationService as any,
    prismaTransaction as any
  );

  const stripeOrganizationService = {
    getOrgByCustomerId: jest.fn().mockResolvedValue({ allowTrial: false }),
    getOrgById: jest.fn().mockImplementation(async () => ({
      ...organizationState,
    })),
    getTeam: jest.fn().mockResolvedValue({
      users: [{ user: { email: 'owner@example.com' } }],
    }),
  };
  const stripeUserService = {
    getUserById: jest.fn().mockResolvedValue({
      id: 'user_1',
      email: 'owner@example.com',
    }),
  };
  const trackService = {
    track: jest.fn(),
  };

  const stripeService = new StripeService(
    subscriptionService,
    stripeOrganizationService as any,
    stripeUserService as any,
    trackService as any
  );

  return {
    subscriptionRepository,
    subscriptionService,
    stripeService,
    subscriptionModel,
    organizationModel,
    integrationService,
    entitlementOrganizationService,
    stripeOrganizationService,
    stripeUserService,
    trackService,
    prismaTransaction,
    setBeforeUpdateMany: (hook: () => void | Promise<void>) => {
      beforeUpdateMany = hook;
    },
    setBeforeDeleteMany: (hook: () => void | Promise<void>) => {
      beforeDeleteMany = hook;
    },
    setSubscription: (state: SubscriptionState | null) => {
      subscriptionState = state ? { ...state } : null;
    },
    getSubscription: () =>
      subscriptionState ? { ...subscriptionState } : null,
    getOrganization: () => ({ ...organizationState }),
  };
};

describe('Stripe S1 billing activation boundary', () => {
  afterAll(() => {
    setBillingEnabled(originalBillingEnabled);
    if (originalSigningKey === undefined) {
      delete process.env.STRIPE_SIGNING_KEY;
    } else {
      process.env.STRIPE_SIGNING_KEY = originalSigningKey;
    }
  });

  it.each([
    ['unset', undefined],
    ['false', 'false'],
    ['invalid', 'not-true'],
  ])(
    'keeps disabled webhook bookkeeping entitlement-neutral when billing is %s',
    async (_label, billingValue) => {
      setBillingEnabled(billingValue);
      const harness = makeHarness();

      await harness.stripeService.createSubscription(
        makeEvent('customer.subscription.created')
      );
      await harness.stripeService.updateSubscription(
        makeEvent('customer.subscription.updated')
      );
      await harness.stripeService.deleteSubscription(
        makeEvent('customer.subscription.deleted')
      );

      expect(harness.getSubscription()).toMatchObject({
        subscriptionTier: 'PRO',
        totalChannels: 40,
        isLifetime: false,
        identifier: 'unique_1',
        period: 'MONTHLY',
        deletedAt: null,
      });
      expect(harness.getOrganization()).toMatchObject({
        allowTrial: true,
        isTrailing: true,
      });
      expect(harness.subscriptionModel.updateMany).toHaveBeenCalledTimes(2);
      expect(harness.subscriptionModel.upsert).not.toHaveBeenCalled();
      expect(harness.subscriptionModel.deleteMany).not.toHaveBeenCalled();
      expect(
        harness.stripeOrganizationService.getOrgByCustomerId
      ).not.toHaveBeenCalled();
      expect(harness.integrationService.getIntegrationsList).not.toHaveBeenCalled();
      expect(harness.integrationService.disableIntegrations).not.toHaveBeenCalled();
      expect(harness.integrationService.changeActiveCron).not.toHaveBeenCalled();
      expect(
        harness.entitlementOrganizationService.disableOrEnableNonSuperAdminUsers
      ).not.toHaveBeenCalled();
    }
  );

  it.each([
    ['unset', undefined],
    ['false', 'false'],
    ['invalid', 'not-true'],
  ])(
    'preserves lifetime subscription integrity while billing is %s',
    async (_label, billingValue) => {
      setBillingEnabled(billingValue);
      const harness = makeHarness(lifetimeSubscription());

      await harness.stripeService.createSubscription(
        makeEvent('customer.subscription.created')
      );
      await harness.stripeService.updateSubscription(
        makeEvent('customer.subscription.updated')
      );
      await harness.stripeService.deleteSubscription(
        makeEvent('customer.subscription.deleted')
      );

      expect(harness.getSubscription()).toEqual(lifetimeSubscription());
      expect(harness.subscriptionModel.updateMany).toHaveBeenCalledTimes(2);
      expect(harness.subscriptionModel.upsert).not.toHaveBeenCalled();
      expect(harness.subscriptionModel.deleteMany).not.toHaveBeenCalled();
    }
  );

  it('preserves a lifetime subscription on an enabled deletion webhook and at repository persistence', async () => {
    setBillingEnabled('true');
    const harness = makeHarness(lifetimeSubscription());

    await harness.stripeService.deleteSubscription(
      makeEvent('customer.subscription.deleted')
    );

    expect(harness.getSubscription()).toEqual(lifetimeSubscription());
    expect(harness.subscriptionModel.deleteMany).not.toHaveBeenCalled();

    await expect(
      harness.subscriptionRepository.deleteSubscriptionByCustomerId('cus_1')
    ).resolves.toEqual({ count: 0 });
    expect(harness.getSubscription()).toEqual(lifetimeSubscription());
    expect(harness.subscriptionModel.deleteMany).toHaveBeenCalledWith({
      where: {
        isLifetime: false,
        organization: {
          paymentId: 'cus_1',
        },
      },
    });
  });

  it('still deletes an ordinary non-lifetime subscription on an enabled deletion webhook', async () => {
    setBillingEnabled('true');
    const harness = makeHarness(normalSubscription());

    await harness.stripeService.deleteSubscription(
      makeEvent('customer.subscription.deleted')
    );

    expect(harness.getSubscription()).toBeNull();
    expect(harness.subscriptionModel.deleteMany).toHaveBeenCalledWith({
      where: {
        isLifetime: false,
        organization: {
          paymentId: 'cus_1',
        },
      },
    });
  });

  it('does not let sequential ordinary persistence alter an existing lifetime subscription', async () => {
    const harness = makeHarness(lifetimeSubscription());

    await expect(
      harness.subscriptionRepository.createOrUpdateSubscription(
        false,
        'stripe_identifier',
        'cus_1',
        5,
        'STANDARD',
        'MONTHLY',
        null
      )
    ).resolves.toEqual({ applied: false });

    expect(harness.subscriptionModel.updateMany).toHaveBeenCalledTimes(1);
    expect(harness.subscriptionModel.upsert).not.toHaveBeenCalled();
    expect(harness.organizationModel.update).not.toHaveBeenCalled();
    expect(harness.getSubscription()).toEqual(lifetimeSubscription());
  });

  it('prevents an enabled ordinary Stripe update from overwriting a concurrent lifetime conversion', async () => {
    setBillingEnabled('true');
    const harness = makeHarness(normalSubscription());
    const wonLifetime = {
      ...lifetimeSubscription(),
      period: 'YEARLY' as const,
      cancelAt: new Date('2030-01-01T00:00:00.000Z'),
      deletedAt: null,
    };

    harness.setBeforeUpdateMany(() => {
      harness.setSubscription(wonLifetime);
    });

    await harness.stripeService.updateSubscription(
      makeEvent('customer.subscription.updated')
    );

    expect(harness.getSubscription()).toEqual(wonLifetime);
    expect(harness.integrationService.getIntegrationsList).not.toHaveBeenCalled();
    expect(harness.integrationService.disableIntegrations).not.toHaveBeenCalled();
    expect(
      harness.entitlementOrganizationService.disableOrEnableNonSuperAdminUsers
    ).not.toHaveBeenCalled();
    expect(harness.integrationService.changeActiveCron).not.toHaveBeenCalled();
    expect(harness.organizationModel.update).not.toHaveBeenCalled();
  });

  it('prevents enabled deletion side effects when a concurrent lifetime conversion wins', async () => {
    setBillingEnabled('true');
    const harness = makeHarness(normalSubscription());
    const wonLifetime = {
      ...lifetimeSubscription(),
      cancelAt: new Date('2030-02-01T00:00:00.000Z'),
    };

    harness.setBeforeDeleteMany(() => {
      harness.setSubscription(wonLifetime);
    });

    await harness.stripeService.deleteSubscription(
      makeEvent('customer.subscription.deleted')
    );

    expect(harness.getSubscription()).toEqual(wonLifetime);
    expect(harness.integrationService.getIntegrationsList).not.toHaveBeenCalled();
    expect(harness.integrationService.disableIntegrations).not.toHaveBeenCalled();
    expect(
      harness.entitlementOrganizationService.disableOrEnableNonSuperAdminUsers
    ).not.toHaveBeenCalled();
    expect(harness.integrationService.changeActiveCron).not.toHaveBeenCalled();
  });

  it('prevents disabled bookkeeping from mutating a concurrent lifetime conversion', async () => {
    setBillingEnabled('false');
    const harness = makeHarness(normalSubscription());
    const wonLifetime = {
      ...lifetimeSubscription(),
      identifier: 'unique_1',
      period: 'YEARLY' as const,
      cancelAt: new Date('2030-03-01T00:00:00.000Z'),
    };

    harness.setBeforeUpdateMany(() => {
      harness.setSubscription(wonLifetime);
    });

    await harness.stripeService.updateSubscription(
      makeEvent('customer.subscription.updated')
    );

    expect(harness.getSubscription()).toEqual(wonLifetime);
    expect(harness.organizationModel.update).not.toHaveBeenCalled();
    expect(harness.integrationService.getIntegrationsList).not.toHaveBeenCalled();
    expect(harness.integrationService.disableIntegrations).not.toHaveBeenCalled();
    expect(
      harness.entitlementOrganizationService.disableOrEnableNonSuperAdminUsers
    ).not.toHaveBeenCalled();
    expect(harness.integrationService.changeActiveCron).not.toHaveBeenCalled();
  });

  it('creates an ordinary non-lifetime subscription when billing is enabled and none exists', async () => {
    setBillingEnabled('true');
    const harness = makeHarness(null);

    await harness.stripeService.createSubscription(
      makeEvent('customer.subscription.created')
    );

    expect(harness.subscriptionModel.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skipDuplicates: true,
      })
    );
    expect(harness.getSubscription()).toMatchObject({
      organizationId: 'org_1',
      subscriptionTier: 'STANDARD',
      totalChannels: 5,
      identifier: 'unique_1',
      period: 'MONTHLY',
      isLifetime: false,
      deletedAt: null,
    });
    expect(harness.getOrganization()).toMatchObject({
      allowTrial: false,
      isTrailing: false,
    });
  });

  it('does not link a new unvalidated subscription to existing paid state while billing is disabled', async () => {
    setBillingEnabled('false');
    const harness = makeHarness({
      ...normalSubscription(),
      identifier: 'existing_identifier',
    });

    await expect(
      harness.stripeService.createSubscription(
        makeEvent(
          'customer.subscription.created',
          'incomplete',
          'unvalidated_identifier'
        )
      )
    ).resolves.toBeUndefined();

    expect(harness.getSubscription()).toMatchObject({
      identifier: 'existing_identifier',
      subscriptionTier: 'PRO',
      totalChannels: 40,
      isLifetime: false,
    });
    expect(harness.subscriptionModel.updateMany).toHaveBeenCalledTimes(1);
    await expect(
      harness.subscriptionRepository.checkSubscription(
        'org_1',
        'unvalidated_identifier'
      )
    ).resolves.toBeNull();
  });

  it('does not persist disabled incomplete lifecycle state as later paid entitlement', async () => {
    setBillingEnabled('false');
    const harness = makeHarness(null);

    await expect(
      harness.stripeService.createSubscription(
        makeEvent('customer.subscription.created', 'incomplete')
      )
    ).resolves.toBeUndefined();

    expect(harness.getSubscription()).toBeNull();
    expect(harness.getOrganization()).toMatchObject({
      allowTrial: true,
      isTrailing: true,
    });
    expect(harness.subscriptionModel.upsert).not.toHaveBeenCalled();

    setBillingEnabled('true');
    await expect(
      harness.stripeService.createSubscription(
        makeEvent('customer.subscription.created', 'incomplete')
      )
    ).resolves.toEqual({ ok: false });

    expect(harness.getSubscription()).toBeNull();
  });

  it('preserves billing-enabled webhook behavior', async () => {
    setBillingEnabled('true');
    const harness = makeHarness();

    await harness.stripeService.createSubscription(
      makeEvent('customer.subscription.created')
    );
    await harness.stripeService.updateSubscription(
      makeEvent('customer.subscription.updated')
    );
    await harness.stripeService.deleteSubscription(
      makeEvent('customer.subscription.deleted')
    );

    expect(
      harness.stripeOrganizationService.getOrgByCustomerId
    ).toHaveBeenCalledTimes(2);
    expect(harness.subscriptionModel.updateMany).toHaveBeenCalledTimes(2);
    expect(harness.subscriptionModel.upsert).not.toHaveBeenCalled();
    expect(harness.subscriptionModel.deleteMany).toHaveBeenCalledTimes(1);
    expect(harness.integrationService.disableIntegrations).toHaveBeenCalledTimes(
      3
    );
    expect(harness.integrationService.changeActiveCron).toHaveBeenCalledWith(
      'org_1'
    );
    expect(
      harness.entitlementOrganizationService.disableOrEnableNonSuperAdminUsers
    ).toHaveBeenCalled();
    expect(harness.getSubscription()).toBeNull();
    expect(harness.getOrganization()).toMatchObject({
      allowTrial: false,
      isTrailing: false,
    });
  });

  it.each([
    ['unset', undefined],
    ['false', 'false'],
    ['invalid', 'not-true'],
  ])(
    'rejects authenticated checkout creation when billing is %s',
    async (_label, billingValue) => {
      setBillingEnabled(billingValue);
      const harness = makeHarness();
      const body = {
        billing: 'STANDARD',
        period: 'MONTHLY',
      } as any;

      await expect(
        harness.stripeService.subscribe(
          'track_1',
          'org_1',
          'user_1',
          body,
          true
        )
      ).rejects.toThrow('Billing is disabled');

      expect(harness.stripeOrganizationService.getOrgById).not.toHaveBeenCalled();
      expect(harness.stripeOrganizationService.getTeam).not.toHaveBeenCalled();
    }
  );

  it('fails closed before every live Stripe mutation entrypoint while billing is disabled', async () => {
    setBillingEnabled('false');
    const body = {
      billing: 'STANDARD',
      period: 'MONTHLY',
    } as any;
    const organization = {
      id: 'org_1',
      name: 'Example org',
      paymentId: null,
    } as any;

    const actions: Array<
      (harness: ReturnType<typeof makeHarness>) => Promise<unknown>
    > = [
      (h) => h.stripeService.createOrGetCustomer(organization),
      (h) =>
        h.stripeService.embedded(
          'track_1',
          'org_1',
          'user_1',
          body,
          true
        ),
      (h) =>
        h.stripeService.subscribe(
          'track_1',
          'org_1',
          'user_1',
          body,
          true
        ),
      (h) => h.stripeService.prorate('org_1', body),
      (h) => h.stripeService.setToCancel('org_1'),
      (h) => h.stripeService.createBillingPortalLink('cus_1'),
      (h) => h.stripeService.finishTrial('cus_1'),
      (h) => h.stripeService.applyDiscount('cus_1'),
      (h) => h.stripeService.refundCharges('org_1', ['ch_1']),
      (h) => h.stripeService.cancelSubscription('org_1'),
      (h) => h.stripeService.lifetimeDeal('org_1', 'code'),
    ];

    for (const action of actions) {
      const harness = makeHarness();
      await expect(action(harness)).rejects.toThrow('Billing is disabled');
      expect(harness.stripeOrganizationService.getOrgById).not.toHaveBeenCalled();
      expect(harness.stripeOrganizationService.getTeam).not.toHaveBeenCalled();
    }
  });

  it('fails closed at authenticated billing routes before route-local side effects', async () => {
    setBillingEnabled('false');
    const harness = makeHarness();
    const notificationService = {
      sendEmail: jest.fn(),
    };
    const nowpayments = {
      createPaymentPage: jest.fn(),
    };
    const controller = new BillingController(
      harness.subscriptionService,
      harness.stripeService,
      notificationService as any,
      nowpayments as any
    );
    const org = {
      id: 'org_1',
      name: 'Example org',
      allowTrial: true,
    } as any;
    const user = {
      id: 'user_1',
      email: 'owner@example.com',
      isSuperAdmin: true,
    } as any;
    const body = {
      billing: 'STANDARD',
      period: 'MONTHLY',
    } as any;
    const req = {
      cookies: {
        track: 'track_1',
      },
    } as any;

    expect(() => controller.subscribe(org, user, body, req)).toThrow(
      'Billing is disabled'
    );
    expect(() => controller.embedded(org, user, body, req)).toThrow(
      'Billing is disabled'
    );
    await expect(
      controller.cancel(org, user, { feedback: 'test' })
    ).rejects.toThrow('Billing is disabled');
    await expect(
      controller.addSubscription({ subscription: 'STANDARD' }, user, org)
    ).rejects.toThrow('Billing is disabled');
    await expect(controller.crypto(org)).rejects.toThrow('Billing is disabled');

    await expect(
      harness.subscriptionService.lifeTime('org_1', 'crypto_code', 'PRO')
    ).resolves.toBe(false);
    await expect(
      harness.subscriptionService.addSubscription(
        'org_1',
        'user_1',
        'STANDARD'
      )
    ).resolves.toBe(false);

    expect(notificationService.sendEmail).not.toHaveBeenCalled();
    expect(nowpayments.createPaymentPage).not.toHaveBeenCalled();
    expect(harness.subscriptionModel.upsert).not.toHaveBeenCalled();
    expect(harness.organizationModel.update).not.toHaveBeenCalled();
  });

  it.each([
    ['unset', undefined],
    ['false', 'false'],
    ['invalid', 'not-true'],
  ])(
    '/user/self exposes the disabled capability baseline instead of a persisted tier when billing is %s',
    async (_label, billingValue) => {
      setBillingEnabled(billingValue);
      const harness = makeHarness();
      const controller = new UsersController(
        harness.subscriptionService,
        harness.stripeService,
        {} as any,
        {} as any,
        {} as any,
        {} as any
      );
      const organization = {
        ...harness.getOrganization(),
        subscription: {
          subscriptionTier: 'STANDARD',
          totalChannels: 1,
          isLifetime: false,
        },
        users: [{ role: 'ADMIN' }],
        apiKey: 'api_key',
      } as any;

      const result = await controller.getSelf(
        { id: 'user_1', isSuperAdmin: false } as any,
        organization,
        { cookies: {}, headers: {} } as any
      );

      expect(result.tier).toBe('ULTIMATE');
      expect(result.totalChannels).toBe(10000);
      expect(result.isTrailing).toBe(false);
      expect(pricing[result.tier]).toEqual(pricing.ULTIMATE);
    }
  );

  it('/user/self preserves the persisted subscription tier when billing is enabled', async () => {
    setBillingEnabled('true');
    const harness = makeHarness();
    const controller = new UsersController(
      harness.subscriptionService,
      harness.stripeService,
      {} as any,
      {} as any,
      {} as any,
      {} as any
    );
    const organization = {
      ...harness.getOrganization(),
      subscription: {
        subscriptionTier: 'STANDARD',
        totalChannels: 1,
        isLifetime: false,
      },
      users: [{ role: 'ADMIN' }],
      apiKey: 'api_key',
    } as any;

    const result = await controller.getSelf(
      { id: 'user_1', isSuperAdmin: false } as any,
      organization,
      { cookies: {}, headers: {} } as any
    );

    expect(result.tier).toBe('STANDARD');
    expect(result.totalChannels).toBe(1);
    expect(pricing[result.tier]).toEqual(pricing.STANDARD);
  });

  it('rejects an invalid webhook signature before subscription handling', () => {
    setBillingEnabled('false');
    process.env.STRIPE_SIGNING_KEY = 'whsec_test';
    const harness = makeHarness();
    const controller = new StripeController(harness.stripeService);

    expect(() =>
      controller.stripe({
        rawBody: Buffer.from(
          JSON.stringify(makeEvent('customer.subscription.created'))
        ),
        headers: {
          'stripe-signature': 't=1,v1=deadbeef',
        },
      } as any)
    ).toThrow();

    expect(harness.subscriptionModel.upsert).not.toHaveBeenCalled();
    expect(harness.subscriptionModel.updateMany).not.toHaveBeenCalled();
    expect(harness.subscriptionModel.deleteMany).not.toHaveBeenCalled();
  });
});
