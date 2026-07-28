import { Prisma } from '@prisma/client';
import { SubscriptionService } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service';

const organization = {
  id: 'org-1',
  subscription: {
    subscriptionTier: 'STANDARD',
  },
} as any;

describe('SubscriptionService image credit reservation', () => {
  const subscriptionRepository = {
    getSubscription: jest.fn(),
    getCreditsFrom: jest.fn(),
  };
  const integrationService = {};
  const organizationService = {};
  const transactionClient = {
    credits: {
      aggregate: jest.fn(),
      create: jest.fn(),
      deleteMany: jest.fn(),
    },
  };
  const prismaTransaction = {
    model: {
      $transaction: jest.fn(),
    },
  };

  const createService = () =>
    new SubscriptionService(
      subscriptionRepository as any,
      integrationService as any,
      organizationService as any,
      prismaTransaction as any
    );

  beforeEach(() => {
    jest.clearAllMocks();
    subscriptionRepository.getSubscription.mockResolvedValue({
      subscriptionTier: 'STANDARD',
      createdAt: new Date('2026-07-10T00:00:00.000Z'),
    });
    prismaTransaction.model.$transaction.mockImplementation(
      async (operation: any, options?: any) => {
        if (typeof operation === 'function') {
          return operation(transactionClient);
        }
        return operation;
      }
    );
    transactionClient.credits.aggregate.mockResolvedValue({
      _sum: { credits: 19 },
    });
    transactionClient.credits.create.mockResolvedValue({ id: 'credit-1' });
    transactionClient.credits.deleteMany.mockResolvedValue({ count: 1 });
  });

  it('loads a missing billing anchor before calculating credits', async () => {
    subscriptionRepository.getCreditsFrom.mockResolvedValue(7);

    await expect(
      createService().checkCredits(organization, 'ai_images')
    ).resolves.toEqual({ credits: 13 });

    expect(subscriptionRepository.getSubscription).toHaveBeenCalledWith(
      'org-1'
    );
    expect(subscriptionRepository.getCreditsFrom).toHaveBeenCalledWith(
      'org-1',
      expect.objectContaining({}),
      'ai_images'
    );
  });

  it('reserves the final credit inside a serializable transaction', async () => {
    const operation = jest.fn().mockResolvedValue('generated-image');

    await expect(
      createService().useCreditWithinLimit(
        organization,
        'ai_images',
        operation
      )
    ).resolves.toEqual({ allowed: true, value: 'generated-image' });

    expect(prismaTransaction.model.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      }
    );
    expect(transactionClient.credits.aggregate).toHaveBeenCalled();
    expect(transactionClient.credits.create).toHaveBeenCalledWith({
      data: {
        organizationId: 'org-1',
        credits: 1,
        type: 'ai_images',
      },
      select: { id: true },
    });
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('does not invoke the provider after another request consumes the final credit', async () => {
    transactionClient.credits.aggregate.mockResolvedValue({
      _sum: { credits: 20 },
    });
    const operation = jest.fn();

    await expect(
      createService().useCreditWithinLimit(
        organization,
        'ai_images',
        operation
      )
    ).resolves.toEqual({ allowed: false });

    expect(transactionClient.credits.create).not.toHaveBeenCalled();
    expect(operation).not.toHaveBeenCalled();
  });

  it('releases the reservation when generation fails', async () => {
    const failure = new Error('provider failed');

    await expect(
      createService().useCreditWithinLimit(
        organization,
        'ai_images',
        async () => {
          throw failure;
        }
      )
    ).rejects.toBe(failure);

    expect(transactionClient.credits.deleteMany).toHaveBeenCalledWith({
      where: { id: 'credit-1' },
    });
  });
});
