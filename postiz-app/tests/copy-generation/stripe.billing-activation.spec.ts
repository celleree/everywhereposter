import { BillingController } from '../../apps/backend/src/api/routes/billing.controller';
import { StripeController } from '../../apps/backend/src/api/routes/stripe.controller';
import { SubscriptionRepository } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.repository';
import { SubscriptionService } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service';
import { StripeService } from '@gitroom/nestjs-libraries/services/stripe.service';

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
  status = 'active'
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
          uniqueId: 'unique_1',
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
  identifier: 'existing_identifier',
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
    deleteMany: jest.fn(async () => {
      const count = subscriptionState ? 1 : 0;
      subscriptionState = null;
      return { count };
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

  const subscriptionService = new SubscriptionService(
    subscriptionRepository,
    integrationService as any,
    entitlementOrganizationService as any,
    undefined
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
      expect(harness.subscriptionModel.update).toHaveBeenCalledTimes(2);
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

  it('preserves lifetime subscription integrity while billing is disabled', async () => {
    setBillingEnabled('false');
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
    expect(harness.subscriptionModel.update).not.toHaveBeenCalled();
    expect(harness.subscriptionModel.upsert).not.toHaveBeenCalled();
    expect(harness.subscriptionModel.deleteMany).not.toHaveBeenCalled();
  });

  it('does not let a non-code repository upsert clear an existing lifetime flag', async () => {
    const harness = makeHarness(lifetimeSubscription());

    await harness.subscriptionRepository.createOrUpdateSubscription(
      false,
      'stripe_identifier',
      'cus_1',
      5,
      'STANDARD',
      'MONTHLY',
      null
    );

    const upsert = harness.subscriptionModel.upsert.mock.calls[0][0];
    expect(upsert.update).not.toHaveProperty('isLifetime');
    expect(harness.getSubscription()?.isLifetime).toBe(true);
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
    expect(harness.subscriptionModel.upsert).toHaveBeenCalledTimes(2);
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

    expect(notificationService.sendEmail).not.toHaveBeenCalled();
    expect(nowpayments.createPaymentPage).not.toHaveBeenCalled();
    expect(harness.subscriptionModel.upsert).not.toHaveBeenCalled();
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
    expect(harness.subscriptionModel.update).not.toHaveBeenCalled();
    expect(harness.subscriptionModel.deleteMany).not.toHaveBeenCalled();
  });
});
