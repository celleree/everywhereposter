import { StripeController } from '../../apps/backend/src/api/routes/stripe.controller';
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
    | 'customer.subscription.deleted'
) =>
  ({
    type,
    data: {
      object: {
        id: 'sub_1',
        customer: 'cus_1',
        status: 'active',
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

const makeHarness = () => {
  const subscriptionRepository = {
    getOrganizationByCustomerId: jest.fn().mockResolvedValue({ id: 'org_1' }),
    getSubscriptionByCustomerId: jest.fn().mockResolvedValue({
      subscriptionTier: 'PRO',
      isLifetime: false,
    }),
    getSubscriptionByOrgId: jest.fn().mockResolvedValue({
      subscriptionTier: 'PRO',
      isLifetime: false,
    }),
    createOrUpdateSubscription: jest.fn().mockResolvedValue({ id: 'stored_subscription' }),
    deleteSubscriptionByCustomerId: jest.fn().mockResolvedValue({ id: 'deleted_subscription' }),
  };

  const integrations = Array.from({ length: 40 }, (_, index) => ({
    id: `integration_${index}`,
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
    subscriptionRepository as any,
    integrationService as any,
    entitlementOrganizationService as any,
    undefined
  );

  const stripeOrganizationService = {
    getOrgByCustomerId: jest.fn().mockResolvedValue({ allowTrial: false }),
  };

  const stripeService = new StripeService(
    subscriptionService,
    stripeOrganizationService as any,
    { getUserById: jest.fn() } as any,
    { track: jest.fn() } as any
  );

  return {
    subscriptionRepository,
    integrationService,
    entitlementOrganizationService,
    stripeOrganizationService,
    subscriptionService,
    stripeService,
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
    'bookkeeps subscription webhooks without entitlement or payment side effects when billing is %s',
    async (_label, billingValue) => {
      setBillingEnabled(billingValue);
      const harness = makeHarness();

      harness.stripeOrganizationService.getOrgByCustomerId.mockImplementation(() => {
        throw new Error('card validation must not run while billing is disabled');
      });

      await expect(
        harness.stripeService.createSubscription(
          makeEvent('customer.subscription.created')
        )
      ).resolves.toEqual({ id: 'stored_subscription' });

      await expect(
        harness.stripeService.updateSubscription(
          makeEvent('customer.subscription.updated')
        )
      ).resolves.toEqual({ id: 'stored_subscription' });

      await expect(
        harness.stripeService.deleteSubscription(
          makeEvent('customer.subscription.deleted')
        )
      ).resolves.toBeUndefined();

      await expect(
        harness.subscriptionService.modifySubscriptionByOrg(
          'org_1',
          0,
          'FREE'
        )
      ).resolves.toBe(true);

      expect(
        harness.subscriptionRepository.createOrUpdateSubscription
      ).toHaveBeenCalledTimes(2);
      expect(
        harness.subscriptionRepository.deleteSubscriptionByCustomerId
      ).toHaveBeenCalledWith('cus_1');

      expect(
        harness.stripeOrganizationService.getOrgByCustomerId
      ).not.toHaveBeenCalled();
      expect(
        harness.subscriptionRepository.getOrganizationByCustomerId
      ).not.toHaveBeenCalled();
      expect(
        harness.subscriptionRepository.getSubscriptionByCustomerId
      ).not.toHaveBeenCalled();
      expect(
        harness.subscriptionRepository.getSubscriptionByOrgId
      ).not.toHaveBeenCalled();
      expect(harness.integrationService.getIntegrationsList).not.toHaveBeenCalled();
      expect(harness.integrationService.disableIntegrations).not.toHaveBeenCalled();
      expect(harness.integrationService.changeActiveCron).not.toHaveBeenCalled();
      expect(
        harness.entitlementOrganizationService.disableOrEnableNonSuperAdminUsers
      ).not.toHaveBeenCalled();
    }
  );

  it('preserves billing-enabled entitlement behavior for created, updated, and deleted subscriptions', async () => {
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
    expect(
      harness.subscriptionRepository.createOrUpdateSubscription
    ).toHaveBeenCalledTimes(2);
    expect(
      harness.subscriptionRepository.deleteSubscriptionByCustomerId
    ).toHaveBeenCalledWith('cus_1');

    expect(harness.integrationService.disableIntegrations).toHaveBeenNthCalledWith(
      1,
      'org_1',
      35
    );
    expect(harness.integrationService.disableIntegrations).toHaveBeenNthCalledWith(
      2,
      'org_1',
      35
    );
    expect(harness.integrationService.disableIntegrations).toHaveBeenNthCalledWith(
      3,
      'org_1',
      40
    );
    expect(
      harness.entitlementOrganizationService.disableOrEnableNonSuperAdminUsers
    ).toHaveBeenCalledTimes(3);
    expect(
      harness.entitlementOrganizationService.disableOrEnableNonSuperAdminUsers
    ).toHaveBeenLastCalledWith('org_1', true);
    expect(harness.integrationService.changeActiveCron).toHaveBeenCalledWith(
      'org_1'
    );

    await expect(
      harness.subscriptionService.modifySubscriptionByOrg('org_1', 0, 'FREE')
    ).resolves.toBe(true);
    expect(
      harness.subscriptionRepository.getSubscriptionByOrgId
    ).toHaveBeenCalledWith('org_1');
    expect(harness.integrationService.disableIntegrations).toHaveBeenLastCalledWith(
      'org_1',
      40
    );
    expect(harness.integrationService.changeActiveCron).toHaveBeenLastCalledWith(
      'org_1'
    );
  });

  it('rejects an invalid webhook signature before subscription handling', () => {
    setBillingEnabled('false');
    process.env.STRIPE_SIGNING_KEY = 'whsec_test';
    const harness = makeHarness();
    const controller = new StripeController(harness.stripeService);

    expect(() =>
      controller.stripe({
        rawBody: Buffer.from(JSON.stringify(makeEvent('customer.subscription.created'))),
        headers: {
          'stripe-signature': 't=1,v1=deadbeef',
        },
      } as any)
    ).toThrow();

    expect(
      harness.subscriptionRepository.createOrUpdateSubscription
    ).not.toHaveBeenCalled();
    expect(
      harness.subscriptionRepository.deleteSubscriptionByCustomerId
    ).not.toHaveBeenCalled();
  });
});
